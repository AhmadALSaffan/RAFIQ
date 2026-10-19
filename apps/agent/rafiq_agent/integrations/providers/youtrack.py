"""YouTrack (Cloud or Server), through the REST API and a permanent token. Changes go
through YouTrack's own command API, so they follow each project's workflow rules."""

from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

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

ISSUE_FIELDS = (
    "id,idReadable,summary,description,created,updated,resolved,project(id,name,shortName),"
    "reporter(fullName,login),tags(name),commentsCount,"
    "customFields(name,value(name,login,fullName,presentation,minutes,isResolved)),"
    "subtasks(issues(idReadable)),parent(issues(idReadable)),links(direction,linkType(name,sourceToTarget,targetToSource),issues(idReadable,summary)),"
    "attachments(name,url,size,mimeType)"
)
COMMANDS = {"relates": "relates to", "blocks": "is required for", "blocked_by": "depends on", "duplicates": "duplicates"}


def _iso(ms: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, UTC).isoformat()
    except (TypeError, ValueError):
        return None


class YouTrackIntegration(Integration):
    spec = ProviderSpec(
        id="youtrack",
        name="YouTrack",
        icon="youtrack",
        color="#000000",
        docs_url="https://www.jetbrains.com/help/youtrack/server/manage-permanent-token.html",
        blurb="مهام YouTrack — استعلامات YouTrack، أوامر، مهام فرعية، روابط، مرفقات، ووقت.",
        secret="token",
        scopes="Permanent token بنطاق YouTrack.",
        fields=[
            FieldSpec("base_url", "رابط YouTrack", "url", "https://your-team.youtrack.cloud"),
            FieldSpec("token", "Permanent token", "password", "perm:…"),
        ],
    )
    capabilities = frozenset({"search", "create", "update", "subtasks", "link", "attach", "worklog", "comment_edit", "projects", "users"})

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.secret}", "Accept": "application/json", "Content-Type": "application/json"}

    def base(self) -> str:
        return str(self.config.get("base_url", "")).rstrip("/") + "/api"

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/users/me", params={"fields": "id,login,fullName,email"})).json()
        return Account(label=f"{data.get('fullName', '')} ({data.get('email') or data.get('login', '')})", meta={"user_id": data.get("id"), "login": data.get("login")})

    def _issue(self, raw: dict[str, Any]) -> Issue:
        fields = {f.get("name"): f.get("value") for f in raw.get("customFields") or []}

        def name(value: Any) -> str | None:
            if isinstance(value, dict):
                return value.get("name") or value.get("fullName") or value.get("presentation")
            if isinstance(value, list):
                return ", ".join(filter(None, (name(v) for v in value))) or None
            return str(value) if value is not None else None

        state = fields.get("State")
        resolved = bool(raw.get("resolved")) or (isinstance(state, dict) and state.get("isResolved"))
        estimate = fields.get("Estimation")
        key = raw.get("idReadable", "")
        links = []
        for link in raw.get("links") or []:
            label = ((link.get("linkType") or {}).get("sourceToTarget") if link.get("direction") != "INWARD" else (link.get("linkType") or {}).get("targetToSource")) or ""
            for other in link.get("issues") or []:
                links.append({"kind": label, "key": other.get("idReadable", ""), "title": other.get("summary", "")})
        return Issue(
            key=key,
            id=raw.get("id", key),
            title=raw.get("summary", ""),
            url=f"{self.base()[:-4]}/issue/{key}",
            status=name(state) or "",
            status_category="done" if resolved else ("in_progress" if name(state) and "progress" in (name(state) or "").lower() else "todo"),
            project=(raw.get("project") or {}).get("name"),
            updated_at=_iso(raw.get("updated")),
            created_at=_iso(raw.get("created")),
            description=raw.get("description"),
            priority=name(fields.get("Priority")),
            issue_type=name(fields.get("Type")),
            assignee=name(fields.get("Assignee")),
            reporter=(raw.get("reporter") or {}).get("fullName"),
            labels=[t.get("name", "") for t in raw.get("tags") or []],
            due_date=(_iso(fields.get("Due Date")) or "")[:10] or None,
            estimate=(estimate or {}).get("presentation") if isinstance(estimate, dict) else None,
            comment_count=raw.get("commentsCount"),
            subtasks=[i.get("idReadable", "") for i in ((raw.get("subtasks") or {}).get("issues") or [])],
            parent=next((i.get("idReadable") for i in ((raw.get("parent") or {}).get("issues") or [])), None),
            links=links,
            attachments=[{"name": a.get("name", ""), "url": f"{self.base()[:-4]}{a.get('url', '')}", "size": a.get("size"), "mime": a.get("mimeType")} for a in raw.get("attachments") or []],
            extra={"project_id": (raw.get("project") or {}).get("id"), "short": (raw.get("project") or {}).get("shortName")},
        )

    async def _query(self, query: str, limit: int) -> list[Issue]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/issues", params={"query": query, "fields": ISSUE_FIELDS, "$top": limit})).json()
        return [self._issue(r) for r in rows]

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        q = "for: me" + ("" if include_done else " #Unresolved") + (f" {query}" if query else "") + " sort by: updated desc"
        return await self._query(q, limit)

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        return await self._query(query, limit)

    async def get_issue(self, key: str) -> Issue:
        async with self.client() as c:
            raw = self.check(await c.get(f"{self.base()}/issues/{quote(key)}", params={"fields": ISSUE_FIELDS})).json()
        return self._issue(raw)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        me = (self.config.get("_account") or {}).get("login")
        async with self.client() as c:
            rows = self.check(
                await c.get(f"{self.base()}/issues/{quote(key)}/comments", params={"fields": "id,text,created,author(fullName,login)", "$top": limit})
            ).json()
        return [
            IssueComment(
                id=r.get("id"), author=(r.get("author") or {}).get("fullName", ""), body=r.get("text", ""),
                created_at=_iso(r.get("created")), mine=bool(me) and (r.get("author") or {}).get("login") == me,
            )
            for r in rows
        ]

    async def list_projects(self) -> list[Project]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/admin/projects", params={"fields": "id,name,shortName", "$top": 200})).json()
        return [Project(id=p.get("id", ""), key=p.get("shortName", ""), name=p.get("name", "")) for p in rows]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/users", params={"fields": "id,login,fullName,email", "query": query, "$top": 50})).json()
        return [Person(id=u.get("login", ""), name=u.get("fullName", ""), handle=u.get("email") or u.get("login")) for u in rows]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        async with self.client() as c:
            fields = self.check(
                await c.get(
                    f"{self.base()}/issues/{quote(key)}/customFields",
                    params={"fields": "name,projectCustomField(bundle(values(name,isResolved)))"},
                )
            ).json()
        state = next((f for f in fields if f.get("name") == "State"), None)
        values = (((state or {}).get("projectCustomField") or {}).get("bundle") or {}).get("values") or []
        return [StatusOption(id=v.get("name", ""), name=v.get("name", ""), category="done" if v.get("isResolved") else "todo") for v in values]

    async def _command(self, key: str, command: str, comment: str | None = None) -> None:
        self.guard_write()
        body: dict[str, Any] = {"query": command, "issues": [{"idReadable": key}]}
        if comment:
            body["comment"] = comment
        async with self.client() as c:
            self.check(await c.post(f"{self.base()}/commands", json=body))

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        async with self.client() as c:
            data = self.check(await c.post(f"{self.base()}/issues/{quote(key)}/comments", params={"fields": "id"}, json={"text": body})).json()
        return data.get("id")

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(await c.post(f"{self.base()}/issues/{quote(key)}/comments/{comment_id}", json={"text": body}))

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(await c.delete(f"{self.base()}/issues/{quote(key)}/comments/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        await self._command(key, f"State {status_id}")
        return (await self.get_issue(key)).status

    async def complete(self, key: str) -> str:
        options = await self.list_statuses(key)
        done = next((o for o in options if o.category == "done" and o.name.lower() in ("fixed", "done", "verified", "resolved")), None) or next(
            (o for o in options if o.category == "done"), None
        )
        if not done:
            raise IntegrationError(tr("ما في حالة «مكتمل» بهالمشروع."))
        return await self.set_status(key, done.id)

    def _commands(self, *, assignee: str | None, priority: str | None, due: str | None, estimate: float | None,
                  issue_type: str | None, labels: list[str], parent: str | None) -> list[str]:
        out = []
        if assignee is not None:
            out.append("for me" if assignee == "me" else (f"for {assignee}" if assignee else "for Unassigned"))
        if priority:
            out.append(f"Priority {priority}")
        if due:
            out.append(f"Due Date {due}")
        if estimate is not None:
            out.append(f"Estimation {estimate:g}h")
        if issue_type:
            out.append(f"Type {issue_type}")
        out += [f"tag {label}" for label in labels]
        if parent:
            out.append(f"subtask of {parent}")
        return out

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        projects = await self.list_projects()
        project = next((p for p in projects if draft.project in (p.id, p.key) or p.name.lower() == draft.project.lower()), None)
        if not project:
            raise IntegrationError(tr("ما لقيت مشروع «{0}».", draft.project))
        async with self.client() as c:
            data = self.check(
                await c.post(
                    f"{self.base()}/issues",
                    params={"fields": "idReadable"},
                    json={"project": {"id": project.id}, "summary": draft.title, "description": draft.description or ""},
                )
            ).json()
        key = data.get("idReadable", "")
        for command in self._commands(
            assignee=draft.assignee, priority=draft.priority, due=draft.due_date, estimate=draft.estimate_hours,
            issue_type=draft.issue_type, labels=draft.labels, parent=draft.parent,
        ):
            try:
                await self._command(key, command)
            except IntegrationError:
                continue  # a field this project doesn't have; the issue itself is made
        return await self.get_issue(key)

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        body: dict[str, Any] = {}
        if changes.title is not None:
            body["summary"] = changes.title
        if changes.description is not None:
            body["description"] = changes.description
        if body:
            async with self.client() as c:
                self.check(await c.post(f"{self.base()}/issues/{quote(key)}", json=body))
        labels = list(changes.add_labels)
        if changes.labels is not None:
            current = (await self.get_issue(key)).labels
            labels = [x for x in changes.labels if x not in current]
            for x in current:
                if x not in changes.labels:
                    await self._command(key, f"untag {x}")
        for x in changes.remove_labels:
            await self._command(key, f"untag {x}")
        for command in self._commands(
            assignee=changes.assignee, priority=changes.priority, due=changes.due_date, estimate=changes.estimate_hours,
            issue_type=None, labels=labels, parent=changes.parent,
        ):
            await self._command(key, command)
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        await self._command(key, f"{COMMANDS.get(kind, 'relates to')} {other}")

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        async with self.client() as c:
            c.headers.pop("Content-Type", None)
            rows = self.check(
                await c.post(f"{self.base()}/issues/{quote(key)}/attachments", params={"fields": "url"}, files={"file": (filename, data, mime)})
            ).json()
        return f"{self.base()[:-4]}{rows[0].get('url', '')}" if rows else None

    async def log_work(self, key: str, seconds: int, comment: str = "") -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(
                await c.post(
                    f"{self.base()}/issues/{quote(key)}/timeTracking/workItems",
                    json={"duration": {"minutes": max(1, round(seconds / 60))}, "text": comment},
                )
            )
