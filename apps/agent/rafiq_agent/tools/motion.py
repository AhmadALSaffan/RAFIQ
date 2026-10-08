"""The tools a model works a motion project with. Bound to one project; given only in that
project's chat. Reading is free; changing the scene goes through the "motion" permission
(every change is a version anyway); outside services go through "media"."""

import json
from typing import Any

from rafiq_agent.core import motion as service
from rafiq_agent.motion import bridge
from rafiq_agent.motion.patch import PatchError, get
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import MotionProject
from rafiq_agent.tools.base import Tool, ToolResult

MAX_OUTPUT = 24_000


def _clip(text: str) -> str:
    return text if len(text) <= MAX_OUTPUT else text[:MAX_OUTPUT] + "\n… (cut — ask for a smaller path)"


class _ProjectTool(Tool):
    def __init__(self, project_id: str, on_change: Any = None) -> None:
        self.project_id = project_id
        self.on_change = on_change

    async def _project(self, session: Any) -> MotionProject | None:
        return await session.get(MotionProject, self.project_id)


class MotionGetSceneTool(_ProjectTool):
    name = "motion_get_scene"
    category = "read_only"
    description = (
        "اقرأ مشهد الموشن الحالي (JSON بصيغة RMS v1). مرّر path (JSON Pointer مثل /layers/0 أو /composition) "
        "لتقرأ جزء بس — أوفر بالتوكنز."
    )
    parameters = {
        "type": "object",
        "properties": {"path": {"type": "string", "description": "JSON Pointer، فاضي = المشهد كله"}},
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            project = await self._project(session)
            if not project:
                return ToolResult(ok=False, output="project not found")
            try:
                value = get(project.scene, str(args.get("path") or ""))
            except PatchError as exc:
                return ToolResult(ok=False, output=str(exc))
            return ToolResult(ok=True, output=_clip(f"v{project.version}\n" + json.dumps(value, ensure_ascii=False, indent=1)))


class MotionPatchSceneTool(_ProjectTool):
    name = "motion_patch_scene"
    category = "write"
    description = (
        "عدّل المشهد بـ JSON Patch (RFC 6902): قائمة عمليات add/remove/replace/move/copy/test. "
        "كل patch بيصير نسخة جديدة، والنتيجة بترجع مع فحص المشهد (أكواد M001…). صلّح الأخطاء قبل ما تكمّل. "
        "مثال: [{\"op\":\"add\",\"path\":\"/layers/-\",\"value\":{…طبقة…}}]"
    )
    parameters = {
        "type": "object",
        "properties": {
            "patch": {"type": "array", "items": {"type": "object"}, "description": "عمليات JSON Patch"},
            "summary": {"type": "string", "description": "شو غيّرت، بجملة قصيرة (بتطلع بسجل النسخ)"},
        },
        "required": ["patch", "summary"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        patch = args.get("patch")
        if isinstance(patch, str):
            try:
                patch = json.loads(patch)
            except json.JSONDecodeError:
                return ToolResult(ok=False, output="patch must be a JSON array of operations")
        async with SessionLocal() as session:
            project = await self._project(session)
            if not project:
                return ToolResult(ok=False, output="project not found")
            try:
                scene, version = await service.change(session, project, patch or [], "model", str(args.get("summary") or ""))
            except service.MotionChangeError as exc:
                detail = "\n".join(f"{e['path']}: {e['message']}" for e in exc.errors)
                return ToolResult(ok=False, output=f"nothing changed — {exc}\n{detail}".strip())
            kit = await service.kit_for(session, project, scene)
            await session.commit()
        result = await service.check(scene, kit)
        if self.on_change:
            await self.on_change(version.number)
        engine = "" if result["engine"] else " (structural checks only — the app window isn't open)"
        return ToolResult(ok=True, output=f"v{version.number} saved.\ncheck{engine}:\n{service.format_issues(result['issues'])}")


class MotionLintTool(_ProjectTool):
    name = "motion_lint"
    category = "read_only"
    description = "افحص المشهد كله وارجع الأخطاء بأكوادها وتصليح مقترح لكل واحد. target=lottie لفحص التوافق مع Lottie."
    parameters = {"type": "object", "properties": {"target": {"type": "string", "enum": ["mp4", "lottie"]}}}

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            project = await self._project(session)
            if not project:
                return ToolResult(ok=False, output="project not found")
            kit = await service.kit_for(session, project)
            scene = project.scene
        result = await service.check(scene, kit, str(args.get("target") or "mp4"))
        return ToolResult(ok=True, output=json.dumps(result, ensure_ascii=False, indent=1)[:MAX_OUTPUT])


class MotionInspectTool(_ProjectTool):
    name = "motion_inspect"
    category = "read_only"
    description = (
        "تقرير نصي لفريمات معيّنة: كل عنصر ظاهر، صندوقه بالبكسل، الستايل، التباين، والمسافات، والأخطاء. "
        "للموديل اللي ما بيشوف صور، أو لتتأكد من الأرقام."
    )
    parameters = {
        "type": "object",
        "properties": {"times": {"type": "array", "items": {"type": "number"}, "description": "أوقات بالثواني (حتى 8)"}},
        "required": ["times"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        times = [float(t) for t in (args.get("times") or [])][:8] or [0.0]
        async with SessionLocal() as session:
            project = await self._project(session)
            if not project:
                return ToolResult(ok=False, output="project not found")
            kit = await service.kit_for(session, project)
            scene = project.scene
        return ToolResult(ok=True, output=_clip(await service.inspect(scene, kit, times)))


class MotionRenderFramesTool(_ProjectTool):
    name = "motion_render_frames"
    category = "read_only"
    description = (
        "صور PNG لأوقات معيّنة من المشهد (حتى 6) — لتشوف النتيجة بعينك. إذا موديلك ما بيشوف صور، "
        "بترجعلك وصف مكتوب من موديل رؤية (إذا المستخدم حدد واحد) أو التقرير النصي."
    )
    parameters = {
        "type": "object",
        "properties": {"times": {"type": "array", "items": {"type": "number"}}},
        "required": ["times"],
    }

    def __init__(self, project_id: str, chat_model: str | None = None) -> None:
        super().__init__(project_id)
        self.chat_model = chat_model

    def _sees(self) -> bool:
        from rafiq_agent.llm.discovery import supports_vision

        # unknown counts as able, the same as for attachments
        return supports_vision(self.chat_model or "") is not False

    async def run(self, args: dict[str, Any]) -> ToolResult:
        times = [float(t) for t in (args.get("times") or [])][:6] or [0.0]
        async with SessionLocal() as session:
            project = await self._project(session)
            if not project:
                return ToolResult(ok=False, output="project not found")
            kit = await service.kit_for(session, project)
            scene = project.scene
        try:
            images = await service.frames(scene, kit, times)
        except (bridge.EngineUnavailable, bridge.EngineError) as exc:
            return ToolResult(ok=False, output=f"can't draw frames now ({exc}) — use motion_inspect")
        labels = ", ".join(f"{t:.2f}s" for t in times)
        if self._sees():
            return ToolResult(ok=True, output=f"{len(images)} frames: {labels}", images=images)
        # A model that can't see gets the frames in words: from the vision helper when the user
        # picked one, and the measured report either way.
        report = await service.inspect(scene, kit, times)
        try:
            described = await service.describe_frames(images, times)
        except LookupError:
            return ToolResult(ok=True, output=f"(your model can't see images, and no vision model is set in Settings → Video — here is the measured report instead)\n{_clip(report)}")
        except Exception as exc:  # noqa: BLE001 - the helper failing mustn't lose the report
            return ToolResult(ok=True, output=f"(the vision model failed: {exc})\n{_clip(report)}")
        return ToolResult(ok=True, output=_clip(f"what the vision model sees at {labels}:\n{described}\n\nmeasured report:\n{report}"))


class MotionRenderTool(_ProjectTool):
    name = "motion_render"
    category = "write"
    description = (
        "صدّر الفيديو MP4 (بس إذا المستخدم طلب صراحة). الإعدادات: size (720p|1080p|1440p|2160p)، "
        "fps (24|25|30|50|60|120)، codec (h264|h265). بيرجع مسار الملف وفحصه."
    )
    parameters = {
        "type": "object",
        "properties": {
            "size": {"type": "string", "enum": ["720p", "1080p", "1440p", "2160p"]},
            "fps": {"type": "integer", "enum": [24, 25, 30, 50, 60, 120]},
            "codec": {"type": "string", "enum": ["h264", "h265"]},
        },
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        settings = {"format": "mp4", "size": args.get("size") or "1080p", "fps": args.get("fps"), "codec": args.get("codec") or "h264"}
        try:
            result = await bridge.call("export", {"projectId": self.project_id, "settings": settings}, timeout=3600)
        except (bridge.EngineUnavailable, bridge.EngineError) as exc:
            return ToolResult(ok=False, output=f"export failed: {exc}")
        return ToolResult(ok=bool(result.get("ok")), output=json.dumps(result, ensure_ascii=False, indent=1))


class MotionAnalyzeVideoTool(_ProjectTool):
    name = "motion_analyze_video"
    category = "read_only"
    description = (
        "حلّل فيديو من أصول المشروع: مدته، اللقطات (وين بيتغيّر المشهد)، فريم عيّنة لكل لقطة، ومستوى الصوت. "
        "للكلام بتوقيته استعمل motion_transcribe."
    )
    parameters = {
        "type": "object",
        "properties": {"asset": {"type": "string", "description": "اسم الأصل بالمشهد (assets)"}},
        "required": ["asset"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            project = await self._project(session)
            if not project:
                return ToolResult(ok=False, output="project not found")
            asset = (project.scene.get("assets") or {}).get(str(args.get("asset")))
        if not asset:
            return ToolResult(ok=False, output="no such asset in the scene")
        try:
            result = await bridge.call("analyze", {"projectId": self.project_id, "asset": asset}, timeout=600)
        except (bridge.EngineUnavailable, bridge.EngineError) as exc:
            return ToolResult(ok=False, output=f"can't analyze now: {exc}")
        images = result.pop("images", None)
        return ToolResult(ok=True, output=json.dumps(result, ensure_ascii=False, indent=1)[:MAX_OUTPUT], images=images)


def motion_tools(project_id: str, on_change: Any = None, chat_model: str | None = None) -> list[Tool]:
    from rafiq_agent.tools.motion_media import media_tools

    return [
        MotionGetSceneTool(project_id),
        MotionPatchSceneTool(project_id, on_change),
        MotionLintTool(project_id),
        MotionInspectTool(project_id),
        MotionRenderFramesTool(project_id, chat_model),
        MotionRenderTool(project_id),
        MotionAnalyzeVideoTool(project_id),
        *media_tools(project_id, on_change),
    ]
