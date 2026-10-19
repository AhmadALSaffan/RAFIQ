"""Agent-facing tools for the connected trackers: find, read, create, change, split, link,
attach, log time, and see what's waiting on the user. Every change goes through
core/issues.py, so it's recorded with who asked for it and can be undone where the
tracker allows; every write shows its exact effect on the permission card first."""

import mimetypes
from pathlib import Path
from typing import Any

from sqlalchemy import select

from rafiq_agent.core import issues as svc
from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import (
    LINK_KINDS,
    Integration,
    IntegrationError,
    Issue,
    IssueChanges,
    IssueDraft,
)
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import IntegrationAccount, IssueNotice
from rafiq_agent.tools.base import Tool, ToolResult

MAX_ATTACH = 25 * 1024 * 1024
ACCOUNT_PROP = {"type": "string", "description": "اسم الحساب أو المنصّة (jira, github…) — اختياري إذا في حساب واحد"}


def _line(issue: Issue, provider: str = "") -> str:
    bits = [f"[{provider}] " if provider else "", f"{issue.key} — {issue.title} ({issue.status})"]
    if issue.assignee:
        bits.append(f" · {issue.assignee}")
    if issue.due_date:
        bits.append(f" · {tr('استحقاق')} {issue.due_date}")
    bits.append(f" {issue.url}")
    return "".join(bits)


def _full(issue: Issue) -> str:
    rows = [
        f"{issue.key} — {issue.title}",
        f"{tr('الحالة')}: {issue.status}" + (f" ({issue.status_category})" if issue.status_category else ""),
        f"{tr('الرابط')}: {issue.url}",
    ]
    for label, value in (
        (tr("المشروع"), issue.project),
        (tr("النوع"), issue.issue_type),
        (tr("الأولوية"), issue.priority),
        (tr("مسندة لـ"), issue.assignee),
        (tr("منشئها"), issue.reporter),
        (tr("الاستحقاق"), issue.due_date),
        (tr("التقدير"), issue.estimate),
        (tr("المهمة الأم"), issue.parent),
        (tr("الإصدار"), issue.milestone),
    ):
        if value:
            rows.append(f"{label}: {value}")
    if issue.labels:
        rows.append(f"{tr('الوسوم')}: {', '.join(issue.labels)}")
    if issue.subtasks:
        rows.append(f"{tr('المهام الفرعية')}: {', '.join(issue.subtasks[:30])}")
    if issue.links:
        rows.append(tr("مرتبطة بـ") + ": " + "; ".join(f"{link['kind']} {link['key']} {link.get('title', '')}".strip() for link in issue.links[:20]))
    if issue.attachments:
        rows.append(tr("مرفقات") + ": " + ", ".join(a.get("name", "") for a in issue.attachments[:20]))
    if issue.description:
        rows.append("\n" + issue.description[:6000])
    return "\n".join(rows)


async def pick(args: dict[str, Any], need: str | None = None) -> tuple[IntegrationAccount, Integration]:
    """The account a call means: named in `account` (name, id or provider), or the only one."""
    rows = await svc.accounts()
    if not rows:
        raise IntegrationError(tr("ما في حساب مربوط. اربط حساب من صفحة الربط."))
    wanted = str(args.get("account") or "").strip().lower()
    if wanted:
        rows = [r for r in rows if wanted in (r.id.lower(), r.provider.lower(), r.name.lower())] or [
            r for r in rows if wanted in r.name.lower() or wanted in r.provider.lower()
        ]
        if not rows:
            raise IntegrationError(tr("ما لقيت حساب «{0}».", args.get("account")))
    clients = [(r, svc.client_for(r)) for r in rows]
    if need:
        clients = [(r, c) for r, c in clients if c.supports(need)] or clients
    if len(clients) > 1 and not wanted:
        names = ", ".join(f"{r.name} ({r.provider})" for r, _ in clients)
        raise IntegrationError(tr("في أكتر من حساب ({0}) — حدد account.", names))
    return clients[0]


