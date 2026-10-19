"""GitLab (gitlab.com or self-managed) issues and merge requests, REST v4 and a personal
access token."""

import re
from typing import Any
from urllib.parse import quote, urlparse

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

TODO_KINDS = {
    "mentioned": "mention",
    "directly_addressed": "mention",
    "review_requested": "review",
    "assigned": "assigned",
    "approval_required": "review",
    "build_failed": "update",
    "marked": "update",
}
LINK_TYPES = {"relates": "relates_to", "blocks": "blocks", "blocked_by": "is_blocked_by", "duplicates": "relates_to"}


class GitLabIntegration(Integration):
    spec = ProviderSpec(
        id="gitlab",
        name="GitLab",
        icon="gitlab",
        color="#FC6D26",
        docs_url="https://gitlab.com/-/user_settings/personal_access_tokens",
        blurb="الـ issues والـ merge requests على GitLab (سحابي أو على سيرفرك) — بحث، إنشاء، روابط، مرفقات، وقت، و To-Do.",
        secret="token",
        group="git",
        scopes="صلاحية api (أو read_api للقراءة بس).",
        fields=[
            FieldSpec("token", "Personal access token", "password", "glpat-…", help="صلاحية api"),
            FieldSpec("base_url", "رابط الخادم", "url", "https://gitlab.com", required=False),
        ],
    )
    capabilities = frozenset(
        {"search", "create", "update", "link", "attach", "worklog", "dev", "comment_edit", "mentions", "reviews", "sprint", "projects", "users", "pull_request", "subtasks"}
    )

    def headers(self) -> dict[str, str]:
        return {"PRIVATE-TOKEN": self.secret, "Content-Type": "application/json"}

    def host(self) -> str:
        return str(self.config.get("base_url") or "https://gitlab.com").rstrip("/")

    def base(self) -> str:
        return self.host() + "/api/v4"

    def _me(self) -> dict[str, Any]:
        return self.config.get("_account") or {}

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/user")).json()
        return Account(
            label=f"{data.get('name', '')} (@{data.get('username', '')})",
            meta={"user_id": data.get("id"), "username": data.get("username")},
        )

    @staticmethod
    def _issue(raw: dict[str, Any], kind: str = "issue") -> Issue:
        refs = raw.get("references") or {}
        full = refs.get("full") or f"#{raw.get('iid')}"
        state = raw.get("state", "")
        return Issue(
            key=full,
            id=f"{raw.get('project_id')}:{raw.get('iid')}",
            title=raw.get("title", ""),
            url=raw.get("web_url", ""),
            status=state,
            status_category="done" if state in ("closed", "merged") else "todo",
            project=re.split(r"[#!]", full)[0] or None,
            updated_at=raw.get("updated_at"),
            created_at=raw.get("created_at"),
            description=raw.get("description"),
            assignee=", ".join(a.get("name", "") for a in raw.get("assignees") or []) or (raw.get("assignee") or {}).get("name"),
            reporter=(raw.get("author") or {}).get("name"),
            labels=list(raw.get("labels") or []),
            due_date=raw.get("due_date"),
            milestone=(raw.get("milestone") or {}).get("title"),
            comment_count=raw.get("user_notes_count"),
            issue_type=raw.get("issue_type") or ("merge request" if kind == "pull_request" else None),
            estimate=(raw.get("time_stats") or {}).get("human_time_estimate"),
            kind=kind,
        )

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        params: dict[str, Any] = {"scope": "assigned_to_me", "per_page": min(limit, 100), "order_by": "updated_at"}
        if not include_done:
            params["state"] = "opened"
        if query:
            params["search"] = query
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/issues", params=params)).json()
        return [self._issue(raw) for raw in data]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/issues", params={"scope": "all", "search": query, "per_page": min(limit, 100), "order_by": "updated_at"})
            ).json()
        return [self._issue(raw) for raw in data]

    async def _resolve(self, key: str) -> tuple[str, str]:
        """Accepts either the internal 'projectId:iid' or the human 'group/project#iid'."""
        if ":" in key and "#" not in key:
            project, _, iid = key.partition(":")
            return project, iid
        path, _, iid = key.partition("#")
        if not path or not iid.isdigit():
            raise IntegrationError(tr("صيغة المهمة لازم تكون group/project#123"))
        return quote(path, safe=""), iid

    async def get_issue(self, key: str) -> Issue:
        project, iid = await self._resolve(key)
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/projects/{project}/issues/{iid}")).json()
            issue = self._issue(data)
            try:
                links = self.check(await c.get(f"{self.base()}/projects/{project}/issues/{iid}/links")).json()
                issue.links = [
                    {"kind": link.get("link_type", ""), "key": (link.get("references") or {}).get("full", ""), "title": link.get("title", "")}
                    for link in links
                ]
            except IntegrationError:
                pass
        return issue

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        project, iid = await self._resolve(key)
        me = self._me().get("user_id")
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/projects/{project}/issues/{iid}/notes", params={"per_page": min(limit, 100), "sort": "desc"})
            ).json()
        return [
            IssueComment(
                id=str(n.get("id")),
                author=(n.get("author") or {}).get("name", ""),
                body=n.get("body", ""),
                created_at=n.get("created_at"),
                mine=bool(me) and (n.get("author") or {}).get("id") == me,
            )
            for n in data
            if not n.get("system")  # skip GitLab's auto "changed status" notes
        ]

    async def list_projects(self) -> list[Project]:
        async with self.client() as c:
            rows = self.check(
                await c.get(f"{self.base()}/projects", params={"membership": "true", "per_page": 100, "order_by": "last_activity_at", "simple": "true"})
            ).json()
        return [Project(id=str(p.get("id")), key=p.get("path_with_namespace", ""), name=p.get("name_with_namespace", ""), url=p.get("web_url")) for p in rows]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(
                await c.get(f"{self.base()}/projects/{quote(project, safe='')}/members/all", params={"query": query, "per_page": 100})
            ).json()
        return [Person(id=str(u.get("id")), name=u.get("name", ""), handle=u.get("username")) for u in rows]

    async def list_labels(self, project: str | None = None) -> list[str]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/projects/{quote(project, safe='')}/labels", params={"per_page": 100})).json()
        return [label.get("name", "") for label in rows]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        return [StatusOption(id="reopen", name="opened", category="todo"), StatusOption(id="close", name="closed", category="done")]

    async def dev_links(self, key: str) -> list[DevLink]:
        project, iid = await self._resolve(key)
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/projects/{project}/issues/{iid}/related_merge_requests")).json()
        return [
            DevLink(kind="pull_request", title=f"!{m.get('iid')} {m.get('title', '')}", url=m.get("web_url", ""), state=m.get("state"), ref=m.get("source_branch"))
            for m in rows
        ]

    async def mentions(self, since: str | None = None) -> list[Activity]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/todos", params={"state": "pending", "per_page": 50})).json()
        out = []
        for t in rows:
            if since and (t.get("created_at") or "") <= since:
                continue
            target = t.get("target") or {}
            ref = (target.get("references") or {}).get("full") or ""
            out.append(
                Activity(
                    kind=TODO_KINDS.get(t.get("action_name", ""), "update"),
                    key=ref,
                    title=target.get("title", "") or t.get("body", ""),
                    url=t.get("target_url") or target.get("web_url", ""),
                    at=t.get("created_at"),
                    actor=(t.get("author") or {}).get("name"),
                    text=(t.get("body") or "")[:300] or None,
                    id=str(t.get("id")),
                )
            )
        return out

    async def review_requests(self, limit: int = 30) -> list[Issue]:
        params: dict[str, Any] = {"state": "opened", "scope": "all", "per_page": min(limit, 100)}
        me = self._me()
        if me.get("username"):
            params["reviewer_username"] = me["username"]
        elif me.get("user_id"):
            params["reviewer_id"] = me["user_id"]
        else:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/merge_requests", params=params)).json()
        return [self._issue(r, "pull_request") for r in rows]

    async def sprint(self, project: str | None = None, mine: bool = False) -> tuple[str | None, list[Issue]]:
        params: dict[str, Any] = {"iteration_id": "Current", "state": "opened", "per_page": 100}
        params["scope"] = "assigned_to_me" if mine else "all"
        url = f"{self.base()}/projects/{quote(project, safe='')}/issues" if project else f"{self.base()}/issues"
        async with self.client() as c:
            rows = self.check(await c.get(url, params=params)).json()
        return tr("الـ iteration الحالية"), [self._issue(r) for r in rows]

    # -- writing -------------------------------------------------------------------------

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        project, iid = await self._resolve(key)
        async with self.client() as c:
            data = self.check(await c.post(f"{self.base()}/projects/{project}/issues/{iid}/notes", json={"body": body})).json()
        return str(data.get("id")) if data.get("id") else None

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        project, iid = await self._resolve(key)
        async with self.client() as c:
            self.check(await c.put(f"{self.base()}/projects/{project}/issues/{iid}/notes/{comment_id}", json={"body": body}))

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        project, iid = await self._resolve(key)
        async with self.client() as c:
            self.check(await c.delete(f"{self.base()}/projects/{project}/issues/{iid}/notes/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        status_id = {"closed": "close", "opened": "reopen", "open": "reopen"}.get(status_id, status_id)
        if status_id not in ("close", "reopen"):
            raise IntegrationError(tr("GitLab بيقبل close أو reopen بس."))
        project, iid = await self._resolve(key)
        async with self.client() as c:
            self.check(await c.put(f"{self.base()}/projects/{project}/issues/{iid}", json={"state_event": status_id}))
        return "closed" if status_id == "close" else "opened"

    async def complete(self, key: str) -> str:
        return await self.set_status(key, "close")

    async def _assignee_ids(self, value: str) -> list[int]:
        if value == "me":
            return [int(self._me()["user_id"])] if self._me().get("user_id") else []
        return [int(v) for v in value.split(",") if v.strip().isdigit()]

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        project = quote(draft.project, safe="")
        body: dict[str, Any] = {"title": draft.title, "description": draft.description or ""}
        if draft.labels:
            body["labels"] = ",".join(draft.labels)
        if draft.assignee:
            body["assignee_ids"] = await self._assignee_ids(draft.assignee)
        if draft.due_date:
            body["due_date"] = draft.due_date
        if draft.issue_type in ("issue", "incident", "test_case", "task"):
            body["issue_type"] = draft.issue_type
        async with self.client() as c:
            data = self.check(await c.post(f"{self.base()}/projects/{project}/issues", json=body)).json()
            iid = data.get("iid")
            if draft.estimate_hours:
                self.check(await c.post(f"{self.base()}/projects/{project}/issues/{iid}/time_estimate", params={"duration": f"{draft.estimate_hours:g}h"}))
        issue = self._issue(data)
        if draft.parent:
            # GitLab's REST API has no parent field for issues; a "relates to" link plus the
            # parent's task list is the official way to tie them.
            await self.link_issues(issue.key, draft.parent, "relates")
        return issue

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        project, iid = await self._resolve(key)
        body: dict[str, Any] = {}
        if changes.title is not None:
            body["title"] = changes.title
        if changes.description is not None:
            body["description"] = changes.description
        if changes.labels is not None:
            body["labels"] = ",".join(changes.labels)
        if changes.add_labels:
            body["add_labels"] = ",".join(changes.add_labels)
        if changes.remove_labels:
            body["remove_labels"] = ",".join(changes.remove_labels)
        if changes.assignee is not None:
            body["assignee_ids"] = await self._assignee_ids(changes.assignee) if changes.assignee else [0]
        if changes.due_date is not None:
            body["due_date"] = changes.due_date or None
        async with self.client() as c:
            if body:
                self.check(await c.put(f"{self.base()}/projects/{project}/issues/{iid}", json=body))
            if changes.estimate_hours is not None:
                self.check(await c.post(f"{self.base()}/projects/{project}/issues/{iid}/time_estimate", params={"duration": f"{changes.estimate_hours:g}h"}))
        if changes.parent:
            await self.link_issues(key, changes.parent, "relates")
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        self.guard_write()
        project, iid = await self._resolve(key)
        target_project, target_iid = await self._resolve(other)
        async with self.client() as c:
            self.check(
                await c.post(
                    f"{self.base()}/projects/{project}/issues/{iid}/links",
                    json={"target_project_id": target_project, "target_issue_iid": target_iid, "link_type": LINK_TYPES.get(kind, "relates_to")},
                )
            )

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        """Upload to the project, then post the Markdown link GitLab returns as a comment —
        that is how a file belongs to an issue on GitLab."""
        self.guard_write()
        project, _ = await self._resolve(key)
        async with self.client() as c:
            c.headers.pop("Content-Type", None)  # multipart sets its own
            up = self.check(await c.post(f"{self.base()}/projects/{project}/uploads", files={"file": (filename, data, mime)})).json()
        markdown = up.get("markdown") or f"[{filename}]({up.get('url', '')})"
        await self.add_comment(key, markdown)
        return f"{self.host()}{up['full_path']}" if up.get("full_path") else up.get("url")

    async def log_work(self, key: str, seconds: int, comment: str = "") -> None:
        self.guard_write()
        project, iid = await self._resolve(key)
        minutes = max(1, round(seconds / 60))
        async with self.client() as c:
            self.check(
                await c.post(f"{self.base()}/projects/{project}/issues/{iid}/add_spent_time", params={"duration": f"{minutes}m", "summary": comment[:255] or None})
            )

    async def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str) -> DevLink:
        self.guard_write()
        project = quote(repo, safe="")
        async with self.client() as c:
            resp = await c.post(
                f"{self.base()}/projects/{project}/merge_requests",
                json={"source_branch": head, "target_branch": base, "title": title, "description": body, "remove_source_branch": True},
            )
            if resp.status_code == 409:
                existing = self.check(
                    await c.get(f"{self.base()}/projects/{project}/merge_requests", params={"source_branch": head, "state": "opened"})
                ).json()
                if existing:
                    mr = existing[0]
                    return DevLink(kind="pull_request", title=f"!{mr.get('iid')} {mr.get('title', '')}", url=mr.get("web_url", ""), state="open", ref=head)
            data = self.check(resp).json()
        return DevLink(kind="pull_request", title=f"!{data.get('iid')} {data.get('title', '')}", url=data.get("web_url", ""), state="open", ref=head)

    def repo_for_remote(self, remote_url: str) -> str | None:
        host = re.escape(urlparse(self.host()).netloc)
        m = re.match(rf"^(?:https?://(?:[^@/]+@)?|git@|ssh://git@){host}(?::\d+)?[:/](.+?)(?:\.git)?/?$", remote_url.strip())
        return m.group(1) if m else None
