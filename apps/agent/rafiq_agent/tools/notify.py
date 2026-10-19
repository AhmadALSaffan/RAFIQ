"""Posting to the user's team channels (Slack, Teams, Discord) — a summary, a stand-up,
release notes. It leaves the machine, so it asks first ("notify_send") unless always
allowed."""

from typing import Any

from sqlalchemy import select

from rafiq_agent.integrations import channels
from rafiq_agent.integrations.base import IntegrationError
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import NotifyChannel
from rafiq_agent.storage.secrets import get_api_key
from rafiq_agent.tools.base import Tool, ToolResult


async def _channels() -> list[NotifyChannel]:
    async with SessionLocal() as session:
        return list((await session.execute(select(NotifyChannel).order_by(NotifyChannel.created_at))).scalars().all())


class NotifyPostTool(Tool):
    name = "notify_post"
    category = "write"
    description = (
        "ابعت رسالة لقناة الفريق المربوطة (Slack أو Teams أو Discord): ملخص، stand-up، ملاحظات إصدار، تنبيه. "
        "channel = اسم القناة كما ربطها المستخدم. text بـ Markdown بسيط."
    )
    parameters = {
        "type": "object",
        "properties": {
            "channel": {"type": "string"},
            "title": {"type": "string"},
            "text": {"type": "string"},
            "link": {"type": "string", "description": "رابط اختياري"},
        },
        "required": ["channel", "title"],
    }

    async def _pick(self, name: str) -> NotifyChannel:
        rows = await _channels()
        if not rows:
            raise IntegrationError("ما في قنوات مربوطة. المستخدم بيربطها من صفحة الربط.")
        wanted = name.strip().lower()
        row = next((r for r in rows if r.name.lower() == wanted), None) or next(
            (r for r in rows if wanted in r.name.lower() or wanted == r.kind), None
        )
        if not row:
            raise IntegrationError("ما لقيت قناة بهالاسم. المتاح: " + ", ".join(f"{r.name} ({r.kind})" for r in rows))
        return row

    async def preview(self, args: dict[str, Any]) -> str | None:
        return f"→ {args.get('channel')}\n\n{args.get('title', '')}\n{args.get('text', '')}"

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            row = await self._pick(str(args.get("channel", "")))
            url = get_api_key(row.secret_ref)
            if not url:
                return ToolResult(ok=False, output="رابط القناة مو محفوظ.")
            await channels.post(row.kind, url, str(args.get("title", "")), str(args.get("text") or ""), args.get("link") or None)
        except IntegrationError as exc:
            return ToolResult(ok=False, output=str(exc))
        return ToolResult(ok=True, output=f"انبعتت لـ {row.name}.")


class NotifyChannelsTool(Tool):
    name = "notify_channels"
    category = "read_only"
    description = "اعرض قنوات الفريق المربوطة (Slack/Teams/Discord) بأساميها."
    parameters = {"type": "object", "properties": {}}

    async def run(self, args: dict[str, Any]) -> ToolResult:  # noqa: ARG002
        rows = await _channels()
        return ToolResult(ok=True, output="\n".join(f"{r.name} ({r.kind})" for r in rows) or "ما في قنوات مربوطة.")


async def notify_tools() -> list[Tool]:
    return [NotifyChannelsTool(), NotifyPostTool()] if await _channels() else []
