"""The tools a design chat gets on top of the usual ones: the designer's review of its
current documents."""

from typing import Any

from sqlalchemy import select

from rafiq_agent.core.design_review import format_review, review
from rafiq_agent.core.designs import review_guide
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Design
from rafiq_agent.tools.base import Tool, ToolResult


class DesignReviewTool(Tool):
    name = "design_review"
    category = "read_only"
    description = (
        "مراجعة المصمم للتصميم الحالي: الهوية (الألوان، الخطوط، الـ tokens)، التسلسل (حجم العنوان، "
        "الأقسام)، الحركة والـ hover، الموبايل والـ RTL، وعلامات التصميم الآلي — بملاحظات واضحة لكل مشكلة، "
        "مع طريقة المراجعة والتصليح. استعمله لما يطلب المستخدم مراجعة أو تحسين."
    )
    parameters = {"type": "object", "properties": {}}

    def __init__(self, chat_id: str) -> None:
        self.chat_id = chat_id

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            design = (await session.execute(select(Design).where(Design.chat_id == self.chat_id))).scalar_one_or_none()
            if design is None:
                return ToolResult(ok=False, output="no design in this chat")
            files = [f for f in design.files or [] if f.get("html")]
            if not files and design.preview_html:
                files = [{"name": design.title, "html": design.preview_html}]
            kind = str((design.brief or {}).get("kind") or "")
            identity = design.identity
        if not files:
            return ToolResult(ok=False, output="there is no design yet — write the first version, then review it")
        parts = []
        for f in files:
            report = format_review(review(f["html"], kind, identity))
            parts.append(f"«{f.get('name') or 'design'}»\n{report}" if len(files) > 1 else report)
        return ToolResult(ok=True, output="\n\n".join(parts) + "\n\n" + review_guide())
