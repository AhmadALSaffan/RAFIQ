"""Asana tasks, through the REST API and a personal access token. A project's sections are
its statuses; dependencies are its links."""

from typing import Any

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    Account,
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

BASE = "https://app.asana.com/api/1.0"
TASK_FIELDS = (
    "name,notes,permalink_url,completed,modified_at,created_at,due_on,assignee.name,created_by.name,"
    "tags.name,parent.gid,memberships.project.name,memberships.section.name,num_subtasks,projects.name"
)


class AsanaIntegration(Integration):
    spec = ProviderSpec(
        id="asana",
        name="Asana",
        icon="asana",
        color="#F06A6A",
        docs_url="https://app.asana.com/0/my-apps",
        blurb="مهام Asana المسندة إلك — الأقسام كحالات، مهام فرعية، اعتماديات، ومرفقات.",
        secret="token",
        scopes="Personal access token من صفحة My apps.",
        fields=[FieldSpec("token", "Personal access token", "password", "")],
    )
    capabilities = frozenset({"search", "create", "update", "subtasks", "link", "attach", "comment_edit", "projects", "users"})

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.secret}", "Accept": "application/json", "Content-Type": "application/json"}

    def _me(self) -> dict[str, Any]:
        return self.config.get("_account") or {}

    async def _get(self, path: str, **params: Any) -> Any:
        async with self.client() as c:
            return self.check(await c.get(f"{BASE}{path}", params=params)).json().get("data")

    async def _send(self, method: str, path: str, data: dict[str, Any] | None = None) -> Any:
        self.guard_write()
        async with self.client() as c:
            resp = await c.request(method, f"{BASE}{path}", json={"data": data or {}})
            return self.check(resp).json().get("data")

    async def verify(self) -> Account:
        data = await self._get("/users/me", opt_fields="name,email,workspaces.name")
        return Account(
            label=f"{data.get('name', '')} ({data.get('email', '')})",
            meta={"user_id": data.get("gid"), "workspaces": [w.get("gid") for w in data.get("workspaces") or []]},
        )

    async def _workspaces(self) -> list[str]:
        known = self._me().get("workspaces")
        if known:
            return list(known)
        data = await self._get("/users/me", opt_fields="workspaces")
        return [w.get("gid") for w in data.get("workspaces") or []]

    @staticmethod
    def _issue(raw: dict[str, Any]) -> Issue:
        membership = (raw.get("memberships") or [{}])[0] if raw.get("memberships") else {}
        section = (membership.get("section") or {}).get("name", "")
        done = bool(raw.get("completed"))
        return Issue(
            key=raw.get("gid", ""),
            id=raw.get("gid", ""),
            title=raw.get("name", ""),
            url=raw.get("permalink_url", ""),
            status=tr("مكتملة") if done else (section or tr("مفتوحة")),
            status_category="done" if done else "todo",
            project=(membership.get("project") or {}).get("name") or ", ".join(p.get("name", "") for p in raw.get("projects") or []) or None,
            updated_at=raw.get("modified_at"),
            created_at=raw.get("created_at"),
            description=raw.get("notes") or None,
            assignee=(raw.get("assignee") or {}).get("name"),
            reporter=(raw.get("created_by") or {}).get("name"),
            labels=[t.get("name", "") for t in raw.get("tags") or []],
            due_date=raw.get("due_on"),
            parent=(raw.get("parent") or {}).get("gid"),
            extra={"project_gid": (membership.get("project") or {}).get("gid"), "subtasks": raw.get("num_subtasks")},
        )

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        issues: list[Issue] = []
        for ws in await self._workspaces():
            params: dict[str, Any] = {"assignee": "me", "workspace": ws, "opt_fields": TASK_FIELDS, "limit": min(limit, 100)}
            if not include_done:
                params["completed_since"] = "now"
            try:
                rows = await self._get("/tasks", **params)
            except IntegrationError:
                continue
            issues.extend(self._issue(r) for r in rows or [])
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower()]
        issues.sort(key=lambda i: i.updated_at or "", reverse=True)
        return issues[:limit]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        issues: list[Issue] = []
        for ws in await self._workspaces():
            try:
                rows = await self._get(f"/workspaces/{ws}/tasks/search", text=query, opt_fields=TASK_FIELDS, limit=min(limit, 100))
            except IntegrationError:
                # Search is a paid-plan feature; fall back to the user's own tasks.
                rows = []
            issues.extend(self._issue(r) for r in rows or [])
        if not issues:
            return await self.list_issues(query, limit, include_done=True)
        return issues[:limit]

    async def get_issue(self, key: str) -> Issue:
        if not key.isdigit():
            raise IntegrationError(tr("معرّف مهمة Asana لازم يكون رقم."))
        raw = await self._get(f"/tasks/{key}", opt_fields=TASK_FIELDS)
        issue = self._issue(raw)
        if raw.get("num_subtasks"):
            subs = await self._get(f"/tasks/{key}/subtasks", opt_fields="name,completed")
            issue.subtasks = [f"{'☑' if s.get('completed') else '☐'} {s.get('name', '')} ({s.get('gid')})" for s in subs or []]
        deps = await self._get(f"/tasks/{key}/dependencies", opt_fields="name")
        issue.links = [{"kind": "blocked_by", "key": d.get("gid", ""), "title": d.get("name", "")} for d in deps or []]
        return issue

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        rows = await self._get(f"/tasks/{key}/stories", opt_fields="type,text,created_by.name,created_by.gid,created_at", limit=100)
        me = self._me().get("user_id")
        comments = [
            IssueComment(
                id=s.get("gid"),
                author=(s.get("created_by") or {}).get("name", ""),
                body=s.get("text", ""),
                created_at=s.get("created_at"),
                mine=bool(me) and (s.get("created_by") or {}).get("gid") == me,
            )
            for s in rows or []
            if s.get("type") == "comment"
        ]
        return comments[-limit:]

    async def list_projects(self) -> list[Project]:
        out: list[Project] = []
        for ws in await self._workspaces():
            rows = await self._get("/projects", workspace=ws, archived="false", opt_fields="name,permalink_url", limit=100)
            out.extend(Project(id=p["gid"], key=p["gid"], name=p.get("name", ""), url=p.get("permalink_url")) for p in rows or [])
        return out

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        out: list[Person] = []
        for ws in await self._workspaces():
            rows = await self._get("/users", workspace=ws, opt_fields="name,email", limit=100)
            out.extend(Person(id=u["gid"], name=u.get("name", ""), handle=u.get("email")) for u in rows or [] if query.lower() in u.get("name", "").lower())
        return out

    async def list_statuses(self, key: str) -> list[StatusOption]:
        issue = await self.get_issue(key)
        options = [StatusOption(id="__done__", name=tr("مكتملة"), category="done"), StatusOption(id="__open__", name=tr("مفتوحة"), category="todo")]
        if project := issue.extra.get("project_gid"):
            rows = await self._get(f"/projects/{project}/sections", opt_fields="name")
            options += [StatusOption(id=s["gid"], name=s.get("name", ""), category="todo") for s in rows or []]
        return options

    async def add_comment(self, key: str, body: str) -> str | None:
        data = await self._send("POST", f"/tasks/{key}/stories", {"text": body})
        return (data or {}).get("gid")

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        await self._send("PUT", f"/stories/{comment_id}", {"text": body})

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(await c.delete(f"{BASE}/stories/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        if status_id in ("__done__", "__open__"):
            await self._send("PUT", f"/tasks/{key}", {"completed": status_id == "__done__"})
            return tr("مكتملة") if status_id == "__done__" else tr("مفتوحة")
        await self._send("POST", f"/sections/{status_id}/addTask", {"task": key})
        target = next((o for o in await self.list_statuses(key) if o.id == status_id), None)
        return target.name if target else status_id

    async def complete(self, key: str) -> str:
        return await self.set_status(key, "__done__")

    def _assignee(self, value: str) -> str | None:
        return "me" if value == "me" else (value or None)

    async def create_issue(self, draft: IssueDraft) -> Issue:
        data: dict[str, Any] = {"name": draft.title, "notes": draft.description or ""}
        if draft.assignee:
            data["assignee"] = self._assignee(draft.assignee)
        if draft.due_date:
            data["due_on"] = draft.due_date
        if draft.parent:
            created = await self._send("POST", f"/tasks/{draft.parent}/subtasks", data)
        else:
            data["projects"] = [draft.project]
            created = await self._send("POST", "/tasks", data)
        return await self.get_issue(created["gid"])

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        data: dict[str, Any] = {}
        if changes.title is not None:
            data["name"] = changes.title
        if changes.description is not None:
            data["notes"] = changes.description
        if changes.assignee is not None:
            data["assignee"] = self._assignee(changes.assignee)
        if changes.due_date is not None:
            data["due_on"] = changes.due_date or None
        if data:
            await self._send("PUT", f"/tasks/{key}", data)
        if changes.parent:
            await self._send("POST", f"/tasks/{key}/setParent", {"parent": changes.parent})
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        if kind == "blocked_by":
            await self._send("POST", f"/tasks/{key}/addDependencies", {"dependencies": [other]})
        elif kind == "blocks":
            await self._send("POST", f"/tasks/{key}/addDependents", {"dependents": [other]})
        else:
            target = await self.get_issue(other)
            await self.add_comment(key, f"{kind}: {target.title} — {target.url}")

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        async with self.client() as c:
            c.headers.pop("Content-Type", None)
            up = self.check(
                await c.post(f"{BASE}/attachments", data={"parent": key}, files={"file": (filename, data, mime)})
            ).json().get("data") or {}
        return up.get("permanent_url") or up.get("view_url")

