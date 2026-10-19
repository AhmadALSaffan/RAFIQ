"""Bitbucket Cloud, through the REST 2.0 API with an Atlassian API token. It's mainly a git
host here: pull requests waiting for your review, and opening a pull request from a task.
Repository issue trackers work too, for the repositories that still have them on."""

import base64
import re
from typing import Any

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
    Project,
    ProviderSpec,
    StatusOption,
)

BASE = "https://api.bitbucket.org/2.0"
STATES = ["new", "open", "on hold", "resolved", "duplicate", "invalid", "wontfix", "closed"]
DONE = {"resolved", "duplicate", "invalid", "wontfix", "closed"}


class BitbucketIntegration(Integration):
    spec = ProviderSpec(
        id="bitbucket",
        name="Bitbucket",
        icon="bitbucket",
        color="#0052CC",
        docs_url="https://id.atlassian.com/manage-profile/security/api-tokens",
        blurb="طلبات المراجعة وفتح pull requests من التاسك، والـ issues على المستودعات اللي مفعّلتها.",
        secret="token",
        group="git",
        scopes="API token بصلاحيات read:repository و write:pullrequest و read:pullrequest و issue:write.",
        fields=[
            FieldSpec("email", "الإيميل", "text", "you@company.com"),
            FieldSpec("workspace", "الـ workspace", "text", "my-team"),
            FieldSpec("token", "API token", "password", ""),
        ],
    )
    capabilities = frozenset({"create", "update", "reviews", "projects", "pull_request", "comment_edit"})

    def headers(self) -> dict[str, str]:
        raw = base64.b64encode(f"{self.config.get('email', '')}:{self.secret}".encode()).decode()
        return {"Authorization": f"Basic {raw}", "Accept": "application/json", "Content-Type": "application/json"}

    def _ws(self) -> str:
        return str(self.config.get("workspace", "")).strip()

    def _me(self) -> dict[str, Any]:
        return self.config.get("_account") or {}

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{BASE}/user")).json()
        return Account(label=f"{data.get('display_name', '')} (@{data.get('nickname', '')})", meta={"uuid": data.get("uuid"), "account_id": data.get("account_id")})

    def _issue(self, raw: dict[str, Any], repo: str, kind: str = "issue") -> Issue:
        state = raw.get("state", "")
        number = raw.get("id")
        sep = "!" if kind == "pull_request" else "#"
        return Issue(
            key=f"{repo}{sep}{number}",
            id=str(number),
            title=raw.get("title", ""),
            url=((raw.get("links") or {}).get("html") or {}).get("href", ""),
            status=state.lower(),
            status_category="done" if state.lower() in DONE or state in ("MERGED", "DECLINED", "SUPERSEDED") else "todo",
            project=repo,
            updated_at=raw.get("updated_on"),
            created_at=raw.get("created_on"),
            description=((raw.get("content") or raw.get("summary") or {}).get("raw")),
            priority=raw.get("priority"),
            issue_type=raw.get("kind") or ("pull request" if kind == "pull_request" else None),
            assignee=(raw.get("assignee") or {}).get("display_name"),
            reporter=((raw.get("reporter") or raw.get("author")) or {}).get("display_name"),
            kind=kind,
        )

    async def _repos(self) -> list[dict[str, Any]]:
        async with self.client() as c:
            data = self.check(await c.get(f"{BASE}/repositories/{self._ws()}", params={"role": "member", "pagelen": 50, "sort": "-updated_on"})).json()
        return data.get("values", [])

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        me = self._me().get("uuid")
        if not me:
            return []
        q = f'assignee.uuid="{me}"' + ("" if include_done else ' AND (state="new" OR state="open" OR state="on hold")')
        if query:
            q += f' AND title~"{query.replace(chr(34), "")}"'
        out: list[Issue] = []
        async with self.client() as c:
            for repo in [r for r in await self._repos() if r.get("has_issues")][:15]:
                full = repo.get("full_name", "")
                resp = await c.get(f"{BASE}/repositories/{full}/issues", params={"q": q, "pagelen": 50, "sort": "-updated_on"})
                if resp.status_code >= 400:
                    continue
                out.extend(self._issue(r, full) for r in resp.json().get("values", []))
        out.sort(key=lambda i: i.updated_at or "", reverse=True)
        return out[:limit]

    @staticmethod
    def _split(key: str) -> tuple[str, str]:
        m = re.match(r"^([^/\s]+/[^#!\s]+)[#!](\d+)$", key.strip())
        if not m:
            raise IntegrationError(tr("صيغة المهمة لازم تكون workspace/repo#123"))
        return m.group(1), m.group(2)

    async def get_issue(self, key: str) -> Issue:
        repo, number = self._split(key)
        kind = "pull_request" if "!" in key else "issue"
        path = "pullrequests" if kind == "pull_request" else "issues"
        async with self.client() as c:
            raw = self.check(await c.get(f"{BASE}/repositories/{repo}/{path}/{number}")).json()
        return self._issue(raw, repo, kind)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        repo, number = self._split(key)
        path = "pullrequests" if "!" in key else "issues"
        me = self._me().get("uuid")
        async with self.client() as c:
            data = self.check(await c.get(f"{BASE}/repositories/{repo}/{path}/{number}/comments", params={"pagelen": min(limit, 100)})).json()
        return [
            IssueComment(id=str(r.get("id")), author=(r.get("user") or {}).get("display_name", ""), body=(r.get("content") or {}).get("raw", ""),
                         created_at=r.get("created_on"), mine=bool(me) and (r.get("user") or {}).get("uuid") == me)
            for r in data.get("values", [])
        ]

    async def list_projects(self) -> list[Project]:
        return [Project(id=r.get("uuid", ""), key=r.get("full_name", ""), name=r.get("full_name", ""), url=((r.get("links") or {}).get("html") or {}).get("href")) for r in await self._repos()]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        if "!" in key:
            return []
        return [StatusOption(id=s, name=s, category="done" if s in DONE else "todo") for s in STATES]

    async def review_requests(self, limit: int = 30) -> list[Issue]:
        me = self._me().get("uuid")
        if not me:
            return []
        out: list[Issue] = []
        async with self.client() as c:
            for repo in (await self._repos())[:20]:
                full = repo.get("full_name", "")
                resp = await c.get(f"{BASE}/repositories/{full}/pullrequests", params={"q": f'reviewers.uuid="{me}" AND state="OPEN"', "pagelen": 20})
                if resp.status_code < 400:
                    out.extend(self._issue(r, full, "pull_request") for r in resp.json().get("values", []))
        return out[:limit]

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        repo, number = self._split(key)
        path = "pullrequests" if "!" in key else "issues"
        async with self.client() as c:
            data = self.check(await c.post(f"{BASE}/repositories/{repo}/{path}/{number}/comments", json={"content": {"raw": body}})).json()
        return str(data.get("id")) if data.get("id") else None

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        repo, number = self._split(key)
        path = "pullrequests" if "!" in key else "issues"
        async with self.client() as c:
            self.check(await c.put(f"{BASE}/repositories/{repo}/{path}/{number}/comments/{comment_id}", json={"content": {"raw": body}}))

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        repo, number = self._split(key)
        path = "pullrequests" if "!" in key else "issues"
        async with self.client() as c:
            self.check(await c.delete(f"{BASE}/repositories/{repo}/{path}/{number}/comments/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        repo, number = self._split(key)
        if "!" in key or status_id not in STATES:
            raise IntegrationError(tr("هالحالة مو متاحة هون."))
        async with self.client() as c:
            self.check(await c.put(f"{BASE}/repositories/{repo}/issues/{number}", json={"state": status_id}))
        return status_id

    async def complete(self, key: str) -> str:
        return await self.set_status(key, "resolved")

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        body: dict[str, Any] = {"title": draft.title, "content": {"raw": draft.description or ""}}
        if draft.priority:
            body["priority"] = draft.priority.lower()
        if draft.issue_type:
            body["kind"] = draft.issue_type.lower()
        if draft.assignee == "me" and self._me().get("account_id"):
            body["assignee"] = {"account_id": self._me()["account_id"]}
        async with self.client() as c:
            data = self.check(await c.post(f"{BASE}/repositories/{draft.project}/issues", json=body)).json()
        return self._issue(data, draft.project)

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        repo, number = self._split(key)
        body: dict[str, Any] = {}
        if changes.title is not None:
            body["title"] = changes.title
        if changes.description is not None:
            body["content"] = {"raw": changes.description}
        if changes.priority:
            body["priority"] = changes.priority.lower()
        if changes.assignee is not None:
            body["assignee"] = {"account_id": self._me().get("account_id")} if changes.assignee == "me" else None
        if body:
            async with self.client() as c:
                self.check(await c.put(f"{BASE}/repositories/{repo}/issues/{number}", json=body))
        return await self.get_issue(key)

    async def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str) -> DevLink:
        self.guard_write()
        async with self.client() as c:
            data = self.check(
                await c.post(
                    f"{BASE}/repositories/{repo}/pullrequests",
                    json={"title": title, "description": body, "source": {"branch": {"name": head}}, "destination": {"branch": {"name": base}}, "close_source_branch": True},
                )
            ).json()
        return DevLink(kind="pull_request", title=f"!{data.get('id')} {title}", url=((data.get("links") or {}).get("html") or {}).get("href", ""), state="open", ref=head)

    def repo_for_remote(self, remote_url: str) -> str | None:
        m = re.match(r"^(?:https://(?:[^@/]+@)?|git@)bitbucket\.org[:/]([^/]+/[^/]+?)(?:\.git)?/?$", remote_url.strip())
        return m.group(1) if m else None
