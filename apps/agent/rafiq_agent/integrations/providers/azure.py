"""Azure DevOps Boards work items and Azure Repos pull requests, REST 7.1 and a personal
access token."""

import base64
import re
from typing import Any
from urllib.parse import quote

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    Account,
    DevLink,
    FieldSpec,
    Integration,
    IntegrationError,
    Issue,
    IssueChanges,
    IssueComment,
    IssueDraft,
    IssueType,
    Person,
    Project,
    ProviderSpec,
    StatusOption,
)
from rafiq_agent.integrations.markup import html_to_markdown, markdown_to_html

V = "7.1"
CATEGORY = {"Proposed": "todo", "InProgress": "in_progress", "Resolved": "in_progress", "Completed": "done", "Removed": "done"}
LINKS = {
    "relates": "System.LinkTypes.Related",
    "blocks": "System.LinkTypes.Dependency-Forward",  # successor: this one comes first
    "blocked_by": "System.LinkTypes.Dependency-Reverse",
    "duplicates": "System.LinkTypes.Duplicate-Forward",
}
FIELDS = [
    "System.Id", "System.Title", "System.State", "System.TeamProject", "System.WorkItemType", "System.AssignedTo",
    "System.CreatedBy", "System.ChangedDate", "System.CreatedDate", "System.Description", "System.Tags",
    "Microsoft.VSTS.Common.Priority", "Microsoft.VSTS.Scheduling.DueDate", "Microsoft.VSTS.Scheduling.OriginalEstimate",
    "System.IterationPath", "System.CommentCount", "System.Parent",
]


STATE_GUESS = {
    "done": {"done", "closed", "removed", "resolved", "completed"},
    "in_progress": {"active", "committed", "in progress", "doing", "in review"},
}


def _category(state: str) -> str:
    low = (state or "").lower()
    return next((cat for cat, names in STATE_GUESS.items() if low in names), "todo")


def _wiql_text(value: str) -> str:
    return value.replace("'", "''")