class IssueTool(Tool):
    """Shared plumbing: where the call came from, and the working folder for file paths."""

    def __init__(self, source: dict[str, Any] | None = None, root: Path | None = None) -> None:
        self.source = source or {}
        self.root = root

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            return ToolResult(ok=True, output=await self.go(args))
        except IntegrationError as exc:
            return ToolResult(ok=False, output=str(exc))
        except Exception as exc:  # noqa: BLE001 - a network failure goes back to the model as text
            return ToolResult(ok=False, output=tr("ما زبط: {0}", str(exc)[:300]))

    async def go(self, args: dict[str, Any]) -> str:  # pragma: no cover - each tool overrides
        raise NotImplementedError


# ── Reading ──────────────────────────────────────────────────────────────────────────────


class IssueListTool(IssueTool):
    name = "issue_list"
    category = "read_only"
    description = "اعرض المهام المسندة للمستخدم من كل الحسابات المربوطة (Jira/Linear/GitHub/GitLab/Azure/Trello/Asana/ClickUp/YouTrack…)."
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "بحث اختياري بالعنوان أو المفتاح"},
            "include_done": {"type": "boolean"},
        },
    }

    async def go(self, args: dict[str, Any]) -> str:
        lines = []
        for row in await svc.accounts():
            try:
                for issue in await svc.client_for(row).list_issues(args.get("query"), 25, bool(args.get("include_done"))):
                    lines.append(_line(issue, row.provider))
            except IntegrationError as exc:
                lines.append(f"[{row.provider}] {exc}")
        return "\n".join(lines) or tr("ما في مهام مفتوحة مسندة إلك.")


class IssueSearchTool(IssueTool):
    name = "issue_search"
    category = "read_only"
    description = (
        "دوّر على مهام بلغة المنصّة نفسها: JQL لـ Jira (مثل project = APP AND status = \"In Progress\")، "
        "بحث GitHub (repo:o/r is:open label:bug)، WIQL أو نص لـ Azure، استعلام YouTrack، أو نص عادي للباقي."
    )
    parameters = {
        "type": "object",
        "properties": {"query": {"type": "string"}, "account": ACCOUNT_PROP, "limit": {"type": "integer"}},
        "required": ["query"],
    }

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await pick(args, "search")
        found = await client.search(str(args["query"]), max(1, min(int(args.get("limit") or 30), 100)))
        return "\n".join(_line(i, row.provider) for i in found) or tr("ما في نتائج.")


class IssueReadTool(IssueTool):
    name = "issue_read"
    category = "read_only"
    description = "اقرأ مهمة بمفتاحها (مثل PROJ-12 أو owner/repo#7): كل حقولها، وصفها، مهامها الفرعية، روابطها، آخر التعليقات، والـ PRs المرتبطة."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "account": ACCOUNT_PROP, "comments": {"type": "integer", "description": "كم تعليق (الافتراضي 15)"}},
        "required": ["key"],
    }

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await svc.resolve(str(args["key"]), await _id_of(args))
        issue = await client.get_issue(str(args["key"]))
        body = _full(issue)
        try:
            comments = await client.list_comments(issue.key, max(1, min(int(args.get("comments") or 15), 50)))
            if comments:
                body += "\n\n" + tr("التعليقات") + ":\n" + "\n".join(
                    f"— {c.author} ({(c.created_at or '')[:16]}): {c.body[:1500]}" for c in comments
                )
        except IntegrationError:
            pass
        if client.supports("dev"):
            try:
                links = await client.dev_links(issue.key)
                if links:
                    body += "\n\n" + tr("الكود المرتبط") + ":\n" + "\n".join(f"— {d.kind}: {d.title} {d.url} {d.state or ''}" for d in links)
            except IntegrationError:
                pass
        return f"[{row.provider} · {row.name}]\n{body}"


async def _id_of(args: dict[str, Any]) -> str | None:
    """An explicit account narrows the lookup; otherwise every account is tried."""
    if not args.get("account"):
        return None
    row, _ = await pick(args)
    return row.id


