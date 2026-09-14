"""Issue-tracker connectors. Each one maps its API onto the small Issue/verify/comment/
complete surface in base.py so the UI and the agent tools stay provider-agnostic."""

import base64
from typing import Any
from urllib.parse import quote

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    Account,
    FieldSpec,
    Integration,
    IntegrationError,
    Issue,
    IssueComment,
    ProviderSpec,
    StatusOption,
)


def _text_to_adf(text: str) -> dict[str, Any]:
    """Jira Cloud comments are Atlassian Document Format, not plain text."""
    paragraphs = text.split("\n")
    content = []
    for line in paragraphs:
        content.append({"type": "paragraph", "content": [{"type": "text", "text": line}] if line else []})
    return {"type": "doc", "version": 1, "content": content or [{"type": "paragraph", "content": []}]}


def _adf_to_text(node: Any) -> str:
    if isinstance(node, dict):
        if node.get("type") == "text":
            return node.get("text", "")
        return "".join(_adf_to_text(c) for c in node.get("content", []))
    if isinstance(node, list):
        return "".join(_adf_to_text(c) for c in node)
    return ""


class JiraIntegration(Integration):
    spec = ProviderSpec(
        id="jira",
        name="Jira",
        icon="jira",
        color="#0052CC",
        docs_url="https://id.atlassian.com/manage-profile/security/api-tokens",
        blurb="مهامك من Jira Cloud — تعليقات ونقل الحالة لمكتمل.",
        fields=[
            FieldSpec("site_url", "رابط الموقع", "url", "https://your-team.atlassian.net"),
            FieldSpec("email", "الإيميل", "text", "you@company.com"),
            FieldSpec("api_token", "API token", "password", "", help="من إعدادات حسابك في Atlassian"),
        ],
    )

    def headers(self) -> dict[str, str]:
        raw = f"{self.config.get('email', '')}:{self.secret}".encode()
        return {
            "Authorization": f"Basic {base64.b64encode(raw).decode()}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def base(self) -> str:
        return str(self.config.get("site_url", "")).rstrip("/")

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/rest/api/3/myself")).json()
        return Account(
            label=f"{data.get('displayName', '')} ({data.get('emailAddress', '')})",
            meta={"account_id": data.get("accountId")},
        )

    FIELDS = [
        "summary",
        "status",
        "project",
        "updated",
        "created",
        "priority",
        "labels",
        "assignee",
        "reporter",
        "duedate",
        "issuetype",
        "parent",
        "description",
        "timeoriginalestimate",
    ]

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        jql = (
            "assignee = currentUser()"
            + ("" if include_done else " AND statusCategory != Done")
            + " ORDER BY updated DESC"
        )
        if query:
            safe = query.replace('"', " ")
            jql = f'assignee = currentUser() AND (summary ~ "{safe}*" OR key = "{safe.upper()}") ORDER BY updated DESC'
        fields = self.FIELDS
        async with self.client() as c:
            # Atlassian is mid-migration between search endpoints; try the newer one first.
            resp = await c.post(
                f"{self.base()}/rest/api/3/search/jql",
                json={"jql": jql, "fields": fields, "maxResults": limit},
            )
            if resp.status_code in (404, 410):
                resp = await c.get(
                    f"{self.base()}/rest/api/3/search",
                    params={"jql": jql, "fields": ",".join(fields), "maxResults": limit},
                )
            data = self.check(resp).json()
        return [self._issue(raw) for raw in data.get("issues", [])]

    CATEGORY = {"new": "todo", "indeterminate": "in_progress", "done": "done"}

    def _issue(self, raw: dict[str, Any]) -> Issue:
        fields = raw.get("fields", {})
        key = raw.get("key", "")
        description = fields.get("description")
        status = fields.get("status") or {}
        seconds = fields.get("timeoriginalestimate")
        return Issue(
            key=key,
            id=key,
            title=fields.get("summary", ""),
            url=f"{self.base()}/browse/{key}",
            status=status.get("name", ""),
            status_category=self.CATEGORY.get((status.get("statusCategory") or {}).get("key", "")),
            project=(fields.get("project") or {}).get("name"),
            updated_at=fields.get("updated"),
            created_at=fields.get("created"),
            description=_adf_to_text(description) if description else None,
            priority=(fields.get("priority") or {}).get("name"),
            issue_type=(fields.get("issuetype") or {}).get("name"),
            assignee=(fields.get("assignee") or {}).get("displayName"),
            reporter=(fields.get("reporter") or {}).get("displayName"),
            labels=list(fields.get("labels") or []),
            due_date=fields.get("duedate"),
            parent=((fields.get("parent") or {}).get("key")),
            estimate=f"{round(seconds / 3600, 1)}h" if isinstance(seconds, (int, float)) else None,
        )

    async def get_issue(self, key: str) -> Issue:
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/rest/api/3/issue/{quote(key)}", params={"fields": ",".join(self.FIELDS)}
                )
            ).json()
        return self._issue(data)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/rest/api/3/issue/{quote(key)}/comment",
                    params={"maxResults": limit, "orderBy": "-created"},
                )
            ).json()
        return [
            IssueComment(
                author=(c_.get("author") or {}).get("displayName", ""),
                body=_adf_to_text(c_.get("body")),
                created_at=c_.get("created"),
            )
            for c_ in data.get("comments", [])
        ]

    async def add_comment(self, key: str, body: str) -> None:
        async with self.client() as c:
            self.check(
                await c.post(
                    f"{self.base()}/rest/api/3/issue/{quote(key)}/comment", json={"body": _text_to_adf(body)}
                )
            )

    async def list_statuses(self, key: str) -> list[StatusOption]:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/rest/api/3/issue/{quote(key)}/transitions")).json()
        options = []
        for t in data.get("transitions", []):
            to = t.get("to") or {}
            options.append(
                StatusOption(
                    id=str(t.get("id")),
                    name=to.get("name") or t.get("name") or "",
                    category=self.CATEGORY.get(((to.get("statusCategory") or {}).get("key")) or ""),
                )
            )
        return options

    async def set_status(self, key: str, status_id: str) -> str:
        options = await self.list_statuses(key)
        target = next((o for o in options if o.id == status_id), None)
        if not target:
            raise IntegrationError(tr("هالانتقال مو متاح على هالمهمة هلق."))
        async with self.client() as c:
            self.check(
                await c.post(
                    f"{self.base()}/rest/api/3/issue/{quote(key)}/transitions",
                    json={"transition": {"id": status_id}},
                )
            )
        # Read it back: a workflow can land the issue somewhere other than the transition's
        # nominal target, and the user should see where it actually ended up.
        try:
            return (await self.get_issue(key)).status
        except IntegrationError:
            return target.name

    async def complete(self, key: str) -> str:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/rest/api/3/issue/{quote(key)}/transitions")).json()
            done = [
                t
                for t in data.get("transitions", [])
                if ((t.get("to") or {}).get("statusCategory") or {}).get("key") == "done"
            ]
            if not done:
                raise IntegrationError(tr("ما في انتقال متاح لحالة «مكتمل» على هالمهمة."))
            transition = done[0]
            self.check(
                await c.post(
                    f"{self.base()}/rest/api/3/issue/{quote(key)}/transitions",
                    json={"transition": {"id": transition["id"]}},
                )
            )
        return (transition.get("to") or {}).get("name", "Done")


