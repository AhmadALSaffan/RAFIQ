"""Plane (plane.so or self-hosted), through its REST API v1 and an API key."""

import re
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
from rafiq_agent.integrations.markup import html_to_markdown, markdown_to_html

CATEGORY = {"backlog": "todo", "unstarted": "todo", "started": "in_progress", "completed": "done", "cancelled": "done"}
PRIORITIES = ["urgent", "high", "medium", "low", "none"]


class PlaneIntegration(Integration):
    spec = ProviderSpec(
        id="plane",
        name="Plane",
        icon="",
        color="#3F76FF",
        docs_url="https://docs.plane.so/api-reference/introduction",
        blurb="مهام Plane — الحالات، الأولويات، المهام الفرعية، والتعليقات.",
        secret="api_key",
        scopes="API token من Workspace settings ← API tokens.",
        fields=[
            FieldSpec("base_url", "رابط Plane", "url", "https://api.plane.so", required=False),
            FieldSpec("workspace", "الـ workspace slug", "text", "my-team"),
            FieldSpec("api_key", "API token", "password", "plane_api_…"),
        ],
    )
    capabilities = frozenset({"create", "update", "subtasks", "comment_edit", "projects", "users", "search"})

    def headers(self) -> dict[str, str]:
        return {"X-API-Key": self.secret, "Accept": "application/json", "Content-Type": "application/json"}

    def base(self) -> str:
        return str(self.config.get("base_url") or "https://api.plane.so").rstrip("/") + "/api/v1"

    def ws(self) -> str:
        return f"{self.base()}/workspaces/{self.config.get('workspace', '')}"

    def web(self) -> str:
        host = str(self.config.get("base_url") or "https://app.plane.so").rstrip("/").replace("://api.", "://app.")
        return f"{host}/{self.config.get('workspace', '')}"

    def _me(self) -> dict[str, Any]:
        return self.config.get("_account") or {}

    async def _get(self, url: str, **params: Any) -> Any:
        async with self.client() as c:
            data = self.check(await c.get(url, params=params)).json()
        return data.get("results", data) if isinstance(data, dict) and "results" in data else data

    async def _send(self, method: str, url: str, body: dict[str, Any] | None = None) -> Any:
        self.guard_write()
        async with self.client() as c:
            resp = self.check(await c.request(method, url, json=body or {}))
        return resp.json() if resp.content else {}

    async def verify(self) -> Account:
        data = await self._get(f"{self.base()}/users/me/")
        return Account(label=f"{data.get('display_name') or data.get('first_name', '')} ({data.get('email', '')})", meta={"user_id": data.get("id")})

    async def _projects(self) -> list[dict[str, Any]]:
        return await self._get(f"{self.ws()}/projects/")

    async def _states(self, project: str) -> dict[str, dict[str, Any]]:
        rows = await self._get(f"{self.ws()}/projects/{project}/states/")
        return {s["id"]: s for s in rows}

    def _issue(self, raw: dict[str, Any], project: dict[str, Any], states: dict[str, dict[str, Any]]) -> Issue:
        state = states.get(raw.get("state") or "", {})
        ident = f"{project.get('identifier', '')}-{raw.get('sequence_id')}"
        return Issue(
            key=ident,
            id=raw.get("id", ""),
            title=raw.get("name", ""),
            url=f"{self.web()}/projects/{project.get('id')}/issues/{raw.get('id')}",
            status=state.get("name", ""),
            status_category=CATEGORY.get(state.get("group", ""), "todo"),
            project=project.get("name"),
            updated_at=raw.get("updated_at"),
            created_at=raw.get("created_at"),
            description=html_to_markdown(raw.get("description_html")) or None,
            priority=(raw.get("priority") or "").title() or None,
            due_date=raw.get("target_date"),
            parent=raw.get("parent"),
            estimate=str(raw.get("estimate_point")) if raw.get("estimate_point") else None,
            extra={"project_id": project.get("id")},
        )

    async def _project_issues(self, project: dict[str, Any], limit: int) -> list[Issue]:
        states = await self._states(project["id"])
        rows = await self._get(f"{self.ws()}/projects/{project['id']}/issues/", per_page=min(limit, 100), order_by="-updated_at")
        me = self._me().get("user_id")
        out = []
        for r in rows:
            issue = self._issue(r, project, states)
            issue.extra["mine"] = bool(me) and me in (r.get("assignees") or [])
            out.append(issue)
        return out

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        issues: list[Issue] = []
        for project in (await self._projects())[:10]:
            issues.extend(i for i in await self._project_issues(project, 100) if i.extra.get("mine"))
        if not include_done:
            issues = [i for i in issues if i.status_category != "done"]
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        issues.sort(key=lambda i: i.updated_at or "", reverse=True)
        return issues[:limit]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        q = query.lower()
        out: list[Issue] = []
        for project in (await self._projects())[:10]:
            out.extend(i for i in await self._project_issues(project, 100) if q in i.title.lower() or q in i.key.lower())
        return out[:limit]

    async def _locate(self, key: str) -> tuple[dict[str, Any], dict[str, Any]]:
        m = re.match(r"^([A-Za-z0-9]+)-(\d+)$", key.strip())
        if not m:
            raise IntegrationError(tr("صيغة المهمة لازم تكون PROJ-12"))
        project = next((p for p in await self._projects() if p.get("identifier", "").upper() == m.group(1).upper()), None)
        if not project:
            raise IntegrationError(tr("ما لقيت مشروع {0} على Plane.", m.group(1)))
        rows = await self._get(f"{self.ws()}/projects/{project['id']}/issues/", per_page=100)
        raw = next((r for r in rows if str(r.get("sequence_id")) == m.group(2)), None)
        if raw is None:
            raise IntegrationError(tr("ما لقيت المهمة {0}", key))
        return project, raw

    async def get_issue(self, key: str) -> Issue:
        project, raw = await self._locate(key)
        return self._issue(raw, project, await self._states(project["id"]))

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        project, raw = await self._locate(key)
        rows = await self._get(f"{self.ws()}/projects/{project['id']}/issues/{raw['id']}/comments/")
        me = self._me().get("user_id")
        return [
            IssueComment(id=r.get("id"), author=(r.get("actor_detail") or {}).get("display_name", ""), body=html_to_markdown(r.get("comment_html")),
                         created_at=r.get("created_at"), mine=bool(me) and r.get("actor") == me)
            for r in rows[-limit:]
        ]

    async def list_projects(self) -> list[Project]:
        return [Project(id=p["id"], key=p.get("identifier", ""), name=p.get("name", "")) for p in await self._projects()]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        rows = await self._get(f"{self.ws()}/members/")
        out = []
        for r in rows:
            member = r.get("member") if isinstance(r.get("member"), dict) else r
            name = member.get("display_name") or member.get("first_name", "")
            if query.lower() in name.lower():
                out.append(Person(id=member.get("id", ""), name=name, handle=member.get("email")))
        return out

    async def list_priorities(self) -> list[str]:
        return [p.title() for p in PRIORITIES]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        project, _ = await self._locate(key)
        return [StatusOption(id=s["id"], name=s.get("name", ""), category=CATEGORY.get(s.get("group", ""))) for s in (await self._states(project["id"])).values()]

    async def add_comment(self, key: str, body: str) -> str | None:
        project, raw = await self._locate(key)
        data = await self._send("POST", f"{self.ws()}/projects/{project['id']}/issues/{raw['id']}/comments/", {"comment_html": markdown_to_html(body)})
        return data.get("id")

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        project, raw = await self._locate(key)
        await self._send("PATCH", f"{self.ws()}/projects/{project['id']}/issues/{raw['id']}/comments/{comment_id}/", {"comment_html": markdown_to_html(body)})

    async def delete_comment(self, key: str, comment_id: str) -> None:
        project, raw = await self._locate(key)
        await self._send("DELETE", f"{self.ws()}/projects/{project['id']}/issues/{raw['id']}/comments/{comment_id}/")

    async def set_status(self, key: str, status_id: str) -> str:
        project, raw = await self._locate(key)
        states = await self._states(project["id"])
        target = states.get(status_id) or next((s for s in states.values() if s.get("name", "").lower() == status_id.lower()), None)
        if not target:
            raise IntegrationError(tr("هالحالة مو موجودة بالمشروع."))
        await self._send("PATCH", f"{self.ws()}/projects/{project['id']}/issues/{raw['id']}/", {"state": target["id"]})
        return target.get("name", "")

    async def complete(self, key: str) -> str:
        project, _ = await self._locate(key)
        done = next((s for s in (await self._states(project["id"])).values() if s.get("group") == "completed"), None)
        if not done:
            raise IntegrationError(tr("ما في حالة «مكتمل» بهالمشروع."))
        return await self.set_status(key, done["id"])

    def _body(self, *, title: str | None, description: str | None, priority: str | None, due: str | None, assignee: str | None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if title is not None:
            body["name"] = title
        if description is not None:
            body["description_html"] = markdown_to_html(description) or "<p></p>"
        if priority:
            body["priority"] = priority.lower() if priority.lower() in PRIORITIES else "medium"
        if due is not None:
            body["target_date"] = due or None
        if assignee is not None:
            who = self._me().get("user_id") if assignee == "me" else assignee
            body["assignees"] = [who] if who else []
        return body

    async def create_issue(self, draft: IssueDraft) -> Issue:
        project = next((p for p in await self._projects() if draft.project in (p.get("id"), p.get("identifier")) or p.get("name", "").lower() == draft.project.lower()), None)
        if not project:
            raise IntegrationError(tr("ما لقيت مشروع «{0}».", draft.project))
        body = self._body(title=draft.title, description=draft.description, priority=draft.priority, due=draft.due_date, assignee=draft.assignee)
        if draft.parent:
            _, parent = await self._locate(draft.parent)
            body["parent"] = parent["id"]
        data = await self._send("POST", f"{self.ws()}/projects/{project['id']}/issues/", body)
        return self._issue(data, project, await self._states(project["id"]))

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        project, raw = await self._locate(key)
        body = self._body(title=changes.title, description=changes.description, priority=changes.priority, due=changes.due_date, assignee=changes.assignee)
        if changes.parent:
            _, parent = await self._locate(changes.parent)
            body["parent"] = parent["id"]
        if body:
            await self._send("PATCH", f"{self.ws()}/projects/{project['id']}/issues/{raw['id']}/", body)
        return await self.get_issue(key)
