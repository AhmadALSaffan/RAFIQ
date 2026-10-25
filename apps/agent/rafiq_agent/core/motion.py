"""Motion projects: changing a scene (always a version), the brand kit it's drawn with, and
the checks — in the engine when an app window is open, in Python when not."""

import json
import re
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
    session: AsyncSession,
    project: MotionProject,
    patch: list[dict[str, Any]],
    author: str,
    summary: str,
    notes: list[str] | None = None,
) -> tuple[dict[str, Any], MotionVersion]:
    """Applies a JSON Patch, validates the result, and stores it as a new version. A patch
    that fails or leaves an invalid scene changes nothing. Whatever it put outside the
    video's time is pulled back in (`notes` gets what moved)."""
    try:
        new_scene = apply_patch(project.scene, patch)
    except PatchError as exc:
        raise MotionChangeError(str(exc)) from exc
    moved = rms.keep_in_time(new_scene)
    if notes is not None:
        notes.extend(moved)
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


def review_guide() -> str:
    """How to review shot by shot (REVIEW.md): the mistakes and what a designer does instead."""
    return (rms.SCHEMA_PATH.parent / "REVIEW.md").read_text(encoding="utf-8").strip()


async def review(scene: dict[str, Any], kit: dict[str, Any]) -> str:
    """The director's review: the video cut into shots, each measured (hero size, smallest
    text, frame fill, centre, life while it holds, transitions), with a note per problem.
    Needs the engine — the measurements are of laid-out, animated frames."""
    result = await bridge.call("review", {"scene": scene, "kit": kit}, timeout=60)
    return str(result.get("report", ""))


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
    from rafiq_agent.core.vision import describe_images

    return await describe_images(images, [f"الفريم عند {t:.2f}s:" for t in times], VISION_PROMPT)


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


ENGINE_ONLY = (
    "0. الفيديو بينبني بس بمحرك رفيق: كل شي بالمشهد عبر أدوات motion_. ممنوع تكتب كود (HTML، CSS، "
    "JavaScript، three.js، SVG كصفحة، Python…) بالرد أو كملف — المستخدم ما بيشوف ولا بيشغّل كود هون، بس "
    "المشهد. حتى الطلب الصعب بينعمل بالمحرك: قلب أو شكل 3D = طبقة scene3d فيها `extrude` (شكل جاهز "
    "بـ `shape` أو مسار SVG) بمادة وإضاءة وكاميرا؛ أشكال 2D = طبقة shape؛ حركة = animate و keyframes. "
    "إذا شي فعلاً مش موجود بالمحرك، اعمل أقرب شي فيه وقول للمستخدم شو الفرق بجملة. "
    "وما تغيّر composition.fps إلا إذا المستخدم طلب رقم معيّن: 120 بيقطّع على أغلب الأجهزة.\n"
)

