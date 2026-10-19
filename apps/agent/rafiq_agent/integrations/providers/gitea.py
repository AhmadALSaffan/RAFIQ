"""Gitea and Forgejo (and Codeberg), through their REST API v1 and an access token."""

import re
from typing import Any
from urllib.parse import urlparse

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


class GiteaIntegration(Integration):
    spec = ProviderSpec(
        id="gitea",
        name="Gitea / Forgejo",
        icon="gitea",
        color="#609926",
        docs_url="https://docs.gitea.com/development/api-usage",
        blurb="الـ issues والـ pull requests على Gitea أو Forgejo أو Codeberg — اعتماديات، مرفقات، وقت، وإشعارات.",
        secret="token",
        group="git",
        scopes="Access token بصلاحيات issue و repository و notification (read and write).",
        fields=[
            FieldSpec("base_url", "رابط الخادم", "url", "https://codeberg.org"),
            FieldSpec("token", "Access token", "password", ""),
        ],
    )
    capabilities = frozenset({"search", "create", "update", "link", "attach", "worklog", "comment_edit", "mentions", "reviews", "projects", "users", "pull_request"})

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"token {self.secret}", "Accept": "application/json", "Content-Type": "application/json"}

    def host(self) -> str:
        return str(self.config.get("base_url", "")).rstrip("/")

    def base(self) -> str:
        return self.host() + "/api/v1"

    def _login(self) -> str:
        return str((self.config.get("_account") or {}).get("login") or "")

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/user")).json()
        return Account(label=f"{data.get('full_name') or data.get('login', '')} (@{data.get('login', '')})", meta={"login": data.get("login"), "user_id": data.get("id")})

    @staticmethod
    def _issue(raw: dict[str, Any]) -> Issue:
        repo = (raw.get("repository") or {}).get("full_name") or ""
        if not repo:
            m = re.search(r"https?://[^/]+/([^/]+/[^/]+)/(?:issues|pulls)/", raw.get("html_url", ""))
            repo = m.group(1) if m else ""
        state = raw.get("state", "")
        is_pr = bool(raw.get("pull_request")) or "head" in raw
        return Issue(
            key=f"{repo}#{raw.get('number')}",
            id=str(raw.get("id")),
            title=raw.get("title", ""),
            url=raw.get("html_url", ""),
            status=state,
            status_category="done" if state == "closed" else "todo",
            project=repo,
            updated_at=raw.get("updated_at"),
            created_at=raw.get("created_at"),
            description=raw.get("body"),
            assignee=", ".join(a.get("login", "") for a in raw.get("assignees") or []) or None,
            reporter=(raw.get("user") or {}).get("login"),
            labels=[label.get("name", "") for label in raw.get("labels") or []],
            due_date=(raw.get("due_date") or "")[:10] or None,
            milestone=(raw.get("milestone") or {}).get("title"),
            comment_count=raw.get("comments"),
            attachments=[{"name": a.get("name", ""), "url": a.get("browser_download_url", ""), "size": a.get("size")} for a in raw.get("assets") or []],
            kind="pull_request" if is_pr else "issue",
        )

    @staticmethod
    def _split(key: str) -> tuple[str, str]:
        repo, _, number = key.partition("#")
        if "/" not in repo or not number.isdigit():
            raise IntegrationError(tr("صيغة المهمة لازم تكون owner/repo#123"))
        return repo, number

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        params: dict[str, Any] = {"assigned": "true", "type": "issues", "state": "all" if include_done else "open", "limit": min(limit, 50)}
        if query:
            params["q"] = query
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/issues/search", params=params)).json()
        return [self._issue(r) for r in rows]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/issues/search", params={"q": query, "type": "issues", "state": "all", "limit": min(limit, 50)})).json()
        return [self._issue(r) for r in rows]

    async def get_issue(self, key: str) -> Issue:
        repo, number = self._split(key)
        async with self.client() as c:
            raw = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}")).json()
            issue = self._issue({**raw, "repository": {"full_name": repo}})
            try:
                deps = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}/dependencies")).json()
                issue.links = [{"kind": "blocked_by", "key": f"{(d.get('repository') or {}).get('full_name', repo)}#{d.get('number')}", "title": d.get("title", "")} for d in deps]
            except IntegrationError:
                pass
        return issue

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        repo, number = self._split(key)
        me = self._login()
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}/comments")).json()
        return [
            IssueComment(id=str(r.get("id")), author=(r.get("user") or {}).get("login", ""), body=r.get("body", ""),
                         created_at=r.get("created_at"), mine=bool(me) and (r.get("user") or {}).get("login") == me)
            for r in rows[-limit:]
        ]

    async def list_projects(self) -> list[Project]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/user/repos", params={"limit": 50})).json()
        return [Project(id=str(r.get("id")), key=r.get("full_name", ""), name=r.get("full_name", ""), url=r.get("html_url")) for r in rows]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/{project}/assignees")).json()
        return [Person(id=u.get("login", ""), name=u.get("full_name") or u.get("login", ""), handle=u.get("login")) for u in rows if query.lower() in u.get("login", "").lower()]

    async def list_labels(self, project: str | None = None) -> list[str]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/{project}/labels")).json()
        return [label.get("name", "") for label in rows]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        return [StatusOption(id="open", name="open", category="todo"), StatusOption(id="closed", name="closed", category="done")]

    async def mentions(self, since: str | None = None) -> list[Activity]:
        params: dict[str, Any] = {"status-types": "unread", "limit": 50}
        if since:
            params["since"] = since
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/notifications", params=params)).json()
        out = []
        for n in rows:
            subject = n.get("subject") or {}
            if subject.get("type") not in ("Issue", "Pull"):
                continue
            url = subject.get("html_url", "")
            repo = (n.get("repository") or {}).get("full_name", "")
            out.append(Activity(kind="update", key=f"{repo}#{url.rstrip('/').split('/')[-1]}", title=subject.get("title", ""), url=url, at=n.get("updated_at"), id=f"{n.get('id')}@{n.get('updated_at')}"))
        return out

    async def review_requests(self, limit: int = 30) -> list[Issue]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/issues/search", params={"type": "pulls", "state": "open", "review_requested": "true", "limit": min(limit, 50)})).json()
        return [self._issue(r) for r in rows]

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        repo, number = self._split(key)
        async with self.client() as c:
            data = self.check(await c.post(f"{self.base()}/repos/{repo}/issues/{number}/comments", json={"body": body})).json()
        return str(data.get("id")) if data.get("id") else None

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        repo, _ = self._split(key)
        async with self.client() as c:
            self.check(await c.patch(f"{self.base()}/repos/{repo}/issues/comments/{comment_id}", json={"body": body}))

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        repo, _ = self._split(key)
        async with self.client() as c:
            self.check(await c.delete(f"{self.base()}/repos/{repo}/issues/comments/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        if status_id not in ("open", "closed"):
            raise IntegrationError(tr("بيقبل open أو closed بس."))
        repo, number = self._split(key)
        async with self.client() as c:
            self.check(await c.patch(f"{self.base()}/repos/{repo}/issues/{number}", json={"state": status_id}))
        return status_id

    async def complete(self, key: str) -> str:
        return await self.set_status(key, "closed")

    async def _label_ids(self, repo: str, names: list[str]) -> list[int]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/{repo}/labels")).json()
        by_name = {r.get("name", "").lower(): r.get("id") for r in rows}
        return [by_name[n.lower()] for n in names if n.lower() in by_name]

    def _assignees(self, value: str) -> list[str]:
        return [self._login()] if value == "me" else [v.strip() for v in value.split(",") if v.strip()]

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        body: dict[str, Any] = {"title": draft.title, "body": draft.description or ""}
        if draft.assignee:
            body["assignees"] = self._assignees(draft.assignee)
        if draft.labels:
            body["labels"] = await self._label_ids(draft.project, draft.labels)
        if draft.due_date:
            body["due_date"] = f"{draft.due_date}T23:59:59Z"
        async with self.client() as c:
            data = self.check(await c.post(f"{self.base()}/repos/{draft.project}/issues", json=body)).json()
        key = f"{draft.project}#{data.get('number')}"
        if draft.parent:
            await self.link_issues(draft.parent, key, "blocked_by")
        return await self.get_issue(key)

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        repo, number = self._split(key)
        body: dict[str, Any] = {}
        if changes.title is not None:
            body["title"] = changes.title
        if changes.description is not None:
            body["body"] = changes.description
        if changes.assignee is not None:
            body["assignees"] = self._assignees(changes.assignee) if changes.assignee else []
        if changes.due_date is not None:
            body["due_date"] = f"{changes.due_date}T23:59:59Z" if changes.due_date else None
            if not changes.due_date:
                body["unset_due_date"] = True
        async with self.client() as c:
            if body:
                self.check(await c.patch(f"{self.base()}/repos/{repo}/issues/{number}", json=body))
            if changes.labels is not None:
                self.check(await c.put(f"{self.base()}/repos/{repo}/issues/{number}/labels", json={"labels": await self._label_ids(repo, changes.labels)}))
            elif changes.add_labels:
                self.check(await c.post(f"{self.base()}/repos/{repo}/issues/{number}/labels", json={"labels": await self._label_ids(repo, changes.add_labels)}))
            for label_id in await self._label_ids(repo, changes.remove_labels) if changes.remove_labels else []:
                self.check(await c.delete(f"{self.base()}/repos/{repo}/issues/{number}/labels/{label_id}"))
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        self.guard_write()
        repo, number = self._split(key)
        other_repo, other_number = self._split(other)
        owner, name = other_repo.split("/", 1)
        if kind in ("blocked_by", "blocks"):
            path = "dependencies" if kind == "blocked_by" else "blocks"
            async with self.client() as c:
                self.check(await c.post(f"{self.base()}/repos/{repo}/issues/{number}/{path}", json={"owner": owner, "repo": name, "index": int(other_number)}))
        else:
            await self.add_comment(key, f"{'Duplicate of' if kind == 'duplicates' else 'Related to'} {other}")

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        repo, number = self._split(key)
        async with self.client() as c:
            c.headers.pop("Content-Type", None)
            up = self.check(await c.post(f"{self.base()}/repos/{repo}/issues/{number}/assets", files={"attachment": (filename, data, mime)})).json()
        return up.get("browser_download_url")

    async def log_work(self, key: str, seconds: int, comment: str = "") -> None:
        self.guard_write()
        repo, number = self._split(key)
        async with self.client() as c:
            self.check(await c.post(f"{self.base()}/repos/{repo}/issues/{number}/times", json={"time": max(60, int(seconds))}))

    async def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str) -> DevLink:
        self.guard_write()
        async with self.client() as c:
            data = self.check(await c.post(f"{self.base()}/repos/{repo}/pulls", json={"head": head, "base": base, "title": title, "body": body})).json()
        return DevLink(kind="pull_request", title=f"#{data.get('number')} {data.get('title', '')}", url=data.get("html_url", ""), state="open", ref=head)

    def repo_for_remote(self, remote_url: str) -> str | None:
        host = re.escape(urlparse(self.host()).netloc)
        m = re.match(rf"^(?:https?://(?:[^@/]+@)?|git@|ssh://git@){host}(?::\d+)?[:/]([^/]+/[^/]+?)(?:\.git)?/?$", remote_url.strip())
        return m.group(1) if m else None
