"""ClickUp tasks, through the v2 REST API and a personal token. A list is a project; its
statuses are ClickUp's own."""

from datetime import UTC, datetime
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

BASE = "https://api.clickup.com/api/v2"
PRIORITY = {"urgent": 1, "high": 2, "normal": 3, "medium": 3, "low": 4}
PRIORITY_NAMES = ["Urgent", "High", "Normal", "Low"]
CATEGORY = {"open": "todo", "custom": "in_progress", "done": "done", "closed": "done"}


def _ms(value: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(value) / 1000, UTC).isoformat()
    except (TypeError, ValueError):
        return None


def _to_ms(day: str) -> int:
    return int(datetime.fromisoformat(day).replace(tzinfo=UTC).timestamp() * 1000)


class ClickUpIntegration(Integration):
    spec = ProviderSpec(
        id="clickup",
        name="ClickUp",
        icon="clickup",
        color="#7B68EE",
        docs_url="https://app.clickup.com/settings/apps",
        blurb="مهام ClickUp المسندة إلك — حالات القائمة، مهام فرعية، اعتماديات، مرفقات، وتسجيل وقت.",
        secret="token",
        scopes="Personal API token (pk_…) من Settings ← Apps.",
        fields=[FieldSpec("token", "API token", "password", "pk_…")],
    )
    capabilities = frozenset({"create", "update", "subtasks", "link", "attach", "worklog", "comment_edit", "projects", "users", "search"})

    def headers(self) -> dict[str, str]:
        return {"Authorization": self.secret, "Accept": "application/json", "Content-Type": "application/json"}

    def _me(self) -> dict[str, Any]:
        return self.config.get("_account") or {}

    async def _get(self, path: str, **params: Any) -> Any:
        async with self.client() as c:
            return self.check(await c.get(f"{BASE}{path}", params=params)).json()

    async def _send(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        self.guard_write()
        async with self.client() as c:
            resp = self.check(await c.request(method, f"{BASE}{path}", json=body or {}))
            return resp.json() if resp.content else {}

    async def verify(self) -> Account:
        user = (await self._get("/user")).get("user") or {}
        teams = (await self._get("/team")).get("teams") or []
        return Account(
            label=f"{user.get('username', '')} ({user.get('email', '')})",
            meta={"user_id": user.get("id"), "teams": [t.get("id") for t in teams]},
        )

    async def _teams(self) -> list[str]:
        known = self._me().get("teams")
        if known:
            return [str(t) for t in known]
        return [str(t.get("id")) for t in (await self._get("/team")).get("teams") or []]

    @staticmethod
    def _issue(raw: dict[str, Any]) -> Issue:
        status = raw.get("status") or {}
        priority = raw.get("priority") or {}
        estimate = raw.get("time_estimate")
        return Issue(
            key=raw.get("custom_id") or raw.get("id", ""),
            id=raw.get("id", ""),
            title=raw.get("name", ""),
            url=raw.get("url", ""),
            status=status.get("status", ""),
            status_category=CATEGORY.get(status.get("type", ""), "todo"),
            project=(raw.get("list") or {}).get("name"),
            updated_at=_ms(raw.get("date_updated")),
            created_at=_ms(raw.get("date_created")),
            description=raw.get("markdown_description") or raw.get("text_content") or raw.get("description") or None,
            priority=(priority.get("priority") or "").title() or None,
            assignee=", ".join(a.get("username", "") for a in raw.get("assignees") or []) or None,
            reporter=(raw.get("creator") or {}).get("username"),
            labels=[t.get("name", "") for t in raw.get("tags") or []],
            due_date=(_ms(raw.get("due_date")) or "")[:10] or None,
            parent=raw.get("parent"),
            estimate=f"{round(int(estimate) / 3_600_000, 1)}h" if estimate else None,
            subtasks=[s.get("id", "") for s in raw.get("subtasks") or []],
            attachments=[{"name": a.get("title", ""), "url": a.get("url", "")} for a in raw.get("attachments") or []],
            links=[{"kind": "relates", "key": link.get("links_to", ""), "title": ""} for link in raw.get("linked_tasks") or []],
            extra={"list_id": (raw.get("list") or {}).get("id"), "team_id": raw.get("team_id")},
        )

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        me = self._me().get("user_id")
        issues: list[Issue] = []
        for team in await self._teams():
            params: dict[str, Any] = {"order_by": "updated", "subtasks": "true", "include_closed": str(include_done).lower()}
            if me:
                params["assignees[]"] = me
            rows = (await self._get(f"/team/{team}/task", **params)).get("tasks") or []
            issues.extend(self._issue(r) for r in rows)
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        return issues[:limit]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        """ClickUp's API has no free-text search; this filters the workspace's recent tasks."""
        q = query.lower()
        issues: list[Issue] = []
        for team in await self._teams():
            rows = (await self._get(f"/team/{team}/task", order_by="updated", subtasks="true", include_closed="true")).get("tasks") or []
            issues.extend(self._issue(r) for r in rows if q in (r.get("name", "") + " " + (r.get("text_content") or "")).lower())
        return issues[:limit]

    async def get_issue(self, key: str) -> Issue:
        params: dict[str, Any] = {"include_subtasks": "true", "include_markdown_description": "true"}
        if not key.isalnum() or "-" in key:
            teams = await self._teams()
            params.update({"custom_task_ids": "true", "team_id": teams[0] if teams else ""})
        return self._issue(await self._get(f"/task/{key}", **params))

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        issue = await self.get_issue(key)
        rows = (await self._get(f"/task/{issue.id}/comment")).get("comments") or []
        me = self._me().get("user_id")
        return [
            IssueComment(
                id=str(c_.get("id")),
                author=(c_.get("user") or {}).get("username", ""),
                body=c_.get("comment_text", ""),
                created_at=_ms(c_.get("date")),
                mine=bool(me) and (c_.get("user") or {}).get("id") == me,
            )
            for c_ in rows[:limit]
        ]

    async def list_projects(self) -> list[Project]:
        out: list[Project] = []
        for team in await self._teams():
            for space in (await self._get(f"/team/{team}/space", archived="false")).get("spaces") or []:
                for lst in (await self._get(f"/space/{space['id']}/list", archived="false")).get("lists") or []:
                    out.append(Project(id=lst["id"], key=lst["id"], name=f"{space.get('name', '')} / {lst.get('name', '')}"))
                for folder in (await self._get(f"/space/{space['id']}/folder", archived="false")).get("folders") or []:
                    for lst in folder.get("lists") or []:
                        out.append(Project(id=lst["id"], key=lst["id"], name=f"{space.get('name', '')} / {folder.get('name', '')} / {lst.get('name', '')}"))
        return out

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        if not project:
            return []
        rows = (await self._get(f"/list/{project}/member")).get("members") or []
        return [Person(id=str(m.get("id")), name=m.get("username", ""), handle=m.get("email")) for m in rows if query.lower() in m.get("username", "").lower()]

    async def list_priorities(self) -> list[str]:
        return PRIORITY_NAMES

    async def list_statuses(self, key: str) -> list[StatusOption]:
        issue = await self.get_issue(key)
        data = await self._get(f"/list/{issue.extra.get('list_id')}")
        return [StatusOption(id=s.get("status", ""), name=s.get("status", ""), category=CATEGORY.get(s.get("type", ""), "todo")) for s in data.get("statuses") or []]

    async def add_comment(self, key: str, body: str) -> str | None:
        issue = await self.get_issue(key)
        data = await self._send("POST", f"/task/{issue.id}/comment", {"comment_text": body, "notify_all": False})
        return str(data.get("id")) if data.get("id") else None

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        await self._send("PUT", f"/comment/{comment_id}", {"comment_text": body})

    async def delete_comment(self, key: str, comment_id: str) -> None:
        await self._send("DELETE", f"/comment/{comment_id}")

    async def set_status(self, key: str, status_id: str) -> str:
        issue = await self.get_issue(key)
        data = await self._send("PUT", f"/task/{issue.id}", {"status": status_id})
        return (data.get("status") or {}).get("status", status_id)

    async def complete(self, key: str) -> str:
        options = await self.list_statuses(key)
        done = next((o for o in reversed(options) if o.category == "done"), None)
        if not done:
            raise IntegrationError(tr("ما في حالة «مكتمل» بهالقائمة."))
        return await self.set_status(key, done.id)

    def _assignee(self, value: str) -> int | None:
        if value == "me":
            return self._me().get("user_id")
        return int(value) if value.isdigit() else None

    def _body(self, *, title: str | None, description: str | None, priority: str | None, due: str | None, estimate: float | None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if title is not None:
            body["name"] = title
        if description is not None:
            body["markdown_description"] = description
        if priority:
            body["priority"] = PRIORITY.get(priority.lower(), 3)
        if due is not None:
            body["due_date"] = _to_ms(due) if due else None
        if estimate is not None:
            body["time_estimate"] = int(estimate * 3_600_000)
        return body

    async def create_issue(self, draft: IssueDraft) -> Issue:
        body = self._body(title=draft.title, description=draft.description, priority=draft.priority, due=draft.due_date, estimate=draft.estimate_hours)
        list_id = draft.project
        if draft.parent:
            parent = await self.get_issue(draft.parent)
            body["parent"] = parent.id
            list_id = parent.extra.get("list_id") or list_id
        if draft.assignee and (who := self._assignee(draft.assignee)):
            body["assignees"] = [who]
        if draft.labels:
            body["tags"] = draft.labels
        data = await self._send("POST", f"/list/{list_id}/task", body)
        return await self.get_issue(data["id"])

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        issue = await self.get_issue(key)
        body = self._body(title=changes.title, description=changes.description, priority=changes.priority, due=changes.due_date, estimate=changes.estimate_hours)
        if changes.assignee is not None:
            current = await self._get(f"/task/{issue.id}")
            rem = [a.get("id") for a in current.get("assignees") or []]
            add = [w] if (w := self._assignee(changes.assignee)) else []
            body["assignees"] = {"add": add, "rem": [r for r in rem if r not in add]}
        if changes.parent:
            body["parent"] = (await self.get_issue(changes.parent)).id
        if body:
            await self._send("PUT", f"/task/{issue.id}", body)
        add = list(changes.add_labels)
        remove = list(changes.remove_labels)
        if changes.labels is not None:
            add = [x for x in changes.labels if x not in issue.labels]
            remove = [x for x in issue.labels if x not in changes.labels]
        for tag in add:
            await self._send("POST", f"/task/{issue.id}/tag/{tag}")
        for tag in remove:
            await self._send("DELETE", f"/task/{issue.id}/tag/{tag}")
        return await self.get_issue(issue.id)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        a, b = (await self.get_issue(key)).id, (await self.get_issue(other)).id
        if kind == "blocked_by":
            await self._send("POST", f"/task/{a}/dependency", {"depends_on": b})
        elif kind == "blocks":
            await self._send("POST", f"/task/{a}/dependency", {"dependency_of": b})
        else:
            await self._send("POST", f"/task/{a}/link/{b}")

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        issue = await self.get_issue(key)
        async with self.client() as c:
            c.headers.pop("Content-Type", None)
            up = self.check(await c.post(f"{BASE}/task/{issue.id}/attachment", files={"attachment": (filename, data, mime)})).json()
        return up.get("url")

    async def log_work(self, key: str, seconds: int, comment: str = "") -> None:
        issue = await self.get_issue(key)
        team = issue.extra.get("team_id") or (await self._teams() or [""])[0]
        now = int(datetime.now(UTC).timestamp() * 1000)
        await self._send(
            "POST",
            f"/team/{team}/time_entries",
            {"tid": issue.id, "duration": int(seconds * 1000), "start": now - int(seconds * 1000), "description": comment[:500]},
        )
