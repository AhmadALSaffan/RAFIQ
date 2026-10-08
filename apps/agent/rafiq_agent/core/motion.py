"""Motion projects: changing a scene (always a version), the brand kit it's drawn with, and
the checks — in the engine when an app window is open, in Python when not."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.core.agent_runtime import load_settings
from rafiq_agent.motion import brand, bridge, lint
from rafiq_agent.motion import scene as rms
from rafiq_agent.motion.patch import PatchError, apply_patch
from rafiq_agent.storage.models import MotionProject, MotionVersion, Workspace


class MotionChangeError(ValueError):
    def __init__(self, message: str, errors: list[dict[str, str]] | None = None) -> None:
        super().__init__(message)
        self.errors = errors or []


def now() -> datetime:
    return datetime.now(UTC)


async def kit_for(session: AsyncSession, project: MotionProject, scene: dict[str, Any] | None = None) -> dict[str, Any]:
    """The kit a scene is drawn with: a template it names, else its workspace's, else the
    app's default, else the dark template."""
    scene = scene or project.scene
    named = scene.get("brand")
    if named and named != "workspace" and named in brand.TEMPLATES:
        return brand.template(named)
    if project.workspace_id:
        ws = await session.get(Workspace, project.workspace_id)
        if ws and ws.brand_kit:
            return brand.normalize(ws.brand_kit)
    settings = await load_settings()
    if settings.brand_kit:
        return brand.normalize(settings.brand_kit)
    return brand.template(None)