MOTION_SYSTEM_PROMPT = (
    "أنت مخرج ومصمم موشن قرافك محترف داخل تطبيق رفيق. بتبني فيديوهات (ريلز، إنترو، شرح، رسوم بيانية، "
    "عرض تطبيق، وتعديل فيديو المستخدم) بكتابة **مشهد** بصيغة RMS v1، والإنجن بيرسم كل فريم. المستوى المطلوب: "
    "متل شغل استوديو موشن محترف، مش شرائح نص.\n\n"
    "القواعد:\n"
    + ENGINE_ONLY
    + "1. تحت بهالرسالة في دليلين: «إخراج الموشن» (كيف بيفكّر المصمم المحترف: البريف، اللقطات، الألوان، الخطوط، "
    "الحركة) و«مرجع الصيغة». اشتغل منهم مباشرة وما تقرأ ملفات بالبداية. "
    "schema.json بـ skill_read بس إذا احتجت تفصيل خاصية مش موجود.\n"
    "2. قبل أول تعديل اكتب البريف (الفكرة، الألوان بالـ hex، الخطوط، قائمة اللقطات بالتوقيت) — "
    "إنت اللي بتقرر كل شي حسب فكرة الفيديو، ولكل فيديو هوية خاصة فيه. الألوان والخطوط مفتوحة بالكامل: "
    "حط ألوانك بـ scene.palette وخطوطك بـ scene.fonts (أي خط من Google Fonts بالاسم)، والـ brand kit "
    "مجرد افتراضي. المواقع بوحدات الشبكة والأحجام من سلّم الخط، وانتبه للتباين.\n"
    "3. بتعدّل المشهد بس بـ motion_patch_scene، مش بإعادة كتابته. خلّي كل patch مقطع كامل (كل طبقات المقطع "
    "بـ patch وحدة)، مش طبقة طبقة. كل patch بيصير نسخة وبيرجعلك نتيجة الفحص — صلّح أي خطأ قبل ما تكمّل.\n"
    "  دوّر على كل الأيقونات اللي بدك ياها بطلب وحدة: motion_assets action=icons مع queries (قائمة كلمات).\n"
    "4. لما يخلص الفحص بدون أخطاء: شغّل motion_review (مراجعة المخرج: كل لقطة مقاسة مع ملاحظات) وصلّح "
    "ملاحظاته لقطة لقطة، patch لكل لقطة، وأعدها لحد ما تخلص الملاحظات. بعدها إذا بتشوف صور راجع "
    "الفريمات بـ motion_render_frames، و motion_inspect للقياسات الدقيقة.\n"
    "  إذا طلب المستخدم مراجعة أو تحسين («راجع وحسّن»): ابدأ بـ motion_review واتبع طريقة المراجعة اللي "
    "بترجع معه.\n"
    "5. اكتب للمستخدم بالعربي شو عملت وليش، بجمل قصيرة. ما تلصق المشهد كامل بالرد.\n"
    "6. الصوت (موسيقى، مؤثرات، تعليق صوتي) بس إذا المستخدم طلبه — غير هيك الفيديو بلا صوت (audio: []). "
    "إذا ما في مزوّد صوت، لا تعرض تعليق صوتي — استعمل كابشن نصي.\n"
    "7. التصدير بيعمله المستخدم من زر «تصدير»، أو إنت بـ motion_render إذا طلب صراحة."
)


FREE_SYSTEM_PROMPT = (
    "أنت مخرج ومصمم موشن قرافك داخل تطبيق رفيق. بتبني فيديوهات بكتابة **مشهد** بصيغة RMS v1، والإنجن بيرسم "
    "كل فريم — 2D و 3D (طبقات scene3d). إنت صاحب القرار الإبداعي بالكامل: الفكرة، الألوان، الخطوط، اللقطات، "
    "الإيقاع، الكاميرا والـ 3D. ما في أسلوب مفروض عليك؛ اعمل الفيديو اللي بتشوفه أحسن شي لطلب المستخدم.\n\n"
    "اللي لازم:\n"
    + ENGINE_ONLY
    + "1. تحت في «مرجع الصيغة» (الحقول والأدوات). schema.json بـ skill_read إذا احتجت تفصيل.\n"
    "2. بتعدّل المشهد بس بـ motion_patch_scene. كل patch نسخة وبترجع مع الفحص — صلّح الأخطاء.\n"
    "3. كل شي جوا وقت الفيديو: الطبقة بتخلص قبل composition.duration، ومفاتيحها وحركاتها بين start و end تبعها.\n"
    "4. الصوت (موسيقى، مؤثرات، تعليق صوتي) بس إذا المستخدم طلبه — غير هيك audio: [].\n"
    "5. motion_render_frames و motion_inspect و motion_review موجودين لما بدك تتأكد بعينك أو بالأرقام.\n"
    "6. اكتب للمستخدم بالعربي شو عملت، بجمل قصيرة، بدون ما تلصق المشهد.\n"
    "7. التصدير من زر «تصدير»، أو motion_render إذا طلب صراحة."
)


# A reply that hands over code instead of building the scene: a fenced block, or a page.
_CODE = re.compile(r"```|<!doctype|<html|<script|<style|<canvas|import \* as THREE|new THREE\.", re.IGNORECASE)

ENGINE_ONLY_REDO = (
    "(رسالة من رفيق) ردّك فيه كود، وبالموشن الكود ما بيوصل للمستخدم ولا بيشتغل — "
    "الفيديو بس اللي بتبنيه بأدوات motion_. ابنِ نفس الطلب هلأ بالمحرك: motion_patch_scene "
    "(طبقة scene3d للـ 3D: extrude بـ shape أو مسار SVG، مواد، إضاءة، كاميرا؛ وطبقات 2D للباقي)، "
    "وبعدها اكتب للمستخدم بجملتين شو عملت، بلا كود."
)