class IssueProjectsTool(IssueTool):
    name = "issue_projects"
    category = "read_only"
    description = "اعرض المشاريع (أو الريبوهات، الفرق، اللوحات، القوائم) بحساب، وأنواع المهام والأشخاص بمشروع معيّن إذا حددته."
    parameters = {
        "type": "object",
        "properties": {"account": ACCOUNT_PROP, "project": {"type": "string", "description": "مفتاح مشروع لتشوف أنواعه وأشخاصه"}},
    }

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await pick(args, "projects")
        if project := args.get("project"):
            out = [f"{row.name} — {project}"]
            types = await client.list_issue_types(project)
            if types:
                out.append(tr("الأنواع") + ": " + ", ".join(t.name + (" (sub)" if t.subtask else "") for t in types))
            try:
                people = await client.list_users(project)
                if people:
                    out.append(tr("الأشخاص") + ": " + ", ".join(f"{p.name} [{p.id}]" for p in people[:60]))
            except IntegrationError:
                pass
            labels = await client.list_labels(project)
            if labels:
                out.append(tr("الوسوم") + ": " + ", ".join(labels[:80]))
            priorities = await client.list_priorities()
            if priorities:
                out.append(tr("الأولويات") + ": " + ", ".join(priorities))
            return "\n".join(out)
        projects = await client.list_projects()
        return "\n".join(f"{p.key} — {p.name}" for p in projects[:200]) or tr("ما في مشاريع.")


class IssueDevTool(IssueTool):
    name = "issue_dev"
    category = "read_only"
    description = "اعرض الـ pull requests والفروع والكوميتات المرتبطة بمهمة."
    parameters = {"type": "object", "properties": {"key": {"type": "string"}, "account": ACCOUNT_PROP}, "required": ["key"]}

    async def go(self, args: dict[str, Any]) -> str:
        _, client = await svc.resolve(str(args["key"]), await _id_of(args))
        links = await client.dev_links(str(args["key"]))
        return "\n".join(f"{d.kind}: {d.title} — {d.url} {d.state or ''}" for d in links) or tr("ما في كود مرتبط.")


class IssueReviewsTool(IssueTool):
    name = "issue_reviews"
    category = "read_only"
    description = "اعرض الـ pull/merge requests اللي طالبين من المستخدم يراجعها، من كل الحسابات."
    parameters = {"type": "object", "properties": {}}

    async def go(self, args: dict[str, Any]) -> str:  # noqa: ARG002
        lines = []
        for row in await svc.accounts():
            client = svc.client_for(row)
            if not client.supports("reviews"):
                continue
            try:
                lines += [_line(i, row.provider) for i in await client.review_requests()]
            except IntegrationError as exc:
                lines.append(f"[{row.provider}] {exc}")
        return "\n".join(lines) or tr("ما في طلبات مراجعة.")


class IssueSprintTool(IssueTool):
    name = "issue_sprint"
    category = "read_only"
    description = "اعرض مهام السبرنت / الـ cycle / الـ iteration الحالية بحساب (للفريق كله أو للمستخدم بس)."
    parameters = {
        "type": "object",
        "properties": {"account": ACCOUNT_PROP, "project": {"type": "string"}, "mine": {"type": "boolean"}},
    }

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await pick(args, "sprint")
        name, found = await client.sprint(args.get("project"), bool(args.get("mine")))
        return f"{name or ''}\n" + ("\n".join(_line(i, row.provider) for i in found) or tr("فاضي."))


class IssueNoticesTool(IssueTool):
    name = "issue_notices"
    category = "read_only"
    description = "اعرض آخر الإشارات والتنبيهات اللي لقاها رفيق: منشن، طلب مراجعة، مهمة جديدة انسندت، تعليق، تغيير حالة."
    parameters = {"type": "object", "properties": {"unread_only": {"type": "boolean"}, "limit": {"type": "integer"}}}

    async def go(self, args: dict[str, Any]) -> str:
        query = select(IssueNotice).order_by(IssueNotice.created_at.desc()).limit(max(1, min(int(args.get("limit") or 30), 100)))
        if args.get("unread_only"):
            query = query.where(IssueNotice.read_at.is_(None))
        async with SessionLocal() as session:
            rows = (await session.execute(query)).scalars().all()
        return "\n".join(
            f"[{n.kind}] {n.key} — {n.title}" + (f" · {n.actor}" if n.actor else "") + (f": {n.text[:200]}" if n.text else "") + f" {n.url or ''}"
            for n in rows
        ) or tr("ما في تنبيهات.")


# ── Writing ──────────────────────────────────────────────────────────────────────────────


