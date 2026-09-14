"""Agent-facing tools so a chat or task can read, comment on, and close tracker issues."""

from typing import Any

from sqlalchemy import select

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import Integration, IntegrationError
from rafiq_agent.integrations.providers import build
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import IntegrationAccount
from rafiq_agent.storage.secrets import get_api_key
from rafiq_agent.tools.base import Tool, ToolResult


async def _accounts() -> list[tuple[IntegrationAccount, Integration]]:
    async with SessionLocal() as session:
        rows = (await session.execute(select(IntegrationAccount))).scalars().all()
    return [
        (r, build(r.provider, r.config or {}, get_api_key(r.secret_ref)))
        for r in rows
        if r.verify_ok is not False
    ]


async def _resolve(key: str) -> tuple[IntegrationAccount, Integration]:
    """Finds which connected account owns an issue key (keys are provider-shaped)."""
    pairs = await _accounts()
    if not pairs:
        raise IntegrationError(tr("ما في حساب مربوط. اربط Jira أو Linear أو GitHub أو GitLab من صفحة الربط."))
    for row, client in pairs:
        try:
            await client.get_issue(key)
            return row, client
        except Exception:  # noqa: BLE001 - try the next account
            continue
    raise IntegrationError(tr("ما لقيت المهمة «{0}» بأي حساب مربوط.", key))


class IssueListTool(Tool):
    name = "issue_list"
    category = "read_only"
    description = "اعرض المهام المسندة للمستخدم من أنظمة التتبع المربوطة (Jira/Linear/GitHub/GitLab)."
    parameters = {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "بحث اختياري بالعنوان أو المفتاح"}},
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            pairs = await _accounts()
            if not pairs:
                return ToolResult(ok=False, output=tr("ما في حساب مربوط."))
            lines = []
            for row, client in pairs:
                for issue in await client.list_issues(args.get("query"), 20):
                    lines.append(f"[{row.provider}] {issue.key} — {issue.title} ({issue.status}) {issue.url}")
            return ToolResult(ok=True, output="\n".join(lines) or tr("ما في مهام مفتوحة مسندة إلك."))
        except IntegrationError as exc:
            return ToolResult(ok=False, output=str(exc))


class IssueReadTool(Tool):
    name = "issue_read"
    category = "read_only"
    description = "اقرأ تفاصيل مهمة واحدة بمفتاحها (مثل PROJ-12 أو owner/repo#7)."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}},
        "required": ["key"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            _, client = await _resolve(args["key"])
            issue = await client.get_issue(args["key"])
        except IntegrationError as exc:
            return ToolResult(ok=False, output=str(exc))
        body = tr("{0} — {1}\nالحالة: {2}\nالرابط: {3}", issue.key, issue.title, issue.status, issue.url)
        if issue.description:
            body += f"\n\n{issue.description[:4000]}"
        return ToolResult(ok=True, output=body)


class IssueCommentTool(Tool):
    name = "issue_comment"
    category = "write"
    description = "اكتب تعليق على مهمة بنظام التتبع."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "body": {"type": "string"}},
        "required": ["key", "body"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            _, client = await _resolve(args["key"])
            await client.add_comment(args["key"], args["body"])
        except IntegrationError as exc:
            return ToolResult(ok=False, output=str(exc))
        return ToolResult(ok=True, output=tr("انكتب التعليق على {0}.", args["key"]))


class IssueCompleteTool(Tool):
    name = "issue_complete"
    category = "write"
    description = "علّم مهمة كمكتملة/مغلقة، مع تعليق اختياري قبلها."
    parameters = {
        "type": "object",
        "properties": {"key": {"type": "string"}, "comment": {"type": "string"}},
        "required": ["key"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            _, client = await _resolve(args["key"])
            if args.get("comment"):
                await client.add_comment(args["key"], args["comment"])
            status = await client.complete(args["key"])
        except IntegrationError as exc:
            return ToolResult(ok=False, output=str(exc))
        return ToolResult(ok=True, output=tr("{0} صارت «{1}».", args["key"], status))


def issue_tools() -> list[Tool]:
    return [IssueListTool(), IssueReadTool(), IssueCommentTool(), IssueCompleteTool()]
