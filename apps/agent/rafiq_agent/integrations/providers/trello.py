"""Trello cards, through the REST API with an API key and a user token. A board is a
project, its lists are the statuses, and checklists hold the subtasks."""

import re
from typing import Any

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    Account,
    Activity,
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

BASE = "https://api.trello.com/1"
DONE_LISTS = re.compile(r"\b(done|complete|completed|finished|closed|shipped)\b|منجز|مكتمل|خلص", re.I)
DOING_LISTS = re.compile(r"\b(doing|in progress|wip|review)\b|قيد|عم", re.I)
CARD_FIELDS = "name,desc,url,shortLink,due,dueComplete,idList,idBoard,labels,dateLastActivity,idMembers,badges,closed"


class TrelloIntegration(Integration):
    spec = ProviderSpec(
        id="trello",
        name="Trello",
        icon="trello",
        color="#0079BF",
        docs_url="https://trello.com/power-ups/admin",
        blurb="كروت Trello المسندة إلك — القوائم كحالات، checklists كمهام فرعية، ومرفقات.",
        secret="token",
        scopes="API key من Power-Up admin، وبعدين token بصلاحية read,write من نفس الصفحة.",
        fields=[
            FieldSpec("api_key", "API key", "text", ""),
            FieldSpec("token", "Token", "password", ""),
        ],
    )
    capabilities = frozenset({"search", "create", "update", "subtasks", "link", "attach", "comment_edit", "mentions", "projects", "users"})

    def headers(self) -> dict[str, str]:
        # Trello's documented header form keeps the token out of URLs and logs.
        return {
            "Authorization": f'OAuth oauth_consumer_key="{self.config.get("api_key", "")}", oauth_token="{self.secret}"',
            "Accept": "application/json",
        }

    def _me(self) -> dict[str, Any]:
        return self.config.get("_account") or {}

    async def verify(self) -> Account:
        async with self.client() as c:
            data = self.check(await c.get(f"{BASE}/members/me", params={"fields": "fullName,username,id"})).json()
        return Account(label=f"{data.get('fullName', '')} (@{data.get('username', '')})", meta={"user_id": data.get("id"), "username": data.get("username")})

    async def _lists(self, board: str) -> dict[str, str]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/boards/{board}/lists", params={"fields": "name"})).json()
        return {r["id"]: r.get("name", "") for r in rows}

    async def _boards(self) -> dict[str, str]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/members/me/boards", params={"filter": "open", "fields": "name"})).json()
        return {b["id"]: b.get("name", "") for b in rows}

    def _issue(self, raw: dict[str, Any], lists: dict[str, str], boards: dict[str, str]) -> Issue:
        status = lists.get(raw.get("idList", ""), "")
        done = raw.get("dueComplete") or bool(DONE_LISTS.search(status)) or raw.get("closed")
        badges = raw.get("badges") or {}
        return Issue(
            key=raw.get("shortLink") or raw.get("id", ""),
            id=raw.get("id", ""),
            title=raw.get("name", ""),
            url=raw.get("url", ""),
            status=status,
            status_category="done" if done else ("in_progress" if DOING_LISTS.search(status) else "todo"),
            project=boards.get(raw.get("idBoard", "")),
            updated_at=raw.get("dateLastActivity"),
            description=raw.get("desc") or None,
            labels=[label.get("name") or label.get("color", "") for label in raw.get("labels") or []],
            due_date=(raw.get("due") or "")[:10] or None,
            comment_count=badges.get("comments"),
            extra={"board": raw.get("idBoard"), "list": raw.get("idList")},
        )

    async def _cards(self, rows: list[dict[str, Any]]) -> list[Issue]:
        boards = await self._boards()
        lists: dict[str, str] = {}
        for board in {r.get("idBoard") for r in rows if r.get("idBoard")}:
            try:
                lists.update(await self._lists(board))
            except IntegrationError:
                continue
        return [self._issue(r, lists, boards) for r in rows]

    async def list_issues(self, query: str | None = None, limit: int = 30, include_done: bool = False) -> list[Issue]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/members/me/cards", params={"filter": "visible", "fields": CARD_FIELDS})).json()
        issues = await self._cards(rows)
        if not include_done:
            issues = [i for i in issues if i.status_category != "done"]
        if query:
            q = query.lower()
            issues = [i for i in issues if q in i.title.lower() or q in i.key.lower()]
        issues.sort(key=lambda i: i.updated_at or "", reverse=True)
        return issues[:limit]

    async def search(self, query: str, limit: int = 50) -> list[Issue]:
        async with self.client() as c:
            data = self.check(
                await c.get(f"{BASE}/search", params={"query": query, "modelTypes": "cards", "cards_limit": min(limit, 1000), "card_fields": CARD_FIELDS})
            ).json()
        return await self._cards(data.get("cards", []))

    async def get_issue(self, key: str) -> Issue:
        async with self.client() as c:
            raw = self.check(await c.get(f"{BASE}/cards/{key}", params={"fields": CARD_FIELDS, "checklists": "all", "attachments": "true"})).json()
        issue = (await self._cards([raw]))[0]
        issue.subtasks = [
            f"{'☑' if item.get('state') == 'complete' else '☐'} {item.get('name', '')}"
            for cl in raw.get("checklists") or []
            for item in cl.get("checkItems") or []
        ]
        issue.attachments = [{"name": a.get("name", ""), "url": a.get("url", ""), "size": a.get("bytes"), "mime": a.get("mimeType")} for a in raw.get("attachments") or []]
        return issue

    async def list_comments(self, key: str, limit: int = 50) -> list[IssueComment]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/cards/{key}/actions", params={"filter": "commentCard", "limit": limit})).json()
        me = self._me().get("user_id")
        return [
            IssueComment(
                id=a.get("id"),
                author=(a.get("memberCreator") or {}).get("fullName", ""),
                body=(a.get("data") or {}).get("text", ""),
                created_at=a.get("date"),
                mine=bool(me) and a.get("idMemberCreator") == me,
            )
            for a in rows
        ]

    async def list_projects(self) -> list[Project]:
        return [Project(id=k, key=k, name=v) for k, v in (await self._boards()).items()]

    async def list_users(self, project: str | None = None, query: str = "") -> list[Person]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/boards/{project}/members")).json()
        return [Person(id=m["id"], name=m.get("fullName", ""), handle=m.get("username")) for m in rows if query.lower() in m.get("fullName", "").lower()]

    async def list_labels(self, project: str | None = None) -> list[str]:
        if not project:
            return []
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/boards/{project}/labels")).json()
        return [label.get("name") or label.get("color", "") for label in rows]

    async def list_statuses(self, key: str) -> list[StatusOption]:
        issue = await self.get_issue(key)
        lists = await self._lists(issue.extra.get("board", ""))
        return [
            StatusOption(id=i, name=n, category="done" if DONE_LISTS.search(n) else ("in_progress" if DOING_LISTS.search(n) else "todo"))
            for i, n in lists.items()
        ]

    async def mentions(self, since: str | None = None) -> list[Activity]:
        async with self.client() as c:
            rows = self.check(
                await c.get(f"{BASE}/members/me/notifications", params={"filter": "mentionedOnCard,addedToCard,commentCard,changeCard", "read_filter": "unread", "limit": 50})
            ).json()
        out = []
        for n in rows:
            if since and (n.get("date") or "") <= since:
                continue
            card = (n.get("data") or {}).get("card") or {}
            kind = {"mentionedOnCard": "mention", "addedToCard": "assigned", "commentCard": "comment"}.get(n.get("type", ""), "update")
            out.append(
                Activity(
                    kind=kind, key=card.get("shortLink", card.get("id", "")), title=card.get("name", ""),
                    url=f"https://trello.com/c/{card.get('shortLink', '')}", at=n.get("date"),
                    actor=(n.get("memberCreator") or {}).get("fullName"), text=((n.get("data") or {}).get("text") or "")[:300] or None,
                    id=n.get("id"),
                )
            )
        return out

    # -- writing -------------------------------------------------------------------------

    async def add_comment(self, key: str, body: str) -> str | None:
        self.guard_write()
        async with self.client() as c:
            data = self.check(await c.post(f"{BASE}/cards/{key}/actions/comments", params={"text": body})).json()
        return data.get("id")

    async def edit_comment(self, key: str, comment_id: str, body: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(await c.put(f"{BASE}/actions/{comment_id}", params={"text": body}))

    async def delete_comment(self, key: str, comment_id: str) -> None:
        self.guard_write()
        async with self.client() as c:
            self.check(await c.delete(f"{BASE}/actions/{comment_id}"))

    async def set_status(self, key: str, status_id: str) -> str:
        self.guard_write()
        options = await self.list_statuses(key)
        target = next((o for o in options if o.id == status_id or o.name.lower() == status_id.lower()), None)
        if not target:
            raise IntegrationError(tr("ما في قائمة بهالاسم على اللوح."))
        async with self.client() as c:
            self.check(await c.put(f"{BASE}/cards/{key}", params={"idList": target.id}))
        return target.name

    async def complete(self, key: str) -> str:
        self.guard_write()
        options = await self.list_statuses(key)
        done = next((o for o in options if o.category == "done"), None)
        if done:
            return await self.set_status(key, done.id)
        async with self.client() as c:
            self.check(await c.put(f"{BASE}/cards/{key}", params={"dueComplete": "true"}))
        return tr("مكتملة")

    async def _label_ids(self, board: str, names: list[str]) -> list[str]:
        async with self.client() as c:
            rows = self.check(await c.get(f"{BASE}/boards/{board}/labels")).json()
        by_name = {(r.get("name") or r.get("color", "")).lower(): r["id"] for r in rows}
        return [by_name[n.lower()] for n in names if n.lower() in by_name]

    async def create_issue(self, draft: IssueDraft) -> Issue:
        self.guard_write()
        if draft.parent:
            # A subtask on Trello is a checklist item on the parent card.
            parent = await self.get_issue(draft.parent)
            async with self.client() as c:
                lists = self.check(await c.get(f"{BASE}/cards/{parent.id}/checklists")).json()
                checklist = lists[0]["id"] if lists else self.check(
                    await c.post(f"{BASE}/cards/{parent.id}/checklists", params={"name": "Tasks"})
                ).json()["id"]
                self.check(await c.post(f"{BASE}/checklists/{checklist}/checkItems", params={"name": draft.title}))
            return await self.get_issue(draft.parent)
        lists = await self._lists(draft.project)
        target = next((i for i, n in lists.items() if draft.issue_type and n.lower() == draft.issue_type.lower()), None) or next(iter(lists), None)
        if not target:
            raise IntegrationError(tr("هاللوح ما فيه ولا قائمة."))
        params: dict[str, Any] = {"idList": target, "name": draft.title, "desc": draft.description or ""}
        if draft.due_date:
            params["due"] = draft.due_date
        if draft.assignee:
            params["idMembers"] = self._me().get("user_id", "") if draft.assignee == "me" else draft.assignee
        if draft.labels:
            params["idLabels"] = ",".join(await self._label_ids(draft.project, draft.labels))
        async with self.client() as c:
            data = self.check(await c.post(f"{BASE}/cards", params=params)).json()
        return await self.get_issue(data.get("shortLink") or data["id"])

    async def update_issue(self, key: str, changes: IssueChanges) -> Issue:
        self.guard_write()
        issue = await self.get_issue(key)
        params: dict[str, Any] = {}
        if changes.title is not None:
            params["name"] = changes.title
        if changes.description is not None:
            params["desc"] = changes.description
        if changes.due_date is not None:
            params["due"] = changes.due_date or "null"
        if changes.assignee is not None:
            params["idMembers"] = (self._me().get("user_id", "") if changes.assignee == "me" else changes.assignee) or ""
        labels = changes.labels
        if labels is None and (changes.add_labels or changes.remove_labels):
            labels = list(dict.fromkeys([x for x in issue.labels if x not in changes.remove_labels] + changes.add_labels))
        if labels is not None:
            params["idLabels"] = ",".join(await self._label_ids(issue.extra.get("board", ""), labels))
        if params:
            async with self.client() as c:
                self.check(await c.put(f"{BASE}/cards/{key}", params=params))
        return await self.get_issue(key)

    async def link_issues(self, key: str, other: str, kind: str) -> None:
        """Trello's own way: the other card's URL attached to this one."""
        self.guard_write()
        target = await self.get_issue(other)
        async with self.client() as c:
            self.check(await c.post(f"{BASE}/cards/{key}/attachments", params={"url": target.url, "name": f"{kind}: {target.title}"}))

    async def attach(self, key: str, filename: str, data: bytes, mime: str) -> str | None:
        self.guard_write()
        async with self.client() as c:
            up = self.check(await c.post(f"{BASE}/cards/{key}/attachments", files={"file": (filename, data, mime)}, data={"name": filename})).json()
        return up.get("url")