class IssueCommentTool(IssueTool):
    name = "issue_comment"
    category = "write"
    description = "اكتب تعليق على مهمة (Markdown)."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "body": {"type": "string"}, "account": ACCOUNT_PROP},
        "required": ["key", "body"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"{tr('تعليق على')} {args.get('key')}:\n\n{args.get('body', '')}"

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await svc.resolve(str(args["key"]), await _id_of(args))
        await svc.comment(row, client, str(args["key"]), str(args["body"]), self.source)
        return tr("انكتب التعليق على {0}.", args["key"])


class IssueCompleteTool(IssueTool):
    name = "issue_complete"
    category = "write"
    description = "علّم مهمة كمكتملة/مغلقة، مع تعليق اختياري قبلها."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "comment": {"type": "string"}, "account": ACCOUNT_PROP},
        "required": ["key"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"{args.get('key')} ← {tr('مكتملة')}" + (f"\n\n{args['comment']}" if args.get("comment") else "")

    async def go(self, args: dict[str, Any]) -> str:
        key = str(args["key"])
        row, client = await svc.resolve(key, await _id_of(args))
        if args.get("comment"):
            await svc.comment(row, client, key, str(args["comment"]), self.source)
        return tr("{0} صارت «{1}».", key, await svc.complete(row, client, key, self.source))


class IssueSetStatusTool(IssueTool):
    name = "issue_set_status"
    category = "write"
    description = (
        "انقل مهمة لحالة محددة (بالاسم، مثل In Review أو Doing)، أو لفئة: todo أو in_progress أو done. "
        "بدون status بترجعلك الحالات المتاحة."
    )
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "status": {"type": "string"}, "comment": {"type": "string"}, "account": ACCOUNT_PROP},
        "required": ["key"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"{args.get('key')} ← {args.get('status', '?')}" + (f"\n\n{args['comment']}" if args.get("comment") else "")

    async def go(self, args: dict[str, Any]) -> str:
        key = str(args["key"])
        row, client = await svc.resolve(key, await _id_of(args))
        options = await client.list_statuses(key)
        wanted = str(args.get("status") or "").strip()
        if not wanted:
            return tr("الحالات المتاحة") + ": " + ", ".join(f"{o.name} ({o.category or '?'})" for o in options)
        target = next((o for o in options if o.name.lower() == wanted.lower() or o.id == wanted), None)
        if not target and wanted in ("todo", "in_progress", "done"):
            target = await client.status_for_category(key, wanted)
        if not target:
            target = next((o for o in options if wanted.lower() in o.name.lower()), None)
        if not target:
            return tr("ما في حالة «{0}». المتاح: {1}", wanted, ", ".join(o.name for o in options))
        if args.get("comment"):
            await svc.comment(row, client, key, str(args["comment"]), self.source)
        return tr("{0} صارت «{1}».", key, await svc.set_status(row, client, key, target.id, self.source))


DRAFT_PROPS: dict[str, Any] = {
    "title": {"type": "string"},
    "description": {"type": "string", "description": "Markdown"},
    "issue_type": {"type": "string", "description": "Task, Bug, Story… (اختياري)"},
    "labels": {"type": "array", "items": {"type": "string"}},
    "assignee": {"type": "string", "description": "id الشخص من issue_projects، أو me"},
    "priority": {"type": "string"},
    "due_date": {"type": "string", "description": "YYYY-MM-DD"},
    "estimate_hours": {"type": "number"},
}


def _draft(args: dict[str, Any], project: str, parent: str | None = None) -> IssueDraft:
    return IssueDraft(
        project=project,
        title=str(args.get("title", "")).strip(),
        description=str(args.get("description") or ""),
        issue_type=args.get("issue_type") or None,
        labels=[str(x) for x in args.get("labels") or []],
        assignee=args.get("assignee") or None,
        priority=args.get("priority") or None,
        due_date=args.get("due_date") or None,
        parent=parent or args.get("parent") or None,
        estimate_hours=float(args["estimate_hours"]) if args.get("estimate_hours") not in (None, "") else None,
    )


class IssueCreateTool(IssueTool):
    name = "issue_create"
    category = "write"
    description = (
        "أنشئ مهمة جديدة بمشروع (project = مفتاح مشروع Jira، فريق Linear، owner/repo لـ GitHub، group/project لـ GitLab، "
        "مشروع Azure، لوح Trello، مشروع Asana، قائمة ClickUp…). استعمل issue_projects أول لتعرف المشاريع والأنواع والأشخاص."
    )
    parameters = {
        "type": "object",
        "properties": {"account": ACCOUNT_PROP, "project": {"type": "string"}, "parent": {"type": "string", "description": "مفتاح المهمة الأم (لمهمة فرعية)"}, **DRAFT_PROPS},
        "required": ["project", "title"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        draft = _draft(args, str(args.get("project", "")))
        head = f"{tr('مهمة جديدة بـ')} {draft.project}" + (f" ({tr('فرعية من')} {draft.parent})" if draft.parent else "")
        meta = ", ".join(f"{k}: {v}" for k, v in (("type", draft.issue_type), ("labels", ", ".join(draft.labels)), ("assignee", draft.assignee),
                                                    ("priority", draft.priority), ("due", draft.due_date)) if v)
        return f"{head}\n\n{draft.title}\n{meta}\n\n{draft.description[:2000]}"

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await pick(args, "create")
        issue = await svc.create(row, client, _draft(args, str(args["project"])), self.source)
        return tr("انعملت {0} — {1}\n{2}", issue.key, issue.title, issue.url)


class IssueUpdateTool(IssueTool):
    name = "issue_update"
    category = "write"
    description = "عدّل حقول مهمة: العنوان، الوصف، الوسوم (labels أو add_labels/remove_labels)، المسؤول (me، id، أو \"\" لإلغاء الإسناد)، الأولوية، الاستحقاق، التقدير، المهمة الأم."
    parameters = {
        "type": "object",
        "properties": {
            "key": {"type": "string"},
            "account": ACCOUNT_PROP,
            "add_labels": {"type": "array", "items": {"type": "string"}},
            "remove_labels": {"type": "array", "items": {"type": "string"}},
            "parent": {"type": "string"},
            **{k: v for k, v in DRAFT_PROPS.items() if k != "issue_type"},
        },
        "required": ["key"],
    }

    @staticmethod
    def _changes(args: dict[str, Any]) -> IssueChanges:
        return IssueChanges(
            title=args.get("title"),
            description=args.get("description"),
            labels=args.get("labels"),
            add_labels=list(args.get("add_labels") or []),
            remove_labels=list(args.get("remove_labels") or []),
            assignee=args.get("assignee"),
            priority=args.get("priority"),
            due_date=args.get("due_date"),
            estimate_hours=float(args["estimate_hours"]) if args.get("estimate_hours") not in (None, "") else None,
            parent=args.get("parent"),
        )

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"{tr('تعديل')} {args.get('key')}:\n\n{svc.describe(self._changes(args))}"

    async def go(self, args: dict[str, Any]) -> str:
        key = str(args["key"])
        changes = self._changes(args)
        if changes.empty():
            return tr("ما في شي لأعدّله.")
        row, client = await svc.resolve(key, await _id_of(args))
        issue = await svc.update(row, client, key, changes, self.source)
        return tr("تعدّلت {0}.", issue.key) + "\n" + _full(issue)[:1500]


class IssueSplitTool(IssueTool):
    name = "issue_split"
    category = "write"
    description = "قسّم مهمة لمهام فرعية: بتنعمل كل وحدة تحت المهمة الأم (أو مربوطة فيها إذا المنصّة ما بتدعم الفرعية)."
    parameters = {
        "type": "object",
        "properties": {
            "key": {"type": "string"},
            "account": ACCOUNT_PROP,
            "subtasks": {
                "type": "array",
                "items": {"type": "object", "properties": dict(DRAFT_PROPS), "required": ["title"]},
            },
        },
        "required": ["key", "subtasks"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        items = args.get("subtasks") or []
        return f"{tr('مهام فرعية تحت')} {args.get('key')}:\n" + "\n".join(f"{i}. {s.get('title', '')}" for i, s in enumerate(items, 1))

    async def go(self, args: dict[str, Any]) -> str:
        key = str(args["key"])
        row, client = await svc.resolve(key, await _id_of(args))
        parent = await client.get_issue(key)
        project = parent.extra.get("project_key") or parent.extra.get("team_key") or parent.extra.get("project") or parent.extra.get("board") or parent.extra.get("list_id") or parent.project or ""
        made = []
        for spec in (args.get("subtasks") or [])[:30]:
            if not isinstance(spec, dict) or not spec.get("title"):
                continue
            if client.supports("subtasks"):
                child = await svc.create(row, client, _draft(spec, str(project), parent=key), self.source)
            else:
                child = await svc.create(row, client, _draft(spec, str(project)), self.source)
                if client.supports("link"):
                    await svc.link(row, client, child.key, key, "relates", self.source)
            made.append(f"{child.key} — {child.title}")
        return tr("انعملت {0} مهمة فرعية تحت {1}:", len(made), key) + "\n" + "\n".join(made)


class IssueLinkTool(IssueTool):
    name = "issue_link"
    category = "write"
    description = "اربط مهمتين: relates أو blocks (هي بتعيق التانية) أو blocked_by أو duplicates."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "other": {"type": "string"}, "kind": {"type": "string", "enum": list(LINK_KINDS)}, "account": ACCOUNT_PROP},
        "required": ["key", "other", "kind"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"{args.get('key')} {args.get('kind')} {args.get('other')}"

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await svc.resolve(str(args["key"]), await _id_of(args))
        await svc.link(row, client, str(args["key"]), str(args["other"]), str(args.get("kind") or "relates"), self.source)
        return tr("انربطت {0} بـ {1}.", args["key"], args["other"])


class IssueAttachTool(IssueTool):
    name = "issue_attach"
    category = "write"
    description = "ارفع ملف من مجلد العمل (صورة، تصميم، فيديو، تقرير) كمرفق على مهمة."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "path": {"type": "string", "description": "مسار الملف (نسبي لمجلد العمل أو مطلق)"}, "account": ACCOUNT_PROP},
        "required": ["key", "path"],
    }

    def _file(self, raw: str) -> Path:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            if self.root is None:
                raise IntegrationError(tr("حدد مسار مطلق للملف."))
            path = self.root / path
        path = path.resolve()
        if not path.is_file():
            raise IntegrationError(tr("الملف مو موجود: {0}", path))
        if path.stat().st_size > MAX_ATTACH:
            raise IntegrationError(tr("الملف أكبر من 25 ميغا."))
        return path

    async def preview(self, args: dict[str, Any]) -> str | None:
        try:
            path = self._file(str(args.get("path", "")))
            return f"{path.name} ({path.stat().st_size // 1024} KB) ← {args.get('key')}"
        except IntegrationError as exc:
            return str(exc)

    async def go(self, args: dict[str, Any]) -> str:
        path = self._file(str(args["path"]))
        row, client = await svc.resolve(str(args["key"]), await _id_of(args))
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        url = await svc.attach(row, client, str(args["key"]), path.name, path.read_bytes(), mime, self.source)
        return tr("انرفع {0} على {1}.", path.name, args["key"]) + (f" {url}" if url else "")


class IssueLogWorkTool(IssueTool):
    name = "issue_log_work"
    category = "write"
    description = "سجّل وقت اشتغلته على مهمة (بالدقايق) مع ملاحظة اختيارية."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "minutes": {"type": "number"}, "note": {"type": "string"}, "account": ACCOUNT_PROP},
        "required": ["key", "minutes"],
    }

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"{args.get('key')}: {args.get('minutes')} {tr('دقيقة')}" + (f" — {args['note']}" if args.get("note") else "")

    async def go(self, args: dict[str, Any]) -> str:
        row, client = await svc.resolve(str(args["key"]), await _id_of(args))
        await svc.log_work(row, client, str(args["key"]), int(float(args["minutes"]) * 60), str(args.get("note") or ""), self.source)
        return tr("انسجّل الوقت على {0}.", args["key"])


def issue_tools(source: dict[str, Any] | None = None, root: Path | None = None) -> list[Tool]:
    return [
        cls(source, root)
        for cls in (
            IssueListTool,
            IssueSearchTool,
            IssueReadTool,
            IssueProjectsTool,
            IssueDevTool,
            IssueReviewsTool,
            IssueSprintTool,
            IssueNoticesTool,
            IssueCommentTool,
            IssueCompleteTool,
            IssueSetStatusTool,
            IssueCreateTool,
            IssueUpdateTool,
            IssueSplitTool,
            IssueLinkTool,
            IssueAttachTool,
            IssueLogWorkTool,
        )
    ]
