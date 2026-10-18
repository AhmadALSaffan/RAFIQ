"""The tools a design chat gets on top of the usual ones: the designer's review of its
current documents."""

from typing import Any

from sqlalchemy import select

from rafiq_agent.core import design_slop
from rafiq_agent.core.design_review import format_review, review
from rafiq_agent.core.designs import review_guide
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Design
from rafiq_agent.tools.base import Tool, ToolResult


async def _documents(chat_id: str) -> tuple[list[dict[str, Any]], str, dict | None] | None:
    """The design's documents (name and HTML), its kind, and the identity it's made with."""
    async with SessionLocal() as session:
        design = (await session.execute(select(Design).where(Design.chat_id == chat_id))).scalar_one_or_none()
        if design is None:
            return None
        files = [f for f in design.files or [] if f.get("html")]
        if not files and design.preview_html:
            files = [{"name": design.title, "html": design.preview_html}]
        return files, str((design.brief or {}).get("kind") or ""), design.identity


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
        found = await _documents(self.chat_id)
        if found is None:
            return ToolResult(ok=False, output="no design in this chat")
        files, kind, identity = found
        if not files:
            return ToolResult(ok=False, output="there is no design yet — write the first version, then review it")
        parts = []
        for f in files:
            report = format_review(review(f["html"], kind, identity))
            parts.append(f"«{f.get('name') or 'design'}»\n{report}" if len(files) > 1 else report)
        return ToolResult(ok=True, output="\n\n".join(parts) + "\n\n" + review_guide())


class DesignSlopCheckTool(Tool):
    name = "design_slop_check"
    category = "read_only"
    description = (
        "هل التصميم شكله معمول بالذكاء الاصطناعي (AI slop)؟ بيعدّ العلامات اللي بتفضح التصميم الآلي: التدرّج البنفسجي، "
        "الـ glow والبقع المغبّشة، النص المتدرّج، الإيموجي كأيقونات، ترتيب الأقسام القالبي، تلات كروت متطابقة، أرقام الهيرو، "
        "العبارات الجاهزة بالعربي والإنجليزي، والحركة الموحّدة — مع الدليل الكامل وشو بيعمل الاستوديو بدالها. "
        "استعمله لما يطلب المستخدم يتأكد إن التصميم مش AI slop."
    )
    parameters = {"type": "object", "properties": {}}

    def __init__(self, chat_id: str) -> None:
        self.chat_id = chat_id

    async def run(self, args: dict[str, Any]) -> ToolResult:
        found = await _documents(self.chat_id)
        if found is None:
            return ToolResult(ok=False, output="no design in this chat")
        files, _kind, identity = found
        if not files:
            return ToolResult(ok=False, output="there is no design yet — write the first version, then check it")
        parts = []
        for f in files:
            report = design_slop.format_report(design_slop.check(f["html"], identity))
            parts.append(f"«{f.get('name') or 'design'}»\n{report}" if len(files) > 1 else report)
        return ToolResult(ok=True, output="\n\n".join(parts) + "\n\n" + design_slop.slop_guide())
