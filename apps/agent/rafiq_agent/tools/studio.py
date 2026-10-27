"""From any chat, the model can start a design or a motion reel: `design_start` and
`motion_start` create the real session (the same as the Designs and Motion pages do) and
start its first turn on the server. The chat shows it as a card with a live thumbnail;
the work itself happens in that session, never in this chat."""

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import func, select

from rafiq_agent.core import identity as identity_core
from rafiq_agent.core import studio
from rafiq_agent.motion import scene as rms
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import DesignIdentity, LlmModel
from rafiq_agent.tools.base import Tool, ToolResult

# (kind, id, chat_id, title) → the chat adds a card for it
OnCreated = Callable[[str, str, str, str], Awaitable[None]]

KINDS = ["موقع", "تطبيق ويب", "لوحة تحكم", "تطبيق موبايل", "صفحة هبوط"]
LAYOUTS = ["طويلة بقصة كاملة", "قصيرة ومركّزة", "شبكة بطاقات", "تحريرية بأعمدة", "شاشات تطبيق"]
DIRECTIONS = ["عربي RTL", "إنجليزي LTR", "الاثنين"]


class DesignStartTool(Tool):
    name = "design_start"
    # Like create_tasks: it starts work that runs on its own; nothing on disk changes here.
    category = "read_only"
    description = (
        "ابدأ جلسة تصميم كاملة لما المستخدم يطلب يصمم موقع أو صفحة هبوط أو شاشة تطبيق أو لوحة تحكم. "
        "رفيق بيفتح تصميم جديد بمعاينة حيّة ودليل التصميم ومراجعاته، والنموذج بيشتغل عليه بالخلفية — "
        "والمستخدم بيشوفه كبطاقة بهالمحادثة وبيفتحه منها. لا تكتب HTML بهالمحادثة. "
        "عبّي الـ brief من كلام المستخدم (وافترض الباقي بشكل معقول). الهوية البصرية: identity إذا ذكر هوية "
        "محفوظة بالاسم، أو reference_urls إذا عطاك مواقع بيحب شكلها، وإلا style الأنسب للمنتج."
    )
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "اسم قصير للتصميم (2–4 كلمات، متل اسم المنتج)"},
            "kind": {"type": "string", "enum": KINDS},
            "what": {"type": "string", "description": "شو بيعمل المنتج، بجملة وحدة"},
            "who": {"type": "string", "description": "مين المستخدم"},
            "action": {"type": "string", "description": "أهم إجراء بالشاشة الأولى"},
            "layout": {"type": "string", "enum": LAYOUTS},
            "sections": {"type": "string", "description": "شو لازم يكون فيها"},
            "direction": {"type": "string", "enum": DIRECTIONS},
            "constraints": {"type": "string"},
            "identity": {"type": "string", "description": "اسم هوية بصرية محفوظة عند المستخدم (اختياري)"},
            "reference_urls": {"type": "array", "items": {"type": "string"}, "description": "مواقع بيحب المستخدم شكلها — الهوية بتنبنى منها"},
            "style": {"type": "string", "enum": list(identity_core.STYLES), "description": "أسلوب الهوية لما ما في هوية محفوظة ولا مراجع"},
        },
        "required": ["title", "kind", "what", "who", "action"],
    }

    def __init__(self, model_id: str, workspace_id: str | None, on_created: OnCreated) -> None:
        self.model_id = model_id
        self.workspace_id = workspace_id
        self.on_created = on_created

    async def _identity(self, model: LlmModel, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
        """The identity to design with, and where it came from (for the model's answer)."""
        name = str(args.get("identity") or "").strip()
        if name:
            async with SessionLocal() as session:
                row = (await session.execute(select(DesignIdentity).where(func.lower(DesignIdentity.name) == name.lower()))).scalars().first()
            if row is not None:
                return row.data, f"the saved identity «{row.name}»"
        urls = [str(u) for u in args.get("reference_urls") or [] if str(u).strip()]
        if urls:
            from rafiq_agent.core import identity_refs

            refs = await identity_refs.references_from(urls, [])
            if any(r.ok for r in refs):
                try:
                    data, _why = await identity_refs.propose(model, refs, str(args.get("what") or ""))
                    return data, f"an identity built from {', '.join(urls)}"
                except Exception:  # noqa: BLE001 - fall back to a style rather than fail the design
                    pass
        style = args.get("style") if args.get("style") in identity_core.STYLES else "minimal"
        return identity_core.normalize({"style": style}), f"the «{style}» style"

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            model = await session.get(LlmModel, self.model_id)
        if model is None:
            return ToolResult(ok=False, output="the chat's model is gone")
        brief = {k: str(args[k]).strip() for k in ("kind", "what", "who", "action", "layout", "sections", "direction", "constraints") if args.get(k)}
        brief.setdefault("direction", DIRECTIONS[0])
        if args.get("reference_urls"):
            brief["references"] = ", ".join(str(u) for u in args["reference_urls"])
        identity, source = await self._identity(model, args)
        async with SessionLocal() as session:
            model = await session.get(LlmModel, self.model_id)
            design = await studio.new_design(session, model, brief, identity=identity, title=args.get("title"), workspace_id=self.workspace_id)
        from rafiq_agent.core.designs import brief_message

        await studio.kick_off(design.chat_id, brief_message(design.brief or brief), self.model_id)
        await self.on_created("design", design.id, design.chat_id, design.title)
        return ToolResult(
            ok=True,
            output=(
                f"Started the design «{design.title}» with {source}. It is being designed now in its own session, "
                "with a live preview; the user sees it as a card in this chat and opens it from there. "
                "Tell them that in one or two sentences — don't describe or write the design here."
            ),
        )


class MotionStartTool(Tool):
    name = "motion_start"
    category = "read_only"
    description = (
        "ابدأ مشروع موشن (فيديو/ريل متحرك) لما المستخدم يطلب فيديو أو ريل أو إعلان متحرك. رفيق بيفتح "
        "مشروع جديد بمحرك الموشن، والنموذج بيبنيه بالخلفية مع مراجعة لقطة لقطة، والمستخدم بيشوفه كبطاقة "
        "بهالمحادثة وبيفتحه منها. اكتب بـ prompt كل شي بده الريل: الفكرة، الرسالة، النصوص بالحرف، اللقطات، "
        "النبرة، الألوان إذا ذكرها — لأن جلسة الموشن ما بتشوف هالمحادثة."
    )
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "اسم قصير للمشروع"},
            "prompt": {"type": "string", "description": "الطلب كامل ومكتفي بذاته"},
            "aspect": {"type": "string", "enum": list(rms.ASPECTS), "description": "9:16 للريل، 1:1 أو 4:5 للمنشور، 16:9 للعرض"},
            "duration": {"type": "number", "description": "المدة بالثواني (الافتراضي 15)"},
        },
        "required": ["prompt"],
    }

    def __init__(self, model_id: str, workspace_id: str | None, on_created: OnCreated) -> None:
        self.model_id = model_id
        self.workspace_id = workspace_id
        self.on_created = on_created

    async def run(self, args: dict[str, Any]) -> ToolResult:
        prompt = str(args.get("prompt") or "").strip()
        if not prompt:
            return ToolResult(ok=False, output="prompt is required")
        aspect = args.get("aspect") if args.get("aspect") in rms.ASPECTS else "9:16"
        try:
            duration = max(2.0, min(float(args.get("duration") or 15), 180.0))
        except (TypeError, ValueError):
            duration = 15.0
        async with SessionLocal() as session:
            model = await session.get(LlmModel, self.model_id)
            if model is None:
                return ToolResult(ok=False, output="the chat's model is gone")
            project = await studio.new_motion(session, model, title=args.get("title"), aspect=aspect, duration=duration, workspace_id=self.workspace_id)
        await studio.kick_off(project.chat_id, prompt, self.model_id)
        await self.on_created("motion", project.id, project.chat_id, project.title)
        return ToolResult(
            ok=True,
            output=(
                f"Started the motion project «{project.title}» ({aspect}, {duration:.0f}s). It is being built now in its own "
                "session; the user sees it as a card in this chat and opens it from there. Tell them that briefly."
            ),
        )
