"""GitHub (and GitHub Enterprise) issues and pull requests, through the REST API and a
personal access token."""

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

REASONS = {
    "mention": "mention",
    "team_mention": "mention",
    "review_requested": "review",
    "assign": "assigned",
    "comment": "comment",
    "author": "update",
    "state_change": "status",
    "manual": "update",
    "subscribed": "update",
}


def html_url(api_url: str, kind: str) -> str:
    """https://api.github.com/repos/o/r/issues/12 → https://github.com/o/r/issues/12"""
    m = re.match(r"https?://([^/]+)/(?:api/v3/)?repos/([^/]+/[^/]+)/(issues|pulls)/(\d+)", api_url or "")
    if not m:
        return api_url
    host = "github.com" if m.group(1) == "api.github.com" else m.group(1)
    return f"https://{host}/{m.group(2)}/{'pull' if kind == 'PullRequest' or m.group(3) == 'pulls' else 'issues'}/{m.group(4)}"


class GitHubIntegration(Integration):
    spec = ProviderSpec(
        id="github",
        name="GitHub",
        icon="github",
        color="#181717",
        docs_url="https://github.com/settings/tokens",
        blurb="الـ issues والـ pull requests — بحث، إنشاء، مهام فرعية، طلبات المراجعة، الإشعارات، وفتح PR من التاسك.",
        secret="token",
        group="git",
        scopes="Classic: repo و notifications. Fine-grained: Issues و Pull requests و Contents (Read and write) و Metadata.",
        fields=[
            FieldSpec("token", "Personal access token", "password", "ghp_… أو github_pat_…"),
            FieldSpec("base_url", "API base (لـ Enterprise)", "url", "https://api.github.com", required=False),
        ],
    )
    capabilities = frozenset(
        {"search", "create", "update", "subtasks", "link", "dev", "comment_edit", "mentions", "reviews", "projects", "users", "pull_request"}
    )

    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.secret}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def base(self) -> str:
        return str(self.config.get("base_url") or "https://api.github.com").rstrip("/")

    def web_host(self) -> str:
        host = urlparse(self.base()).netloc
        return "github.com" if host == "api.github.com" else host

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/user")).json()
        return Account(
            label=f"{data.get('name') or data.get('login', '')} (@{data.get('login', '')})",
            meta={"login": data.get("login"), "user_id": data.get("id")},
        )

    def _login(self) -> str:
        return str((self.config.get("_account") or {}).get("login") or "")

    @staticmethod
    def _issue(raw: dict[str, Any]) -> Issue:
        repo = (raw.get("repository") or {}).get("full_name") or ""
        if not repo:
            m = re.search(r"/repos/([^/]+/[^/]+)/", raw.get("url", "")) or re.search(
                r"https?://[^/]+/([^/]+/[^/]+)/(?:issues|pull)/", raw.get("html_url", "")
            )
            repo = m.group(1) if m else ""
        number = raw.get("number")
        assignees = [a.get("login", "") for a in (raw.get("assignees") or [])]
        is_pr = "pull_request" in raw or raw.get("draft") is not None and "head" in raw
        state = raw.get("state", "")
        merged = bool((raw.get("pull_request") or {}).get("merged_at")) or bool(raw.get("merged_at"))
        sub = raw.get("sub_issues_summary") or {}
        return Issue(
            key=f"{repo}#{number}",
            id=str(raw.get("id") or f"{repo}#{number}"),
            title=raw.get("title", ""),
            url=raw.get("html_url", ""),
            status="merged" if merged else state,
            status_category="done" if state == "closed" else "todo",
            project=repo,
            updated_at=raw.get("updated_at"),
            created_at=raw.get("created_at"),
            description=raw.get("body"),
            assignee=", ".join(assignees) or None,
            reporter=(raw.get("user") or {}).get("login"),
            labels=[label.get("name", "") for label in (raw.get("labels") or []) if isinstance(label, dict)],
            milestone=(raw.get("milestone") or {}).get("title"),
            comment_count=raw.get("comments"),
            issue_type=((raw.get("type") or {}).get("name") if isinstance(raw.get("type"), dict) else None)
            or ("pull request" if is_pr else "issue"),
            kind="pull_request" if is_pr else "issue",
            extra={"sub_issues": sub.get("total")} if sub else {},
        )

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/issues",
                    params={"filter": "assigned", "state": "all" if include_done else "open", "per_page": min(limit, 100), "sort": "updated"},
                )
            ).json()
        issues = [self._issue(raw) for raw in data if "pull_request" not in raw]
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        return issues

    async def _search(self, q: str, limit: int) -> list[Issue]:
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/search/issues", params={"q": q, "per_page": min(limit, 100), "sort": "updated"})
            ).json()
        return [self._issue(raw) for raw in data.get("items", [])]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        q = query.strip()
        if not re.search(r"\b(is|type):(issue|pr|pull-request)\b", q):
            q += " is:issue"
        return await self._search(q, limit)

    @staticmethod
    def _split(key: str) -> tuple[str, str]:
        repo, _, number = key.partition("#")
        if not repo or not number or "/" not in repo or not number.isdigit():
            raise IntegrationError(tr("صيغة المهمة لازم تكون owner/repo#123"))
        return repo, number

    async def get_issue(self, key: str) -> Issue:
        repo, number = self._split(key)
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}")).json()
        data.setdefault("repository", {"full_name": repo})
        issue = self._issue(data)
        if issue.extra.get("sub_issues"):
            try:
                async with self.client() as c:
                    subs = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}/sub_issues")).json()
                issue.subtasks = [f"{repo}#{s.get('number')}" for s in subs]
            except IntegrationError:
                pass
        return issue

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        repo, number = self._split(key)
        me = self._login()
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.base()}/repos/{repo}/issues/{number}/comments", params={"per_page": min(limit, 100)})
            ).json()
        return [
            IssueComment(
                id=str(c_.get("id")),
                author=(c_.get("user") or {}).get("login", ""),
                body=c_.get("body", ""),
                created_at=c_.get("created_at"),
                mine=bool(me) and (c_.get("user") or {}).get("login") == me,
            )
            for c_ in data
        ]

    async def list_projects(self) -> list[Project]:
        async with self.client() as c:
            rows = self.check(
                await c.get(f"{self.base()}/user/repos", params={"per_page": 100, "sort": "pushed", "affiliation": "owner,collaborator,organization_member"})
            ).json()
        return [Project(id=str(r.get("id")), key=r.get("full_name", ""), name=r.get("full_name", ""), url=r.get("html_url")) for r in rows if r.get("has_issues", True)]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/{project}/assignees", params={"per_page": 100})).json()
        q = query.lower()
        return [Person(id=u.get("login", ""), name=u.get("login", ""), handle=u.get("login")) for u in rows if q in u.get("login", "").lower()]

    async def list_labels(self, project: str | None = None) -> list[str]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/repos/{project}/labels", params={"per_page": 100})).json()
        return [label.get("name", "") for label in rows]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        return [
            StatusOption(id="open", name="open", category="todo"),
            StatusOption(id="closed", name="closed", category="done"),
        ]

    async def dev_links(self, key: str) -> list[DevLink]:
        """Pull requests that reference or close the issue, from its timeline."""
        repo, number = self._split(key)
        async with self.client() as c:
            rows = self.check(
                await c.get(f"{self.base()}/repos/{repo}/issues/{number}/timeline", params={"per_page": 100})
            ).json()
        seen: dict[str, DevLink] = {}
        for ev in rows:
            if ev.get("event") == "cross-referenced":
                src = ((ev.get("source") or {}).get("issue")) or {}
                if src.get("pull_request"):
                    merged = bool((src.get("pull_request") or {}).get("merged_at"))
                    seen[src.get("html_url", "")] = DevLink(
                        kind="pull_request",
                        title=f"#{src.get('number')} {src.get('title', '')}",
                        url=src.get("html_url", ""),
                        state="merged" if merged else ("draft" if src.get("draft") else src.get("state")),
                    )
            elif ev.get("event") == "referenced" and ev.get("commit_id"):
                sha = ev["commit_id"]
                seen[sha] = DevLink(kind="commit", title=sha[:7], url=f"https://{self.web_host()}/{repo}/commit/{sha}", ref=sha)
        return list(seen.values())

    async def mentions(self, since: str | None = None) -> list[Activity]:
        params: dict[str, Any] = {"participating": "true", "per_page": 50}
        if since:
            params["since"] = since
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.base()}/notifications", params=params)).json()
        out = []
        for n in rows:
            subject = n.get("subject") or {}
            kind = subject.get("type", "")
            if kind not in ("Issue", "PullRequest"):
                continue
            url = html_url(subject.get("url", ""), kind)
            repo = (n.get("repository") or {}).get("full_name", "")
            number = url.rstrip("/").split("/")[-1]
            out.append(
                Activity(
                    kind=REASONS.get(n.get("reason", ""), "update"),
                    key=f"{repo}#{number}",
                    title=subject.get("title", ""),
                    url=url,
                    at=n.get("updated_at"),
                    id=f"{n.get('id')}@{n.get('updated_at')}",
                )
            )
        return out

    async def review_requests(self, limit: int = 30) -> list[Issue]:
        return await self._search("is:pr is:open review-requested:@me archived:false", limit)

    # -- writing -------------------------------------------------------------------------

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
            raise IntegrationError(tr("GitHub بيقبل open أو closed بس."))
        repo, number = self._split(key)
        async with self.client() as c:
            self.check(await c.patch(f"{self.base()}/repos/{repo}/issues/{number}", json={"state": status_id}))
        return status_id

    async def complete(self, key: str) -> str:
        return await self.set_status(key, "closed")

    def _assignees(self, value: str) -> list[str]:
        if value == "me":
            return [self._login()] if self._login() else []
        return [v.strip() for v in value.split(",") if v.strip()]

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        body: dict[str, Any] = {"title": draft.title, "body": draft.description or ""}
        if draft.labels:
            body["labels"] = draft.labels
        if draft.assignee:
            body["assignees"] = self._assignees(draft.assignee)
        if draft.issue_type:
            body["type"] = draft.issue_type
        async with self.client() as c:
            resp = await c.post(f"{self.base()}/repos/{draft.project}/issues", json=body)
            if resp.status_code == 422 and "type" in body:
                body.pop("type")  # issue types are an organisation feature
                resp = await c.post(f"{self.base()}/repos/{draft.project}/issues", json=body)
            data = self.check(resp).json()
        key = f"{draft.project}#{data.get('number')}"
        if draft.parent:
            await self._add_sub_issue(draft.parent, data.get("id"))
        return await self.get_issue(key)

    async def _add_sub_issue(self, parent: str, child_id: Any) -> None:
        repo, number = self._split(parent)
        async with self.client() as c:
            self.check(
                await c.post(f"{self.base()}/repos/{repo}/issues/{number}/sub_issues", json={"sub_issue_id": child_id})
            )

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
        if changes.labels is not None:
            body["labels"] = changes.labels
        elif changes.add_labels or changes.remove_labels:
            current = (await self.get_issue(key)).labels
            body["labels"] = list(dict.fromkeys([x for x in current if x not in changes.remove_labels] + changes.add_labels))
        if body:
            async with self.client() as c:
                self.check(await c.patch(f"{self.base()}/repos/{repo}/issues/{number}", json=body))
        if changes.parent:
            async with self.client() as c:
                raw = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}")).json()
            await self._add_sub_issue(changes.parent, raw.get("id"))
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        """GitHub has no typed links; a short comment on both sides is what GitHub itself
        shows as a cross-reference."""
        self.guard_write()
        phrases = {"blocks": "Blocks", "blocked_by": "Blocked by", "duplicates": "Duplicate of", "relates": "Related to"}
        repo_a, num_a = self._split(key)
        repo_b, num_b = self._split(other)
        ref_b = f"#{num_b}" if repo_a == repo_b else other
        await self.add_comment(key, f"{phrases.get(kind, 'Related to')} {ref_b}")

    async def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str) -> DevLink:
        self.guard_write()
        async with self.client() as c:
            resp = await c.post(f"{self.base()}/repos/{repo}/pulls", json={"title": title, "head": head, "base": base, "body": body})
            if resp.status_code == 422 and "already exists" in resp.text:
                owner = repo.split("/")[0]
                existing = self.check(await c.get(f"{self.base()}/repos/{repo}/pulls", params={"head": f"{owner}:{head}", "state": "open"})).json()
                if existing:
                    pr = existing[0]
                    return DevLink(kind="pull_request", title=f"#{pr.get('number')} {pr.get('title', '')}", url=pr.get("html_url", ""), state="open", ref=head)
            data = self.check(resp).json()
        return DevLink(kind="pull_request", title=f"#{data.get('number')} {data.get('title', '')}", url=data.get("html_url", ""), state="open", ref=head)

    def repo_for_remote(self, remote_url: str) -> str | None:
        host = re.escape(self.web_host())
        m = re.match(rf"^(?:https?://(?:[^@/]+@)?|git@|ssh://git@){host}[:/]([^/]+/[^/]+?)(?:\.git)?/?$", remote_url.strip())
        return m.group(1) if m else None
