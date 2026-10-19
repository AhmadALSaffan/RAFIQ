"""Linear, through its public GraphQL API and a personal API key."""

from typing import Any

import httpx

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    Account,
    Activity,
    DevLink,
    FieldSpec,
    Integration,
    IntegrationError,
    Issue,
    IssueChanges,
    IssueComment,
    IssueDraft,
    Person,
    Project,
    ProviderSpec,
    StatusOption,
)

PRIORITIES = {"urgent": 1, "high": 2, "medium": 3, "normal": 3, "low": 4, "none": 0, "no priority": 0}
PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"]
RELATIONS = {"relates": "related", "blocks": "blocks", "blocked_by": "blocks", "duplicates": "duplicate"}


class LinearIntegration(Integration):
    spec = ProviderSpec(
        id="linear",
        name="Linear",
        icon="linear",
        color="#5E6AD2",
        docs_url="https://linear.app/settings/api",
        blurb="مهامك من Linear — بحث، إنشاء، مهام فرعية، علاقات، مرفقات، والـ cycle الحالي.",
        secret="api_key",
        scopes="Personal API key بصلاحية Read و Write.",
        fields=[FieldSpec("api_key", "API key", "password", "lin_api_…")],
    )
    capabilities = frozenset(
        {"search", "create", "update", "subtasks", "link", "attach", "dev", "comment_edit", "mentions", "sprint", "projects", "users"}
    )
    ENDPOINT = "https://api.linear.app/graphql"

    def headers(self) -> dict[str, str]:
        return {"Authorization": self.secret, "Content-Type": "application/json"}

    async def _gql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        async with self.client() as c:
            data = self.check(await c.post(self.ENDPOINT, json={"query": query, "variables": variables or {}})).json()
        if data.get("errors"):
            raise IntegrationError(str(data["errors"][0].get("message", tr("خطأ من Linear"))))
        return data.get("data", {})

    async def verify(self) -> Account:
        data = await self._gql("{ viewer { id name email } }")
        viewer = data.get("viewer") or {}
        return Account(label=f"{viewer.get('name', '')} ({viewer.get('email', '')})", meta={"user_id": viewer.get("id")})

    ISSUE_FIELDS = """
        id identifier title url updatedAt createdAt description dueDate estimate priorityLabel
        state { name type } team { key name } project { name } assignee { name } creator { name }
        parent { identifier } labels { nodes { name } } comments { nodes { id } }
        children { nodes { identifier } }
        relations { nodes { type relatedIssue { identifier title } } }
        attachments { nodes { title url sourceType metadata } }
        cycle { name number }
    """
    CATEGORY = {
        "completed": "done",
        "canceled": "done",
        "started": "in_progress",
        "unstarted": "todo",
        "backlog": "todo",
        "triage": "todo",
    }

    @classmethod
    def _issue(cls, node: dict[str, Any]) -> Issue:
        state = node.get("state") or {}
        attachments = (node.get("attachments") or {}).get("nodes") or []
        return Issue(
            key=node.get("identifier", ""),
            id=node.get("id", ""),
            title=node.get("title", ""),
            url=node.get("url", ""),
            status=state.get("name", ""),
            status_category=cls.CATEGORY.get(state.get("type", "")),
            project=(node.get("project") or {}).get("name") or (node.get("team") or {}).get("name"),
            updated_at=node.get("updatedAt"),
            created_at=node.get("createdAt"),
            description=node.get("description"),
            priority=node.get("priorityLabel"),
            assignee=(node.get("assignee") or {}).get("name"),
            reporter=(node.get("creator") or {}).get("name"),
            labels=[n.get("name", "") for n in ((node.get("labels") or {}).get("nodes") or [])],
            due_date=node.get("dueDate"),
            parent=(node.get("parent") or {}).get("identifier"),
            estimate=str(node["estimate"]) if node.get("estimate") is not None else None,
            milestone=(node.get("cycle") or {}).get("name") or (
                f"Cycle {(node.get('cycle') or {}).get('number')}" if node.get("cycle") else None
            ),
            comment_count=len((node.get("comments") or {}).get("nodes") or []),
            subtasks=[c.get("identifier", "") for c in ((node.get("children") or {}).get("nodes") or [])],
            links=[
                {"kind": r.get("type", ""), "key": (r.get("relatedIssue") or {}).get("identifier", ""),
                 "title": (r.get("relatedIssue") or {}).get("title", "")}
                for r in ((node.get("relations") or {}).get("nodes") or [])
            ],
            attachments=[{"name": a.get("title", ""), "url": a.get("url", "")} for a in attachments],
            extra={"team_key": (node.get("team") or {}).get("key")},
        )

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        filter_clause = "" if include_done else 'filter: { state: { type: { nin: ["completed", "canceled"] } } }, '
        data = await self._gql(
            f"""query($limit: Int!) {{ viewer {{ assignedIssues(first: $limit, {filter_clause}orderBy: updatedAt) {{
                nodes {{ {self.ISSUE_FIELDS} }} }} }} }}""",
            {"limit": limit},
        )
        nodes = ((data.get("viewer") or {}).get("assignedIssues") or {}).get("nodes", [])
        issues = [self._issue(n) for n in nodes]
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        return issues

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        try:
            data = await self._gql(
                f"query($q: String!, $n: Int!) {{ searchIssues(term: $q, first: $n) {{ nodes {{ {self.ISSUE_FIELDS} }} }} }}",
                {"q": query, "n": limit},
            )
            nodes = (data.get("searchIssues") or {}).get("nodes", [])
        except IntegrationError:
            data = await self._gql(
                f"query($q: String!, $n: Int!) {{ issueSearch(query: $q, first: $n) {{ nodes {{ {self.ISSUE_FIELDS} }} }} }}",
                {"q": query, "n": limit},
            )
            nodes = (data.get("issueSearch") or {}).get("nodes", [])
        return [self._issue(n) for n in nodes]

    async def get_issue(self, key: str) -> Issue:
        data = await self._gql(f"query($key: String!) {{ issue(id: $key) {{ {self.ISSUE_FIELDS} }} }}", {"key": key})
        issue = data.get("issue")
        if not issue:
            raise IntegrationError(tr("ما لقيت المهمة {0}", key))
        return self._issue(issue)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        me = (self.config.get("_account") or {}).get("user_id")
        data = await self._gql(
            "query($key: String!, $limit: Int!) { issue(id: $key) { comments(first: $limit) { nodes { id body createdAt user { id name } } } } }",
            {"key": key, "limit": limit},
        )
        nodes = (((data.get("issue") or {}).get("comments")) or {}).get("nodes", [])
        return [
            IssueComment(
                id=n.get("id"),
                author=(n.get("user") or {}).get("name", ""),
                body=n.get("body", ""),
                created_at=n.get("createdAt"),
                mine=bool(me) and (n.get("user") or {}).get("id") == me,
            )
            for n in nodes
        ]

    async def list_projects(self) -> list[Project]:
        data = await self._gql("{ teams(first: 100) { nodes { id key name } } }")
        return [Project(id=t["id"], key=t.get("key", ""), name=t.get("name", "")) for t in (data.get("teams") or {}).get("nodes", [])]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        data = await self._gql(
            "query($q: String!) { users(first: 50, filter: { name: { containsIgnoreCase: $q } }) { nodes { id name email } } }",
            {"q": query},
        )
        return [Person(id=u["id"], name=u.get("name", ""), handle=u.get("email")) for u in (data.get("users") or {}).get("nodes", [])]

    async def list_labels(self, project: str | None = None) -> list[str]:
        data = await self._gql("{ issueLabels(first: 200) { nodes { name } } }")
        return [n.get("name", "") for n in (data.get("issueLabels") or {}).get("nodes", [])]

    async def list_priorities(self) -> list[str]:
        return PRIORITY_NAMES[1:] + PRIORITY_NAMES[:1]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        data = await self._gql(
            "query($key: String!) { issue(id: $key) { team { states { nodes { id name type } } } } }", {"key": key}
        )
        nodes = ((((data.get("issue") or {}).get("team")) or {}).get("states") or {}).get("nodes", [])
        return [StatusOption(id=n["id"], name=n["name"], category=self.CATEGORY.get(n.get("type", ""))) for n in nodes]

    async def dev_links(self, key: str) -> list[DevLink]:
        issue = await self.get_issue(key)
        out = []
        for a in issue.attachments:
            url = a.get("url", "")
            kind = "pull_request" if "/pull/" in url or "merge_requests" in url else ("commit" if "/commit/" in url else "link")
            out.append(DevLink(kind=kind, title=a.get("name") or url, url=url))
        return out

    async def mentions(self, since: str | None = None) -> list[Activity]:
        data = await self._gql(
            """{ notifications(first: 40) { nodes { id type createdAt readAt actor { name }
                ... on IssueNotification { issue { identifier title url } comment { body } } } } }"""
        )
        out = []
        for n in (data.get("notifications") or {}).get("nodes", []):
            issue = n.get("issue") or {}
            if not issue or (since and (n.get("createdAt") or "") <= since):
                continue
            kind = str(n.get("type", ""))
            out.append(
                Activity(
                    kind="mention" if "mention" in kind.lower() else ("assigned" if "assign" in kind.lower() else "comment" if "comment" in kind.lower() else "update"),
                    key=issue.get("identifier", ""),
                    title=issue.get("title", ""),
                    url=issue.get("url", ""),
                    at=n.get("createdAt"),
                    actor=(n.get("actor") or {}).get("name"),
                    text=((n.get("comment") or {}).get("body") or "")[:300] or None,
                    id=n.get("id"),
                )
            )
        return out

    async def sprint(self, project: str | None = None, mine: bool = False) -> tuple[str | None, list[Issue]]:
        filters = ["cycle: { isActive: { eq: true } }"]
        if project:
            filters.append(f'team: {{ key: {{ eq: "{project.replace(chr(34), "")}" }} }}')
        if mine:
            filters.append("assignee: { isMe: { eq: true } }")
        data = await self._gql(f"{{ issues(first: 100, filter: {{ {', '.join(filters)} }}) {{ nodes {{ {self.ISSUE_FIELDS} }} }} }}")
        issues = [self._issue(n) for n in (data.get("issues") or {}).get("nodes", [])]
        name = next((i.milestone for i in issues if i.milestone), None)
        return name or tr("الـ cycle الحالي"), issues

    # -- writing -------------------------------------------------------------------------

    async def _issue_id(self, key: str) -> str:
        data = await self._gql("query($key: String!) { issue(id: $key) { id } }", {"key": key})
        ident = (data.get("issue") or {}).get("id")
        if not ident:
            raise IntegrationError(tr("ما لقيت المهمة على Linear."))
        return ident

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        data = await self._gql(
            "mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success comment { id } } }",
            {"id": await self._issue_id(key), "body": body},
        )
        return ((data.get("commentCreate") or {}).get("comment") or {}).get("id")

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        await self._gql(
            "mutation($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { success } }",
            {"id": comment_id, "body": body},
        )

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        await self._gql("mutation($id: String!) { commentDelete(id: $id) { success } }", {"id": comment_id})

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        options = await self.list_statuses(key)
        target = next((o for o in options if o.id == status_id or o.name.lower() == status_id.lower()), None)
        if not target:
            raise IntegrationError(tr("هالحالة مو موجودة بفريق هالمهمة."))
        await self._gql(
            "mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }",
            {"id": await self._issue_id(key), "state": target.id},
        )
        return target.name

    async def complete(self, key: str) -> str:
        self.guard_write()
        options = await self.list_statuses(key)
        done = next((o for o in options if o.category == "done" and o.name.lower() != "canceled"), None)
        if not done:
            raise IntegrationError(tr("ما في حالة «مكتمل» معرّفة بهالفريق على Linear."))
        return await self.set_status(key, done.id)

    async def _team_id(self, team: str) -> str:
        for t in await self.list_projects():
            if team in (t.id, t.key) or t.name.lower() == team.lower():
                return t.id
        raise IntegrationError(tr("ما لقيت فريق «{0}» على Linear.", team))

    async def _label_ids(self, names: list[str]) -> list[str]:
        if not names:
            return []
        data = await self._gql("{ issueLabels(first: 250) { nodes { id name } } }")
        by_name = {n["name"].lower(): n["id"] for n in (data.get("issueLabels") or {}).get("nodes", [])}
        return [by_name[n.lower()] for n in names if n.lower() in by_name]

    def _assignee(self, value: str) -> str | None:
        if value == "me":
            return (self.config.get("_account") or {}).get("user_id")
        return value or None

    async def _input(self, *, title: str | None, description: str | None, priority: str | None, due: str | None,
                     estimate: float | None, assignee: str | None, parent: str | None) -> dict[str, Any]:
        data: dict[str, Any] = {}
        if title is not None:
            data["title"] = title
        if description is not None:
            data["description"] = description
        if priority:
            data["priority"] = PRIORITIES.get(priority.lower(), 3)
        if due is not None:
            data["dueDate"] = due or None
        if estimate is not None:
            data["estimate"] = round(estimate)
        if assignee is not None:
            data["assigneeId"] = self._assignee(assignee)
        if parent:
            data["parentId"] = await self._issue_id(parent)
        return data

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        data = await self._input(
            title=draft.title, description=draft.description, priority=draft.priority, due=draft.due_date,
            estimate=draft.estimate_hours, assignee=draft.assignee, parent=draft.parent,
        )
        data["teamId"] = await self._team_id(draft.project)
        if labels := await self._label_ids(draft.labels):
            data["labelIds"] = labels
        out = await self._gql(
            "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier } } }",
            {"input": data},
        )
        key = ((out.get("issueCreate") or {}).get("issue") or {}).get("identifier", "")
        return await self.get_issue(key)

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        data = await self._input(
            title=changes.title, description=changes.description, priority=changes.priority, due=changes.due_date,
            estimate=changes.estimate_hours, assignee=changes.assignee, parent=changes.parent,
        )
        if changes.labels is not None:
            data["labelIds"] = await self._label_ids(changes.labels)
        elif changes.add_labels or changes.remove_labels:
            current = (await self.get_issue(key)).labels
            wanted = [x for x in current if x not in changes.remove_labels] + changes.add_labels
            data["labelIds"] = await self._label_ids(list(dict.fromkeys(wanted)))
        if data:
            await self._gql(
                "mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }",
                {"id": await self._issue_id(key), "input": data},
            )
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        self.guard_write()
        a, b = (other, key) if kind == "blocked_by" else (key, other)
        await self._gql(
            "mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }",
            {"input": {"issueId": await self._issue_id(a), "relatedIssueId": await self._issue_id(b),
                       "type": RELATIONS.get(kind, "related")}},
        )

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        """Linear's official upload: ask for a signed URL, PUT the file there, then attach
        the asset to the issue."""
        self.guard_write()
        out = await self._gql(
            """mutation($ct: String!, $name: String!, $size: Int!) { fileUpload(contentType: $ct, filename: $name, size: $size) {
                uploadFile { uploadUrl assetUrl headers { key value } } } }""",
            {"ct": mime, "name": filename, "size": len(data)},
        )
        upload = ((out.get("fileUpload") or {}).get("uploadFile")) or {}
        if not upload.get("uploadUrl"):
            raise IntegrationError(tr("Linear ما عطى رابط رفع."))
        headers = {"Content-Type": mime, "Cache-Control": "public, max-age=31536000"}
        headers.update({h["key"]: h["value"] for h in upload.get("headers") or []})
        async with httpx.AsyncClient(timeout=60, transport=self.transport) as c:
            self.check(await c.put(upload["uploadUrl"], content=data, headers=headers))
        await self._gql(
            "mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }",
            {"input": {"issueId": await self._issue_id(key), "url": upload["assetUrl"], "title": filename}},
        )
        return upload["assetUrl"]