class AzureDevOpsIntegration(Integration):
    spec = ProviderSpec(
        id="azure",
        name="Azure DevOps",
        icon="azuredevops",
        color="#0078D7",
        docs_url="https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate",
        blurb="Work items من Azure Boards و pull requests من Azure Repos — WIQL، إنشاء، روابط، مرفقات، والـ sprint.",
        secret="token",
        group="git",
        scopes="Work Items (Read & write) و Code (Read & write) و Project and Team (Read).",
        fields=[
            FieldSpec("organization", "المنظمة", "text", "my-org", help="الاسم بعد dev.azure.com/"),
            FieldSpec("token", "Personal access token", "password", ""),
        ],
    )
    capabilities = frozenset(
        {"search", "create", "update", "subtasks", "link", "attach", "dev", "sprint", "projects", "users", "reviews", "pull_request"}
    )

    def headers(self) -> dict[str, str]:
        raw = base64.b64encode(f":{self.secret}".encode()).decode()
        return {"Authorization": f"Basic {raw}", "Accept": "application/json", "Content-Type": "application/json"}

    def base(self) -> str:
        org = str(self.config.get("organization", "")).strip().strip("/")
        org = re.sub(r"^https?://dev\.azure\.com/", "", org)
        return f"https://dev.azure.com/{org}"

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/_apis/connectionData", params={"api-version": f"{V}-preview"})).json()
        user = data.get("authenticatedUser") or {}
        email = ((user.get("properties") or {}).get("Account") or {}).get("$value", "")
        return Account(label=f"{user.get('providerDisplayName', '')} ({email})", meta={"user_id": user.get("id"), "email": email})

    def _issue(self, raw: dict[str, Any]) -> Issue:
        f = raw.get("fields") or {}
        ident = str(raw.get("id") or f.get("System.Id"))
        project = f.get("System.TeamProject", "")
        estimate = f.get("Microsoft.VSTS.Scheduling.OriginalEstimate")
        relations = raw.get("relations") or []
        subtasks, links, files = [], [], []
        for r in relations:
            url = r.get("url", "")
            other = url.rstrip("/").split("/")[-1]
            rel = r.get("rel", "")
            if rel == "System.LinkTypes.Hierarchy-Forward":
                subtasks.append(other)
            elif rel.startswith("System.LinkTypes"):
                links.append({"kind": (r.get("attributes") or {}).get("name", rel), "key": other, "title": ""})
            elif rel == "AttachedFile":
                files.append({"name": (r.get("attributes") or {}).get("name", ""), "url": url})
        priority = f.get("Microsoft.VSTS.Common.Priority")
        return Issue(
            key=ident,
            id=ident,
            title=f.get("System.Title", ""),
            url=f"{self.base()}/{quote(project)}/_workitems/edit/{ident}",
            status=f.get("System.State", ""),
            status_category=_category(f.get("System.State", "")),
            project=project,
            updated_at=f.get("System.ChangedDate"),
            created_at=f.get("System.CreatedDate"),
            description=html_to_markdown(f.get("System.Description")) or None,
            priority=str(priority) if priority is not None else None,
            issue_type=f.get("System.WorkItemType"),
            assignee=(f.get("System.AssignedTo") or {}).get("displayName") if isinstance(f.get("System.AssignedTo"), dict) else f.get("System.AssignedTo"),
            reporter=(f.get("System.CreatedBy") or {}).get("displayName") if isinstance(f.get("System.CreatedBy"), dict) else None,
            labels=[t.strip() for t in str(f.get("System.Tags") or "").split(";") if t.strip()],
            due_date=(f.get("Microsoft.VSTS.Scheduling.DueDate") or "")[:10] or None,
            parent=str(f.get("System.Parent")) if f.get("System.Parent") else None,
            milestone=f.get("System.IterationPath"),
            estimate=f"{estimate:g}h" if isinstance(estimate, (int, float)) else None,
            comment_count=f.get("System.CommentCount"),
            subtasks=subtasks,
            links=links,
            attachments=files,
            extra={"project": project, "type": f.get("System.WorkItemType")},
        )

    async def _wiql(self, query: str, limit: int) -> list[Issue]:
        async with self.client() as c:
            data = self.check(
                await c.post(f"{self.base()}/_apis/wit/wiql", params={"api-version": V, "$top": limit}, json={"query": query})
            ).json()
            ids = [str(w.get("id")) for w in data.get("workItems", [])][:limit]
            if not ids:
                return []
            rows = self.check(
                await c.get(f"{self.base()}/_apis/wit/workitems", params={"ids": ",".join(ids), "fields": ",".join(FIELDS), "api-version": V})
            ).json()
        issues = [self._issue(r) for r in rows.get("value", [])]
        order = {k: i for i, k in enumerate(ids)}
        return sorted(issues, key=lambda i: order.get(i.key, 0))

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        clauses = ["[System.AssignedTo] = @Me"]
        if not include_done:
            clauses.append("[System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved', 'Completed')")
        if query:
            clauses.append(f"[System.Title] CONTAINS '{_wiql_text(query)}'")
        return await self._wiql(f"SELECT [System.Id] FROM WorkItems WHERE {' AND '.join(clauses)} ORDER BY [System.ChangedDate] DESC", limit)

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        q = query.strip()
        if q.upper().startswith("SELECT"):
            return await self._wiql(q, limit)
        return await self._wiql(
            f"SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '{_wiql_text(q)}' ORDER BY [System.ChangedDate] DESC", limit
        )

    async def get_issue(self, key: str) -> Issue:
        if not key.strip().isdigit():
            raise IntegrationError(tr("رقم الـ work item لازم يكون رقم."))
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/_apis/wit/workitems/{key}", params={"$expand": "relations", "api-version": V})
            ).json()
        return self._issue(data)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        project = (await self.get_issue(key)).project or ""
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/{quote(project)}/_apis/wit/workItems/{key}/comments", params={"api-version": f"{V}-preview.4", "$top": limit})
            ).json()
        me = (self.config.get("_account") or {}).get("user_id")
        return [
            IssueComment(
                id=str(c_.get("id")),
                author=(c_.get("createdBy") or {}).get("displayName", ""),
                body=html_to_markdown(c_.get("text")),
                created_at=c_.get("createdDate"),
                mine=bool(me) and (c_.get("createdBy") or {}).get("id") == me,
            )
            for c_ in data.get("comments", [])
        ]

    async def list_projects(self) -> list[Project]:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/_apis/projects", params={"api-version": V, "$top": 200})).json()
        return [Project(id=p.get("id", ""), key=p.get("name", ""), name=p.get("name", ""), url=f"{self.base()}/{quote(p.get('name', ''))}") for p in data.get("value", [])]

    async def list_issue_types(self, project: str) -> list[IssueType]:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/{quote(project)}/_apis/wit/workitemtypes", params={"api-version": V})).json()
        return [IssueType(id=t.get("name", ""), name=t.get("name", ""), subtask=t.get("name") == "Task") for t in data.get("value", []) if not t.get("isDisabled")]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        if not project:
            return []
        async with self.client() as c:
            teams = self.check(await c.get(f"{self.base()}/_apis/projects/{quote(project)}/teams", params={"api-version": V})).json()
            people: dict[str, Person] = {}
            for team in teams.get("value", [])[:5]:
                members = self.check(
                    await c.get(f"{self.base()}/_apis/projects/{quote(project)}/teams/{team.get('id')}/members", params={"api-version": V})
                ).json()
                for m in members.get("value", []):
                    ident = m.get("identity") or {}
                    if query.lower() in ident.get("displayName", "").lower():
                        people[ident.get("uniqueName", "")] = Person(id=ident.get("uniqueName", ""), name=ident.get("displayName", ""), handle=ident.get("uniqueName"))
        return list(people.values())

    async def list_priorities(self) -> list[str]:
        return ["1", "2", "3", "4"]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        issue = await self.get_issue(key)
        project, kind = issue.extra.get("project", ""), issue.extra.get("type", "")
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/{quote(project)}/_apis/wit/workitemtypes/{quote(kind)}/states", params={"api-version": V})
            ).json()
        return [StatusOption(id=s.get("name", ""), name=s.get("name", ""), category=CATEGORY.get(s.get("category", ""))) for s in data.get("value", [])]

    async def dev_links(self, key: str) -> list[DevLink]:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/_apis/wit/workitems/{key}", params={"$expand": "relations", "api-version": V})).json()
        out = []
        for r in data.get("relations") or []:
            if r.get("rel") != "ArtifactLink":
                continue
            name = (r.get("attributes") or {}).get("name", "")
            url = r.get("url", "")
            kind = "pull_request" if "PullRequestId" in url else ("commit" if "Commit" in url else "branch" if "Ref" in url else "link")
            out.append(DevLink(kind=kind, title=name or url, url=url))
        return out

    async def sprint(self, project: str | None = None, mine: bool = False) -> tuple[str | None, list[Issue]]:
        clauses = ["[System.IterationPath] = @CurrentIteration"]
        if project:
            clauses.append(f"[System.TeamProject] = '{_wiql_text(project)}'")
        if mine:
            clauses.append("[System.AssignedTo] = @Me")
        issues = await self._wiql(f"SELECT [System.Id] FROM WorkItems WHERE {' AND '.join(clauses)} ORDER BY [Microsoft.VSTS.Common.StackRank]", 100)
        return (issues[0].milestone if issues else tr("الـ sprint الحالي")), issues

    async def review_requests(self, limit: int = 30) -> list[Issue]:
        me = (self.config.get("_account") or {}).get("user_id")
        if not me:
            return []
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/_apis/git/pullrequests",
                    params={"searchCriteria.reviewerId": me, "searchCriteria.status": "active", "$top": limit, "api-version": V},
                )
            ).json()
        out = []
        for pr in data.get("value", []):
            repo = pr.get("repository") or {}
            project = (repo.get("project") or {}).get("name", "")
            out.append(
                Issue(
                    key=f"{repo.get('name', '')}!{pr.get('pullRequestId')}",
                    id=str(pr.get("pullRequestId")),
                    title=pr.get("title", ""),
                    url=f"{self.base()}/{quote(project)}/_git/{quote(repo.get('name', ''))}/pullrequest/{pr.get('pullRequestId')}",
                    status=pr.get("status", ""),
                    project=project,
                    created_at=pr.get("creationDate"),
                    reporter=(pr.get("createdBy") or {}).get("displayName"),
                    kind="pull_request",
                )
            )
        return out

    # -- writing -------------------------------------------------------------------------

    async def _patch(self, key: str, ops: list[dict[str, Any]]) -> dict[str, Any]:
        async with self.client() as c:
            return self.check(
                await c.patch(
                    f"{self.base()}/_apis/wit/workitems/{key}",
                    params={"api-version": V},
                    json=ops,
                    headers={"Content-Type": "application/json-patch+json"},
                )
            ).json()

    def _ops(self, *, title: str | None, description: str | None, priority: str | None, due: str | None,
             estimate: float | None, assignee: str | None, labels: list[str] | None) -> list[dict[str, Any]]:
        ops: list[dict[str, Any]] = []

        def put(field: str, value: Any) -> None:
            ops.append({"op": "add", "path": f"/fields/{field}", "value": value})

        if title is not None:
            put("System.Title", title)
        if description is not None:
            put("System.Description", markdown_to_html(description))
        if priority:
            put("Microsoft.VSTS.Common.Priority", int(re.sub(r"\D", "", priority) or 2))
        if due is not None:
            put("Microsoft.VSTS.Scheduling.DueDate", due or None)
        if estimate is not None:
            put("Microsoft.VSTS.Scheduling.OriginalEstimate", estimate)
        if assignee is not None:
            me = (self.config.get("_account") or {}).get("email", "")
            put("System.AssignedTo", me if assignee == "me" else assignee)
        if labels is not None:
            put("System.Tags", "; ".join(labels))
        return ops

    def _relation(self, rel: str, other: str) -> dict[str, Any]:
        return {"op": "add", "path": "/relations/-", "value": {"rel": rel, "url": f"{self.base()}/_apis/wit/workItems/{other}"}}

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        project = (await self.get_issue(key)).project or ""
        async with self.client() as c:
            data = self.check(
                await c.post(
                    f"{self.base()}/{quote(project)}/_apis/wit/workItems/{key}/comments",
                    params={"api-version": f"{V}-preview.4"},
                    json={"text": markdown_to_html(body)},
                )
            ).json()
        return str(data.get("id")) if data.get("id") else None

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        project = (await self.get_issue(key)).project or ""
        async with self.client() as c:
            self.check(
                await c.patch(
                    f"{self.base()}/{quote(project)}/_apis/wit/workItems/{key}/comments/{comment_id}",
                    params={"api-version": f"{V}-preview.4"},
                    json={"text": markdown_to_html(body)},
                )
            )

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        project = (await self.get_issue(key)).project or ""
        async with self.client() as c:
            self.check(
                await c.delete(f"{self.base()}/{quote(project)}/_apis/wit/workItems/{key}/comments/{comment_id}", params={"api-version": f"{V}-preview.4"})
            )

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        data = await self._patch(key, [{"op": "add", "path": "/fields/System.State", "value": status_id}])
        return (data.get("fields") or {}).get("System.State", status_id)

    async def complete(self, key: str) -> str:
        options = await self.list_statuses(key)
        done = next((o for o in options if o.category == "done" and o.name != "Removed"), None)
        if not done:
            raise IntegrationError(tr("ما في حالة «مكتمل» لهالنوع من المهام."))
        return await self.set_status(key, done.id)

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        kind = draft.issue_type or ("Task" if draft.parent else "User Story")
        ops = self._ops(
            title=draft.title, description=draft.description, priority=draft.priority, due=draft.due_date,
            estimate=draft.estimate_hours, assignee=draft.assignee, labels=draft.labels or None,
        )
        if draft.parent:
            ops.append(self._relation("System.LinkTypes.Hierarchy-Reverse", draft.parent))
        async with self.client() as c:
            resp = await c.post(
                f"{self.base()}/{quote(draft.project)}/_apis/wit/workitems/${quote(kind)}",
                params={"api-version": V},
                json=ops,
                headers={"Content-Type": "application/json-patch+json"},
            )
            if resp.status_code in (400, 404) and not draft.issue_type and kind == "User Story":
                # Basic/Scrum processes name it "Issue" or "Product Backlog Item".
                for alt in ("Product Backlog Item", "Issue", "Task"):
                    resp = await c.post(
                        f"{self.base()}/{quote(draft.project)}/_apis/wit/workitems/${quote(alt)}",
                        params={"api-version": V}, json=ops, headers={"Content-Type": "application/json-patch+json"},
                    )
                    if resp.status_code < 400:
                        break
            data = self.check(resp).json()
        return self._issue(data)

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        labels = changes.labels
        if labels is None and (changes.add_labels or changes.remove_labels):
            current = (await self.get_issue(key)).labels
            labels = list(dict.fromkeys([x for x in current if x not in changes.remove_labels] + changes.add_labels))
        ops = self._ops(
            title=changes.title, description=changes.description, priority=changes.priority, due=changes.due_date,
            estimate=changes.estimate_hours, assignee=changes.assignee, labels=labels,
        )
        if changes.parent:
            ops.append(self._relation("System.LinkTypes.Hierarchy-Reverse", changes.parent))
        if ops:
            await self._patch(key, ops)
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        self.guard_write()
        await self._patch(key, [self._relation(LINKS.get(kind, LINKS["relates"]), other)])

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        project = (await self.get_issue(key)).project or ""
        async with self.client() as c:
            up = self.check(
                await c.post(
                    f"{self.base()}/{quote(project)}/_apis/wit/attachments",
                    params={"fileName": filename, "api-version": V},
                    content=data,
                    headers={"Content-Type": "application/octet-stream"},
                )
            ).json()
        url = up.get("url", "")
        await self._patch(key, [{"op": "add", "path": "/relations/-", "value": {"rel": "AttachedFile", "url": url, "attributes": {"comment": filename}}}])
        return url

    async def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str) -> DevLink:
        """`repo` is "project/repository"."""
        self.guard_write()
        project, _, name = repo.partition("/")
        async with self.client() as c:
            data = self.check(
                await c.post(
                    f"{self.base()}/{quote(project)}/_apis/git/repositories/{quote(name)}/pullrequests",
                    params={"api-version": V},
                    json={"sourceRefName": f"refs/heads/{head}", "targetRefName": f"refs/heads/{base}", "title": title, "description": body[:4000]},
                )
            ).json()
        pr = data.get("pullRequestId")
        return DevLink(kind="pull_request", title=f"!{pr} {title}", url=f"{self.base()}/{quote(project)}/_git/{quote(name)}/pullrequest/{pr}", state="open", ref=head)

    def repo_for_remote(self, remote_url: str) -> str | None:
        org = re.escape(self.base().rsplit("/", 1)[-1])
        m = re.match(rf"^https://(?:[^@/]+@)?dev\.azure\.com/{org}/([^/]+)/_git/([^/]+?)/?$", remote_url.strip()) or re.match(
            rf"^git@ssh\.dev\.azure\.com:v3/{org}/([^/]+)/([^/]+?)/?$", remote_url.strip()
        )
        return f"{m.group(1)}/{m.group(2)}" if m else None