class LinearIntegration(Integration):
    spec = ProviderSpec(
        id="linear",
        name="Linear",
        icon="linear",
        color="#5E6AD2",
        docs_url="https://linear.app/settings/api",
        blurb="مهامك من Linear مع التعليقات ونقلها لحالة مكتمل.",
        fields=[FieldSpec("api_key", "API key", "password", "lin_api_…")],
    )
    ENDPOINT = "https://api.linear.app/graphql"

    def headers(self) -> dict[str, str]:
        return {"Authorization": self.secret, "Content-Type": "application/json"}

    async def _gql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        async with self.client() as c:
            data = self.check(
                await c.post(self.ENDPOINT, json={"query": query, "variables": variables or {}})
            ).json()
        if data.get("errors"):
            raise IntegrationError(str(data["errors"][0].get("message", tr("خطأ من Linear"))))
        return data.get("data", {})

    async def verify(self) -> Account:
        data = await self._gql("{ viewer { id name email } }")
        viewer = data.get("viewer") or {}
        return Account(
            label=f"{viewer.get('name', '')} ({viewer.get('email', '')})", meta={"user_id": viewer.get("id")}
        )

    ISSUE_FIELDS = """
        id identifier title url updatedAt createdAt description dueDate estimate priorityLabel
        state { name type } team { name } project { name } assignee { name } creator { name }
        parent { identifier } labels { nodes { name } } comments { nodes { id } }
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
            comment_count=len((node.get("comments") or {}).get("nodes") or []),
        )

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        filter_clause = (
            "" if include_done else 'filter: { state: { type: { nin: ["completed", "canceled"] } } }, '
        )
        data = await self._gql(
            f"""
            query($limit: Int!) {{
              viewer {{ assignedIssues(first: $limit, {filter_clause}) {{
                nodes {{ {self.ISSUE_FIELDS} }} }} }}
            }}
            """,
            {"limit": limit},
        )
        nodes = ((data.get("viewer") or {}).get("assignedIssues") or {}).get("nodes", [])
        issues = [self._issue(n) for n in nodes]
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        return issues

    async def get_issue(self, key: str) -> Issue:
        data = await self._gql(
            f"query($key: String!) {{ issue(id: $key) {{ {self.ISSUE_FIELDS} }} }}", {"key": key}
        )
        issue = data.get("issue")
        if not issue:
            raise IntegrationError(tr("ما لقيت المهمة {0}", key))
        return self._issue(issue)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        data = await self._gql(
            "query($key: String!, $limit: Int!) { issue(id: $key) { comments(first: $limit) { nodes { body createdAt user { name } } } } }",
            {"key": key, "limit": limit},
        )
        nodes = (((data.get("issue") or {}).get("comments")) or {}).get("nodes", [])
        return [
            IssueComment(
                author=(n.get("user") or {}).get("name", ""),
                body=n.get("body", ""),
                created_at=n.get("createdAt"),
            )
            for n in nodes
        ]

    async def _issue_id(self, key: str) -> str:
        return (await self.get_issue(key)).id

    async def add_comment(self, key: str, body: str) -> None:
        await self._gql(
            "mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }",
            {"id": await self._issue_id(key), "body": body},
        )

    async def list_statuses(self, key: str) -> list[StatusOption]:
        data = await self._gql(
            "query($key: String!) { issue(id: $key) { team { states { nodes { id name type } } } } }",
            {"key": key},
        )
        nodes = ((((data.get("issue") or {}).get("team")) or {}).get("states") or {}).get("nodes", [])
        return [
            StatusOption(id=n["id"], name=n["name"], category=self.CATEGORY.get(n.get("type", "")))
            for n in nodes
        ]

    async def set_status(self, key: str, status_id: str) -> str:
        data = await self._gql("query($key: String!) { issue(id: $key) { id } }", {"key": key})
        issue = data.get("issue") or {}
        if not issue.get("id"):
            raise IntegrationError(tr("ما لقيت المهمة على Linear."))
        await self._gql(
            "mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }",
            {"id": issue["id"], "state": status_id},
        )
        try:
            return (await self.get_issue(key)).status
        except IntegrationError:
            target = next((o for o in await self.list_statuses(key) if o.id == status_id), None)
            return target.name if target else tr("تم التحديث")

    async def complete(self, key: str) -> str:
        data = await self._gql(
            'query($key: String!) { issue(id: $key) { id team { states(filter: { type: { eq: "completed" } }) { nodes { id name } } } } }',
            {"key": key},
        )
        issue = data.get("issue") or {}
        states = (((issue.get("team") or {}).get("states")) or {}).get("nodes", [])
        if not states:
            raise IntegrationError(tr("ما في حالة «مكتمل» معرّفة بهالفريق على Linear."))
        await self._gql(
            "mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }",
            {"id": issue["id"], "state": states[0]["id"]},
        )
        return states[0]["name"]


class GitHubIntegration(Integration):
    spec = ProviderSpec(
        id="github",
        name="GitHub Issues",
        icon="github",
        color="#181717",
        docs_url="https://github.com/settings/tokens",
        blurb="الـ issues المسندة إلك عبر كل المستودعات.",
        fields=[
            FieldSpec("token", "Personal access token", "password", "ghp_…", help="صلاحية repo"),
            FieldSpec(
                "base_url", "API base (لـ Enterprise)", "url", "https://api.github.com", required=False
            ),
        ],
    )

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.secret}", "Accept": "application/vnd.github+json"}

    def base(self) -> str:
        return str(self.config.get("base_url") or "https://api.github.com").rstrip("/")

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/user")).json()
        return Account(
            label=f"{data.get('name') or data.get('login', '')} (@{data.get('login', '')})",
            meta={"login": data.get("login")},
        )

    @staticmethod
    def _issue(raw: dict[str, Any]) -> Issue:
        repo = (raw.get("repository") or {}).get("full_name") or raw.get("html_url", "").split("/issues/")[
            0
        ].split("github.com/")[-1]
        number = raw.get("number")
        assignees = [a.get("login", "") for a in (raw.get("assignees") or [])]
        return Issue(
            key=f"{repo}#{number}",
            id=f"{repo}#{number}",
            title=raw.get("title", ""),
            url=raw.get("html_url", ""),
            status=raw.get("state", ""),
            status_category="done" if raw.get("state") == "closed" else "todo",
            project=repo,
            updated_at=raw.get("updated_at"),
            created_at=raw.get("created_at"),
            description=raw.get("body"),
            assignee=", ".join(assignees) or None,
            reporter=(raw.get("user") or {}).get("login"),
            labels=[label.get("name", "") for label in (raw.get("labels") or []) if isinstance(label, dict)],
            milestone=(raw.get("milestone") or {}).get("title"),
            comment_count=raw.get("comments"),
            issue_type="issue",
        )

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/issues",
                    params={
                        "filter": "assigned",
                        "state": "all" if include_done else "open",
                        "per_page": limit,
                    },
                )
            ).json()
        issues = [self._issue(raw) for raw in data if "pull_request" not in raw]
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        return issues

    @staticmethod
    def _split(key: str) -> tuple[str, str]:
        repo, _, number = key.partition("#")
        if not repo or not number:
            raise IntegrationError(tr("صيغة المهمة لازم تكون owner/repo#123"))
        return repo, number

    async def get_issue(self, key: str) -> Issue:
        repo, number = self._split(key)
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/repos/{repo}/issues/{number}")).json()
        data.setdefault("repository", {"full_name": repo})
        return self._issue(data)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        repo, number = self._split(key)
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/repos/{repo}/issues/{number}/comments", params={"per_page": limit}
                )
            ).json()
        return [
            IssueComment(
                author=(c_.get("user") or {}).get("login", ""),
                body=c_.get("body", ""),
                created_at=c_.get("created_at"),
            )
            for c_ in data
        ]

    async def add_comment(self, key: str, body: str) -> None:
        repo, number = self._split(key)
        async with self.client() as c:
            self.check(
                await c.post(f"{self.base()}/repos/{repo}/issues/{number}/comments", json={"body": body})
            )

    async def list_statuses(self, key: str) -> list[StatusOption]:
        return [
            StatusOption(id="open", name="open", category="todo"),
            StatusOption(id="closed", name="closed", category="done"),
        ]

    async def set_status(self, key: str, status_id: str) -> str:
        if status_id not in ("open", "closed"):
            raise IntegrationError(tr("GitHub بيقبل open أو closed بس."))
        repo, number = self._split(key)
        async with self.client() as c:
            self.check(
                await c.patch(f"{self.base()}/repos/{repo}/issues/{number}", json={"state": status_id})
            )
        return status_id

    async def complete(self, key: str) -> str:
        repo, number = self._split(key)
        async with self.client() as c:
            self.check(await c.patch(f"{self.base()}/repos/{repo}/issues/{number}", json={"state": "closed"}))
        return "closed"


class GitLabIntegration(Integration):
    spec = ProviderSpec(
        id="gitlab",
        name="GitLab Issues",
        icon="gitlab",
        color="#FC6D26",
        docs_url="https://gitlab.com/-/user_settings/personal_access_tokens",
        blurb="الـ issues المسندة إلك على GitLab (سحابي أو ذاتي الاستضافة).",
        fields=[
            FieldSpec("token", "Personal access token", "password", "glpat-…", help="صلاحية api"),
            FieldSpec("base_url", "رابط الخادم", "url", "https://gitlab.com", required=False),
        ],
    )

    def headers(self) -> dict[str, str]:
        return {"PRIVATE-TOKEN": self.secret, "Content-Type": "application/json"}

    def base(self) -> str:
        return str(self.config.get("base_url") or "https://gitlab.com").rstrip("/") + "/api/v4"

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/user")).json()
        return Account(
            label=f"{data.get('name', '')} (@{data.get('username', '')})", meta={"user_id": data.get("id")}
        )

    @staticmethod
    def _issue(raw: dict[str, Any]) -> Issue:
        return Issue(
            key=(raw.get("references") or {}).get("full") or f"#{raw.get('iid')}",
            id=f"{raw.get('project_id')}:{raw.get('iid')}",
            title=raw.get("title", ""),
            url=raw.get("web_url", ""),
            status=raw.get("state", ""),
            status_category="done" if raw.get("state") == "closed" else "todo",
            project=(raw.get("references") or {}).get("full", "").split("#")[0] or None,
            updated_at=raw.get("updated_at"),
            created_at=raw.get("created_at"),
            description=raw.get("description"),
            assignee=(raw.get("assignee") or {}).get("name"),
            reporter=(raw.get("author") or {}).get("name"),
            labels=list(raw.get("labels") or []),
            due_date=raw.get("due_date"),
            milestone=(raw.get("milestone") or {}).get("title"),
            comment_count=raw.get("user_notes_count"),
            issue_type=raw.get("issue_type"),
        )

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        params: dict[str, Any] = {"scope": "assigned_to_me", "per_page": limit}
        if not include_done:
            params["state"] = "opened"
        if query:
            params["search"] = query
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/issues", params=params)).json()
        return [self._issue(raw) for raw in data]

    async def _resolve(self, key: str) -> tuple[str, str]:
        """Accepts either the internal 'projectId:iid' or the human 'group/project#iid'."""
        if ":" in key and "#" not in key:
            project, _, iid = key.partition(":")
            return project, iid
        path, _, iid = key.partition("#")
        if not path or not iid:
            raise IntegrationError(tr("صيغة المهمة لازم تكون group/project#123"))
        return quote(path, safe=""), iid

    async def get_issue(self, key: str) -> Issue:
        project, iid = await self._resolve(key)
        async with self.client() as c:
            data = self.check(await c.get(f"{self.base()}/projects/{project}/issues/{iid}")).json()
        return self._issue(data)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        project, iid = await self._resolve(key)
        async with self.client() as c:
            data = self.check(
                await c.get(
                    f"{self.base()}/projects/{project}/issues/{iid}/notes", params={"per_page": limit}
                )
            ).json()
        return [
            IssueComment(
                author=(n.get("author") or {}).get("name", ""),
                body=n.get("body", ""),
                created_at=n.get("created_at"),
            )
            for n in data
            if not n.get("system")  # skip GitLab's auto "changed status" notes
        ]

    async def add_comment(self, key: str, body: str) -> None:
        project, iid = await self._resolve(key)
        async with self.client() as c:
            self.check(
                await c.post(f"{self.base()}/projects/{project}/issues/{iid}/notes", json={"body": body})
            )

    async def list_statuses(self, key: str) -> list[StatusOption]:
        return [
            StatusOption(id="reopen", name="opened", category="todo"),
            StatusOption(id="close", name="closed", category="done"),
        ]

    async def set_status(self, key: str, status_id: str) -> str:
        if status_id not in ("close", "reopen"):
            raise IntegrationError(tr("GitLab بيقبل close أو reopen بس."))
        project, iid = await self._resolve(key)
        async with self.client() as c:
            self.check(
                await c.put(f"{self.base()}/projects/{project}/issues/{iid}", json={"state_event": status_id})
            )
        return "closed" if status_id == "close" else "opened"

    async def complete(self, key: str) -> str:
        project, iid = await self._resolve(key)
        async with self.client() as c:
            self.check(
                await c.put(f"{self.base()}/projects/{project}/issues/{iid}", json={"state_event": "close"})
            )
        return "closed"


REGISTRY: dict[str, type[Integration]] = {
    JiraIntegration.spec.id: JiraIntegration,
    LinearIntegration.spec.id: LinearIntegration,
    GitHubIntegration.spec.id: GitHubIntegration,
    GitLabIntegration.spec.id: GitLabIntegration,
}


def build(provider: str, config: dict[str, Any], secret: str | None) -> Integration:
    cls = REGISTRY.get(provider)
    if not cls:
        raise IntegrationError(tr("مزوّد غير مدعوم: {0}", provider))
    return cls(config, secret)


def secret_field(provider: str) -> str:
    """Which configured field is the credential (stored in the OS keychain, never in the DB)."""
    return {"jira": "api_token", "linear": "api_key", "github": "token", "gitlab": "token"}[provider]
