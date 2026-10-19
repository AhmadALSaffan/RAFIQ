"""Jira Cloud (REST v3, email + API token) and Jira Server / Data Center (REST v2, personal
access token). The site address decides which: *.atlassian.net is Cloud."""

import base64
from typing import Any
from urllib.parse import quote

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
    IssueType,
    Person,
    Project,
    ProviderSpec,
    StatusOption,
)
from rafiq_agent.integrations.markup import (
    adf_to_markdown,
    markdown_to_adf,
    markdown_to_wiki,
    wiki_to_markdown,
)

# Jira's link type names, and which end of the link our issue sits on.
LINK_TYPES = {
    "relates": ("Relates", "outward"),
    "blocks": ("Blocks", "outward"),
    "blocked_by": ("Blocks", "inward"),
    "duplicates": ("Duplicate", "outward"),
}


# The plain "task" type in English and Arabic Jira sites, preferred when no type is given.
TASK_TYPE_NAMES = ("task", "sub-task", "subtask", "مهمة")


def _jql_text(value: str) -> str:
    return value.replace("\\", " ").replace('"', " ")


class JiraIntegration(Integration):
    spec = ProviderSpec(
        id="jira",
        name="Jira",
        icon="jira",
        color="#0052CC",
        docs_url="https://id.atlassian.com/manage-profile/security/api-tokens",
        blurb="مهامك من Jira Cloud أو Server/Data Center — بحث JQL، إنشاء، تعديل، روابط، مرفقات، وتسجيل وقت.",
        secret="api_token",
        scopes="Cloud: API token عادي من حسابك. Server/Data Center: Personal Access Token من ملفك الشخصي.",
        fields=[
            FieldSpec("site_url", "رابط الموقع", "url", "https://your-team.atlassian.net"),
            FieldSpec(
                "email",
                "الإيميل",
                "text",
                "you@company.com",
                required=False,
                help="لـ Jira Cloud بس. اتركه فاضي لـ Server/Data Center.",
            ),
            FieldSpec("api_token", "API token", "password", "", help="من إعدادات حسابك في Atlassian"),
        ],
    )
    capabilities = frozenset(
        {
            "search",
            "create",
            "update",
            "subtasks",
            "link",
            "attach",
            "worklog",
            "dev",
            "comment_edit",
            "mentions",
            "sprint",
            "projects",
            "users",
        }
    )

    # -- transport -----------------------------------------------------------------------

    @property
    def cloud(self) -> bool:
        site = str(self.config.get("site_url", "")).lower()
        return ".atlassian.net" in site or (bool(self.config.get("email")) and ".jira.com" in site)

    @property
    def api(self) -> str:
        return f"{self.base()}/rest/api/{'3' if self.cloud else '2'}"

    def headers(self) -> dict[str, str]:
        if self.config.get("email"):
            raw = f"{self.config.get('email', '')}:{self.secret}".encode()
            auth = f"Basic {base64.b64encode(raw).decode()}"
        else:
            auth = f"Bearer {self.secret}"
        return {"Authorization": auth, "Accept": "application/json", "Content-Type": "application/json"}

    def base(self) -> str:
        return str(self.config.get("site_url", "")).rstrip("/")

    def _to_text(self, value: Any) -> str:
        return adf_to_markdown(value) if self.cloud else wiki_to_markdown(value)

    def _from_text(self, text: str) -> Any:
        return markdown_to_adf(text) if self.cloud else markdown_to_wiki(text)

    def _me(self) -> dict[str, str]:
        """How this API names the user when assigning."""
        meta = self.config.get("_account") or {}
        if self.cloud:
            return {"accountId": meta.get("account_id", "")}
        return {"name": meta.get("name", "")}

    def _person(self, person_id: str) -> dict[str, str] | None:
        if person_id == "me":
            return self._me()
        if not person_id:
            return None
        return {"accountId": person_id} if self.cloud else {"name": person_id}

    # -- reading -------------------------------------------------------------------------

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.api}/myself")).json()
        return Account(
            label=f"{data.get('displayName', '')} ({data.get('emailAddress') or data.get('name', '')})",
            meta={"account_id": data.get("accountId"), "name": data.get("name") or data.get("key")},
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
        "attachment",
        "subtasks",
        "issuelinks",
        "comment",
        "fixVersions",
    ]
    CATEGORY = {"new": "todo", "indeterminate": "in_progress", "done": "done"}

    async def _jql(self, jql: str, limit: int, fields: list[str] | None = None) -> list[Issue]:
        fields = fields or self.FIELDS
        async with self.client() as c:
            if self.cloud:
                # Atlassian is mid-migration between search endpoints; try the newer one first.
                resp = await c.post(f"{self.api}/search/jql", json={"jql": jql, "fields": fields, "maxResults": limit})
                if resp.status_code in (404, 410):
                    resp = await c.get(
                        f"{self.api}/search", params={"jql": jql, "fields": ",".join(fields), "maxResults": limit}
                    )
            else:
                resp = await c.post(f"{self.api}/search", json={"jql": jql, "fields": fields, "maxResults": limit})
            data = self.check(resp).json()
        return [self._issue(raw) for raw in data.get("issues", [])]

    async def list_issues(
        self, query: str | None = None, limit: int = 30, include_done: bool = False
    ) -> list[Issue]:
        jql = "assignee = currentUser()" + ("" if include_done else " AND statusCategory != Done")
        if query:
            safe = _jql_text(query)
            jql = f'assignee = currentUser() AND (summary ~ "{safe}*" OR key = "{safe.upper()}")'
        return await self._jql(jql + " ORDER BY updated DESC", limit)

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        """JQL as written; plain words become a text search."""
        q = query.strip()
        looks_jql = any(t in q for t in ("=", "~", " in ", " IN ", "ORDER BY", "order by", "!=", "is EMPTY"))
        jql = q if looks_jql else f'text ~ "{_jql_text(q)}" ORDER BY updated DESC'
        return await self._jql(jql, limit)

    def _issue(self, raw: dict[str, Any]) -> Issue:
        fields = raw.get("fields", {})
        key = raw.get("key", "")
        description = fields.get("description")
        status = fields.get("status") or {}
        seconds = fields.get("timeoriginalestimate")
        links = []
        for link in fields.get("issuelinks") or []:
            kind = (link.get("type") or {}).get("name", "")
            other = link.get("outwardIssue") or link.get("inwardIssue") or {}
            label = (link.get("type") or {}).get("outward" if link.get("outwardIssue") else "inward", kind)
            links.append({"kind": label, "key": other.get("key", ""), "title": (other.get("fields") or {}).get("summary", "")})
        comment = fields.get("comment") or {}
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
            description=self._to_text(description) if description else None,
            priority=(fields.get("priority") or {}).get("name"),
            issue_type=(fields.get("issuetype") or {}).get("name"),
            assignee=(fields.get("assignee") or {}).get("displayName"),
            reporter=(fields.get("reporter") or {}).get("displayName"),
            labels=list(fields.get("labels") or []),
            due_date=fields.get("duedate"),
            parent=((fields.get("parent") or {}).get("key")),
            estimate=f"{round(seconds / 3600, 1)}h" if isinstance(seconds, (int, float)) else None,
            milestone=", ".join(v.get("name", "") for v in fields.get("fixVersions") or []) or None,
            comment_count=comment.get("total") if isinstance(comment, dict) else None,
            attachments=[
                {"name": a.get("filename", ""), "url": a.get("content", ""), "size": a.get("size"), "mime": a.get("mimeType")}
                for a in fields.get("attachment") or []
            ],
            subtasks=[s.get("key", "") for s in fields.get("subtasks") or []],
            links=links,
            extra={"project_key": (fields.get("project") or {}).get("key")},
        )

    async def get_issue(self, key: str) -> Issue:
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.api}/issue/{quote(key)}", params={"fields": ",".join(self.FIELDS)})
            ).json()
        return self._issue(data)

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        me = (self.config.get("_account") or {}).get("account_id") or (self.config.get("_account") or {}).get("name")
        async with self.client() as c:
            data = self.check(
                await c.get(f"{self.api}/issue/{quote(key)}/comment", params={"maxResults": limit, "orderBy": "-created"})
            ).json()
        out = []
        for c_ in data.get("comments", []):
            author = c_.get("author") or {}
            out.append(
                IssueComment(
                    id=str(c_.get("id")),
                    author=author.get("displayName", ""),
                    body=self._to_text(c_.get("body")),
                    created_at=c_.get("created"),
                    mine=bool(me) and me in (author.get("accountId"), author.get("name")),
                )
            )
        return out

    async def list_projects(self) -> list[Project]:
        async with self.client() as c:
            if self.cloud:
                data = self.check(await c.get(f"{self.api}/project/search", params={"maxResults": 100})).json()
                rows = data.get("values", [])
            else:
                rows = self.check(await c.get(f"{self.api}/project")).json()
        return [
            Project(id=str(p.get("id")), key=p.get("key", ""), name=p.get("name", ""), url=f"{self.base()}/browse/{p.get('key')}")
            for p in rows
        ]

    async def list_issue_types(self, project: str) -> list[IssueType]:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.api}/project/{quote(project)}")).json()
        return [
            IssueType(id=str(t.get("id")), name=t.get("name", ""), subtask=bool(t.get("subtask")))
            for t in data.get("issueTypes", [])
        ]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        params: dict[str, Any] = {"maxResults": 50}
        if project:
            params["project"] = project
        params["query" if self.cloud else "username"] = query or ("" if self.cloud else ".")
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.api}/user/assignable/search", params=params)).json()
        return [
            Person(
                id=u.get("accountId") or u.get("name", ""),
                name=u.get("displayName", ""),
                handle=u.get("emailAddress") or u.get("name"),
            )
            for u in rows
        ]

    async def list_priorities(self) -> list[str]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.api}/priority")).json()
        return [p.get("name", "") for p in rows]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        async with self.client() as c:
            data = self.check(await c.get(f"{self.api}/issue/{quote(key)}/transitions")).json()
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

    async def dev_links(self, key: str) -> list[DevLink]:
        """The issue's remote links — where Jira's GitHub/GitLab/Bitbucket apps put pull
        requests and branches through the public API."""
        async with self.client() as c:
            rows = self.check(await c.get(f"{self.api}/issue/{quote(key)}/remotelink")).json()
        out = []
        for row in rows:
            obj = row.get("object") or {}
            url = obj.get("url", "")
            kind = "pull_request" if "/pull/" in url or "/merge_requests/" in url or "pull-requests" in url else "link"
            status = (obj.get("status") or {}).get("resolved")
            out.append(DevLink(kind=kind, title=obj.get("title", url), url=url, state="closed" if status else None))
        return out

    async def mentions(self, since: str | None = None) -> list[Activity]:
        """Jira has no public notifications API; the closest official signal is issues you
        watch or report that changed since the last look."""
        window = since or "-1d"
        clause = f'updated >= "{window}"' if window.startswith("-") else f'updated >= "{window[:16].replace("T", " ")}"'
        jql = f"(watcher = currentUser() OR reporter = currentUser()) AND assignee != currentUser() AND {clause} ORDER BY updated DESC"
        issues = await self._jql(jql, 30, ["summary", "updated", "status"])
        return [
            Activity(kind="update", key=i.key, title=i.title, url=i.url, at=i.updated_at, text=i.status, id=f"{i.key}@{i.updated_at}")
            for i in issues
        ]

    async def sprint(self, project: str | None = None, mine: bool = False) -> tuple[str | None, list[Issue]]:
        jql = "sprint in openSprints()"
        if project:
            jql += f' AND project = "{_jql_text(project)}"'
        if mine:
            jql += " AND assignee = currentUser()"
        try:
            issues = await self._jql(jql + " ORDER BY rank", 100)
        except IntegrationError as exc:
            raise IntegrationError(tr("ما في سبرنت مفتوح (أو Jira Software مو مفعّل): {0}", exc)) from exc
        return tr("السبرنت الحالي"), issues

    # -- writing -------------------------------------------------------------------------

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        async with self.client() as c:
            data = self.check(await c.post(f"{self.api}/issue/{quote(key)}/comment", json={"body": self._from_text(body)})).json()
        return str(data.get("id")) if data.get("id") else None

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(
                await c.put(f"{self.api}/issue/{quote(key)}/comment/{comment_id}", json={"body": self._from_text(body)})
            )

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(await c.delete(f"{self.api}/issue/{quote(key)}/comment/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        options = await self.list_statuses(key)
        target = next((o for o in options if o.id == status_id), None) or next(
            (o for o in options if o.name.lower() == status_id.lower()), None
        )
        if not target:
            raise IntegrationError(tr("هالانتقال مو متاح على هالمهمة هلق."))
        async with self.client() as c:
            self.check(await c.post(f"{self.api}/issue/{quote(key)}/transitions", json={"transition": {"id": target.id}}))
        # Read it back: a workflow can land the issue somewhere other than the transition's
        # nominal target, and the user should see where it actually ended up.
        try:
            return (await self.get_issue(key)).status
        except IntegrationError:
            return target.name

    async def complete(self, key: str) -> str:
        self.guard_write()
        options = await self.list_statuses(key)
        done = next((o for o in options if o.category == "done"), None)
        if not done:
            raise IntegrationError(tr("ما في انتقال متاح لحالة «مكتمل» على هالمهمة."))
        return await self.set_status(key, done.id)

    def _fields(self, title: str | None, description: str | None, priority: str | None, due: str | None,
                estimate: float | None, assignee: str | None, labels: list[str] | None, parent: str | None) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        if title is not None:
            fields["summary"] = title
        if description is not None:
            fields["description"] = self._from_text(description) if description else None
        if priority:
            fields["priority"] = {"name": priority}
        if due is not None:
            fields["duedate"] = due or None
        if estimate is not None:
            fields["timetracking"] = {"originalEstimate": f"{max(estimate, 0):g}h"}
        if assignee is not None:
            fields["assignee"] = self._person(assignee)
        if labels is not None:
            fields["labels"] = [label.replace(" ", "-") for label in labels]
        if parent:
            fields["parent"] = {"key": parent}
        return fields

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        issue_type = draft.issue_type
        if not issue_type:
            types = await self.list_issue_types(draft.project)
            wanted = [t for t in types if t.subtask == bool(draft.parent)]
            issue_type = next((t.name for t in wanted if t.name.lower() in TASK_TYPE_NAMES), None) or (
                wanted[0].name if wanted else "Task"
            )
        fields = self._fields(
            draft.title, draft.description, draft.priority, draft.due_date, draft.estimate_hours,
            draft.assignee, draft.labels or None, draft.parent,
        )
        fields["project"] = {"key": draft.project}
        fields["issuetype"] = {"name": issue_type}
        async with self.client() as c:
            resp = await c.post(f"{self.api}/issue", json={"fields": fields})
            if resp.status_code == 400 and "timetracking" in fields:
                # Time tracking switched off for this project: create it without the estimate.
                fields.pop("timetracking")
                resp = await c.post(f"{self.api}/issue", json={"fields": fields})
            data = self.check(resp).json()
        return await self.get_issue(data.get("key", ""))

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        fields = self._fields(
            changes.title, changes.description, changes.priority, changes.due_date, changes.estimate_hours,
            changes.assignee, changes.labels, changes.parent,
        )
        update: dict[str, Any] = {}
        if changes.add_labels or changes.remove_labels:
            update["labels"] = [{"add": x.replace(" ", "-")} for x in changes.add_labels] + [
                {"remove": x.replace(" ", "-")} for x in changes.remove_labels
            ]
        if fields or update:
            async with self.client() as c:
                self.check(await c.put(f"{self.api}/issue/{quote(key)}", json={"fields": fields, "update": update}))
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        self.guard_write()
        name, side = LINK_TYPES.get(kind, LINK_TYPES["relates"])
        # Jira reads "outwardIssue <outward description> inwardIssue": A blocks B is
        # outwardIssue=A, inwardIssue=B.
        pair = {"outwardIssue": {"key": key}, "inwardIssue": {"key": other}}
        if side == "inward":
            pair = {"outwardIssue": {"key": other}, "inwardIssue": {"key": key}}
        async with self.client() as c:
            self.check(await c.post(f"{self.api}/issueLink", json={"type": {"name": name}, **pair}))

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        headers = {k: v for k, v in self.headers().items() if k != "Content-Type"}
        headers["X-Atlassian-Token"] = "no-check"
        async with self.client() as c:
            c.headers.clear()
            c.headers.update(headers)
            rows = self.check(
                await c.post(f"{self.api}/issue/{quote(key)}/attachments", files={"file": (filename, data, mime)})
            ).json()
        return rows[0].get("content") if rows else None

    async def log_work(self, key: str, seconds: int, comment: str = "") -> None:
        self.guard_write()
        body: dict[str, Any] = {"timeSpentSeconds": max(60, int(seconds))}
        if comment:
            body["comment"] = self._from_text(comment)
        async with self.client() as c:
            self.check(await c.post(f"{self.api}/issue/{quote(key)}/worklog", json=body))