def engine_only(text: str) -> str | None:
    """A motion reply's check: code in it is sent back to be built with the engine."""
    return ENGINE_ONLY_REDO if _CODE.search(text) else None


class CodeFilter:
    """Keeps code out of a motion chat as it streams: fenced blocks (and a page written
    without a fence, to the end of that step) never reach the screen. `engine_only` then
    sends that step back to be built with the engine."""

    _OPEN = re.compile(r"<!doctype|<html|<script|<style|<canvas", re.IGNORECASE)

    def __init__(self) -> None:
        self._held = ""
        self._fence = False
        self._page = False

    def feed(self, text: str) -> str:
        if self._page:
            return ""
        data = self._held + text
        self._held = ""
        out: list[str] = []
        while data:
            if self._fence:
                end = data.find("```")
                if end < 0:
                    # a closing fence may be split across deltas
                    self._held = data[-2:] if data.endswith("`") else ""
                    return "".join(out)
                data = data[end + 3 :]
                self._fence = False
                continue
            start = data.find("```")
            page = self._OPEN.search(data)
            if page and (start < 0 or page.start() < start):
                out.append(data[: page.start()])
                self._page = True
                return "".join(out)
            if start < 0:
                # hold back a tail that could be the start of a fence or a tag
                cut = len(data)
                while cut > 0 and data[cut - 1] == "`" and len(data) - cut < 2:
                    cut -= 1
                tag = data.rfind("<")
                if tag >= 0 and ">" not in data[tag:] and len(data) - tag < 10:
                    cut = min(cut, tag)
                out.append(data[:cut])
                self._held = data[cut:]
                return "".join(out)
            out.append(data[:start])
            data = data[start + 3 :]
            self._fence = True
        return "".join(out)

    def end_step(self) -> str:
        """A step finished: what was held back (if it turned out not to be code), and a
        clean state for the next step."""
        rest = "" if self._fence or self._page else self._held
        self._held, self._fence, self._page = "", False, False
        return rest


def system_prompt(guided: bool) -> str:
    """A weaker model gets the full method; a strong one the rules and its own judgment."""
    return MOTION_SYSTEM_PROMPT if guided else FREE_SYSTEM_PROMPT


def skill_note(guided: bool = True) -> str:
    """The motion skill, as the model reads it with every turn of a motion chat.

    Guided (a weaker model): how a professional directs (DIRECTOR.md), the scene format
    (SKILL.md), a finished example and the 3D steps (GUIDE-3D.md) — good videos from the
    first message. Free (a strong model): the format reference alone, without the recipes
    or the example, so it designs its own way."""
    folder = rms.SCHEMA_PATH.parent
    text = (folder / "SKILL.md").read_text(encoding="utf-8")
    if text.startswith("---"):
        text = text.split("---", 2)[2]
    if not guided:
        reference = text.split("## 8. Recipes", 1)[0].strip()
        return "مرجع صيغة المشهد (مهارة motion — الحقول والأدوات، مش أسلوب):\n" + reference
    director = (folder / "DIRECTOR.md").read_text(encoding="utf-8")
    example = (folder / "examples" / "pro-reel.json").read_text(encoding="utf-8")
    three_d = (folder / "GUIDE-3D.md").read_text(encoding="utf-8")
    return (
        "دليل إخراج الموشن:\n" + director.strip()
        + "\n\nمرجع صيغة المشهد (مهارة motion):\n" + text.strip()
        + "\n\nمثال لفيديو احترافي منتهي (examples/pro-reel.json) — تعلّم منه الأحجام والتوزيع والتتابع "
        "والانتقالات، وما تنسخ محتواه ولا ألوانه:\n" + example.strip()
        + "\n\n" + three_d.strip()
    )


def kit_summary(kit: dict[str, Any]) -> str:
    c = kit["colors"]
    t = kit["type"]
    return (
        "الـ brand kit الافتراضي (نقطة بداية بس — اختار ألوان وخطوط الفيديو بنفسك بـ scene.palette و scene.fonts):\n"
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