def write_scene_file(project: MotionProject) -> None:
    """A readable copy of the scene in the project folder (the database stays the truth)."""
    try:
        folder = Path(project.folder)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "scene.json").write_text(json.dumps(project.scene, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


async def save_version(
    session: AsyncSession, project: MotionProject, new_scene: dict[str, Any], patch: list[dict[str, Any]] | None, author: str, summary: str
) -> MotionVersion:
    project.version = (project.version or 0) + 1
    project.scene = new_scene
    project.updated_at = now()
    version = MotionVersion(project_id=project.id, number=project.version, scene=new_scene, patch=patch, author=author, summary=summary[:200])
    session.add(version)
    await session.flush()
    write_scene_file(project)
    return version


async def change(
    session: AsyncSession, project: MotionProject, patch: list[dict[str, Any]], author: str, summary: str
) -> tuple[dict[str, Any], MotionVersion]:
    """Applies a JSON Patch, validates the result, and stores it as a new version. A patch
    that fails or leaves an invalid scene changes nothing."""
    try:
        new_scene = apply_patch(project.scene, patch)
    except PatchError as exc:
        raise MotionChangeError(str(exc)) from exc
    errors = rms.validate(new_scene)
    if errors:
        raise MotionChangeError("the patched scene isn't valid", errors)
    version = await save_version(session, project, new_scene, patch, author, summary)
    return new_scene, version


async def restore(session: AsyncSession, project: MotionProject, number: int) -> MotionVersion:
    row = await session.execute(
        select(MotionVersion).where(MotionVersion.project_id == project.id, MotionVersion.number == number)
    )
    old = row.scalar_one_or_none()
    if old is None:
        raise MotionChangeError(f"no version {number}")
    return await save_version(session, project, old.scene, None, "restore", f"restore v{number}")


async def check(scene: dict[str, Any], kit: dict[str, Any], target: str = "mp4", full: bool = True) -> dict[str, Any]:
    """Every issue in the scene. With an app window open the engine checks the pixels too
    (contrast, overflow, safe area, overlap, jumps); otherwise only the structural rules run
    and the result says so."""
    issues = lint.structural(scene, kit, target)
    engine = False
    if full and bridge.connected():
        try:
            result = await bridge.call("lint", {"scene": scene, "kit": kit, "target": target}, timeout=60)
            issues = result.get("issues", issues)
            engine = True
        except (bridge.EngineUnavailable, bridge.EngineError):
            pass
    return {"issues": issues, "engine": engine, "blocking": lint.has_blocking(issues)}


async def inspect(scene: dict[str, Any], kit: dict[str, Any], times: list[float]) -> str:
    """The text report of chosen frames: what's where, contrast, gaps, issues."""
    if bridge.connected():
        try:
            result = await bridge.call("inspect", {"scene": scene, "kit": kit, "times": times}, timeout=60)
            return str(result.get("report", ""))
        except (bridge.EngineUnavailable, bridge.EngineError):
            pass
    return (
        "(the app window isn't open, so frames can't be measured — this is the structure only)\n"
        + rms.summarize(scene)
    )


async def frames(scene: dict[str, Any], kit: dict[str, Any], times: list[float], max_side: int = 960) -> list[str]:
    """PNG data URLs of chosen frames, for a model that can look."""
    result = await bridge.call("frames", {"scene": scene, "kit": kit, "times": times, "maxSide": max_side}, timeout=90)
    return list(result.get("images", []))


VISION_PROMPT = (
    "أنت عين مخرج موشن قرافك. رح توصلك فريمات من فيديو (كل وحدة مكتوب وقتها). لكل فريم اكتب بنقاط قصيرة: "
    "شو مبيّن وين (أعلى/وسط/أسفل، يمين/يسار)، شو مش مقروء أو صغير أو ضعيف التباين، شو متداخل أو مقصوص أو "
    "لازق بالحافة، وشو مش مصفوف أو مزحوم. بعدين سطرين عن الإحساس العام (فاضي؟ مزحوم؟ متوازن؟). "
    "ما تمدح وما تقترح كود — صف بس، بدقة، وبالعربي."
)


async def describe_frames(images: list[str], times: list[float]) -> str:
    """The vision helper: a model that can see describes the frames in words, for a chat model
    that can't. Raises LookupError when none is set in Settings."""
    from rafiq_agent.auth.resolve import llm_for
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    chosen = (await load_settings()).vision_model_id
    if not chosen:
        raise LookupError("no vision model")
    async with SessionLocal() as session:
        model = await session.get(LlmModel, chosen)
    if model is None or model.verify_ok is False:
        raise LookupError("the vision model is gone or not working")
    parts: list[dict[str, Any]] = []
    for t, url in zip(times, images, strict=False):
        parts.append({"type": "text", "text": f"الفريم عند {t:.2f}s:"})
        parts.append({"type": "image_url", "image_url": {"url": url}})
    llm = llm_for(model)
    try:
        return (await llm.complete([{"role": "system", "content": VISION_PROMPT}, {"role": "user", "content": parts}], max_tokens=1200)).strip()
    finally:
        await llm.aclose()


def format_issues(issues: list[dict[str, Any]], limit: int = 25) -> str:
    if not issues:
        return "✓ no issues"
    lines = []
    for issue in issues[:limit]:
        where = f" [{issue['layer']}]" if issue.get("layer") else ""
        when = f" @ {issue['t']:.2f}s" if isinstance(issue.get("t"), (int, float)) else ""
        lines.append(f"{issue['code']}{where}{when}: {issue['message']} → {issue.get('fix', '')}")
    if len(issues) > limit:
        lines.append(f"… and {len(issues) - limit} more")
    return "\n".join(lines)


MOTION_SYSTEM_PROMPT = (
    "أنت مخرج موشن قرافك داخل تطبيق رفيق. بتبني فيديوهات (ريلز، إنترو، شرح، رسوم بيانية، عرض تطبيق، "
    "وتعديل فيديو المستخدم) بكتابة **مشهد** بصيغة RMS v1، والإنجن بيرسم كل فريم.\n\n"
    "القواعد:\n"
    "1. مرجع الصيغة (مهارة motion) موجود تحت بهالرسالة — اشتغل منه مباشرة وما تقرأ ملفات بالبداية. "
    "schema.json بـ skill_read بس إذا احتجت تفصيل خاصية مش موجود بالمرجع.\n"
    "2. ما بتكتب بكسلات ولا خطوط مباشرة: المواقع بوحدات الشبكة والستايلات من سلّم الخط. الألوان مفتوحة: "
    "توكنز brand.* لتضل على الهوية، أو أي hex أو gradient لما التصميم بده — بس انتبه للتباين.\n"
    "3. بتعدّل المشهد بس بـ motion_patch_scene، مش بإعادة كتابته. خلّي كل patch مقطع كامل (كل طبقات المقطع "
    "بـ patch وحدة)، مش طبقة طبقة. كل patch بيصير نسخة وبيرجعلك نتيجة الفحص — صلّح أي خطأ قبل ما تكمّل.\n"
    "  دوّر على كل الأيقونات اللي بدك ياها بطلب وحدة: motion_assets action=icons مع queries (قائمة كلمات).\n"
    "4. لما يخلص الفحص بدون أخطاء: راجع الفريمات المهمة بـ motion_render_frames (إذا ما بتشوف صور بيرجعلك "
    "وصفها مكتوب)، و motion_inspect للقياسات الدقيقة (المسافات والتباين).\n"
    "5. اكتب للمستخدم بالعربي شو عملت وليش، بجمل قصيرة. ما تلصق المشهد كامل بالرد.\n"
    "6. إذا ما في مزوّد صوت، لا تعرض تعليق صوتي — استعمل كابشن نصي وموسيقى ومؤثرات.\n"
    "7. التصدير بيعمله المستخدم من زر «تصدير»، أو إنت بـ motion_render إذا طلب صراحة."
)


def skill_note() -> str:
    """The motion skill, as the model reads it with every turn of a motion chat."""
    text = (rms.SCHEMA_PATH.parent / "SKILL.md").read_text(encoding="utf-8")
    if text.startswith("---"):
        text = text.split("---", 2)[2]
    return "مرجع صيغة المشهد (مهارة motion):\n" + text.strip()


def kit_summary(kit: dict[str, Any]) -> str:
    c = kit["colors"]
    t = kit["type"]
    return (
        "الـ brand kit لهالمشروع:\n"
        f"- الألوان: {', '.join(f'brand.{k}={v}' for k, v in c.items())}\n"
        f"- الخطوط: display={kit['fonts']['display']}، body={kit['fonts']['body']}، latin={kit['fonts']['latin']}\n"
        f"- سلّم الخط (px على 1080): {', '.join(f'{k}={v}' for k, v in t.items())}\n"
        f"- سلّم المسافات (وحدات): {kit['spacing']} · الزوايا: {kit['radius']}\n"
        f"- شخصية الحركة: {kit['motion']['personality']} (دخول {kit['motion']['enter']} ث، خروج {kit['motion']['exit']} ث، {kit['motion']['ease']})"
    )


def project_note(project: MotionProject, kit: dict[str, Any]) -> str:
    """What the motion chat's model reads about its project on every turn."""
    return (
        f"المشروع: «{project.title}» — النسخة الحالية v{project.version}.\n"
        f"{kit_summary(kit)}\n\n"
        f"المشهد الآن (ملخص؛ للتفاصيل motion_get_scene):\n{rms.summarize(project.scene)}"
    )
