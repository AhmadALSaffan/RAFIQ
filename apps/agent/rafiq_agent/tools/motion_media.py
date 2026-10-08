"""Media tools for a motion project: voice-over, captions from speech, stock photos, a
generated image, and the project's own asset list. The ones that reach an outside service
are category "write" under the "media" permission, so the user approves each call."""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select

from rafiq_agent.core import motion as service
from rafiq_agent.core.agent_runtime import load_settings
from rafiq_agent.motion import media
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import MotionAsset, MotionProject
from rafiq_agent.tools.base import Tool, ToolResult


class _MediaTool(Tool):
    def __init__(self, project_id: str, on_change: Any = None) -> None:
        self.project_id = project_id
        self.on_change = on_change


def _asset_key(scene: dict[str, Any], base: str) -> str:
    assets = scene.get("assets") or {}
    key = "".join(c for c in base if c.isalnum() or c in "_-")[:30] or "asset"
    if not key[0].isalpha():
        key = "a" + key
    n, out = 1, key
    while out in assets:
        n += 1
        out = f"{key}{n}"
    return out


async def _attach(session: Any, project: MotionProject, asset: MotionAsset, key_hint: str, extra: list[dict[str, Any]] | None = None, summary: str = "") -> tuple[str, int]:
    """Adds the asset to the scene's assets (and anything in `extra`) as one version."""
    key = _asset_key(project.scene, key_hint)
    entry: dict[str, Any] = {"type": asset.kind, "src": f"asset://{asset.id}", "name": asset.name}
    if asset.credit:
        entry["credit"] = asset.credit
    if asset.license:
        entry["license"] = asset.license
    if asset.width:
        entry["width"] = asset.width
    if asset.height:
        entry["height"] = asset.height
    patch: list[dict[str, Any]] = []
    if "assets" not in project.scene:
        patch.append({"op": "add", "path": "/assets", "value": {}})
    patch.append({"op": "add", "path": f"/assets/{key}", "value": entry})
    for op in extra or []:
        patch.append(json.loads(json.dumps(op).replace("__KEY__", key)))
    _, version = await service.change(session, project, patch, "model", summary or f"add asset {key}")
    return key, version.number


class MotionTtsTool(_MediaTool):
    name = "motion_tts"
    category = "write"
    description = (
        "حوّل نص لتعليق صوتي بمزوّد الصوت اللي اختاره المستخدم، وضيفه للمشهد كأصل + مسار صوت يبلّش بـ at. "
        "duck_music: اسم مسار الموسيقى اللي لازم تنخفض تحته. إذا ما في مزوّد، رح ترجع خطأ — استعمل كابشن بدلها."
    )
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "voice": {"type": "string", "description": "اسم الصوت عند المزوّد (اختياري)"},
            "at": {"type": "number", "description": "متى يبلّش (ثواني)"},
            "duck_music": {"type": "string"},
        },
        "required": ["text"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        settings = await load_settings()
        async with SessionLocal() as session:
            project = await session.get(MotionProject, self.project_id)
            if not project:
                return ToolResult(ok=False, output="project not found")
            try:
                data, mime = await media.speak(session, str(args.get("text") or ""), settings.tts_provider, args.get("voice") or settings.tts_voice)
            except media.MediaError as exc:
                return ToolResult(ok=False, output=str(exc))
            asset = await media.store_voiceover(session, project, data, mime, str(args.get("text") or ""))
            track_id = _asset_key({"assets": {t["id"]: 1 for t in project.scene.get("audio", [])}}, "vo")
            track: dict[str, Any] = {"id": track_id, "source": "asset", "asset": "__KEY__", "at": float(args.get("at") or 0), "gain": -6}
            if args.get("duck_music"):
                track["duck"] = args["duck_music"]
            ops = []
            if "audio" not in project.scene:
                ops.append({"op": "add", "path": "/audio", "value": []})
            ops.append({"op": "add", "path": "/audio/-", "value": track})
            try:
                key, number = await _attach(session, project, asset, "vo", ops, "voice-over")
            except service.MotionChangeError as exc:
                return ToolResult(ok=False, output=f"voice saved but the scene didn't take it: {exc} {exc.errors}")
            await session.commit()
        if self.on_change:
            await self.on_change(number)
        return ToolResult(ok=True, output=f"v{number}: asset «{key}» and audio track «{track_id}» at {track['at']}s")


class MotionTranscribeTool(_MediaTool):
    name = "motion_transcribe"
    category = "write"
    description = (
        "حوّل كلام فيديو أو صوت من أصول المشهد لنص بتوقيت كلمة كلمة (بيتبعت للمزوّد اللي اختاره المستخدم). "
        "بيرجع الكلمات، وبيحفظها بالأصل فطبقة captions بـ source=<الأصل> بتستعملها مباشرة."
    )
    parameters = {
        "type": "object",
        "properties": {"asset": {"type": "string"}, "language": {"type": "string", "description": "ar, en… (اختياري)"}},
        "required": ["asset"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            project = await session.get(MotionProject, self.project_id)
            if not project:
                return ToolResult(ok=False, output="project not found")
            entry = (project.scene.get("assets") or {}).get(str(args.get("asset")))
            if not entry:
                return ToolResult(ok=False, output="no such asset in the scene")
            asset = await session.get(MotionAsset, entry["src"].replace("asset://", ""))
            if not asset:
                return ToolResult(ok=False, output="the asset file is missing")
            try:
                result = await media.transcribe_words(session, Path(asset.path), args.get("language"))
            except media.MediaError as exc:
                return ToolResult(ok=False, output=str(exc))
            asset.meta = {**(asset.meta or {}), "words": result["words"], "transcript": result["text"]}
            await session.commit()
        words = result["words"]
        preview = " ".join(w["w"] for w in words[:60])
        return ToolResult(ok=True, output=f"{len(words)} words saved on «{args.get('asset')}». Text: {result['text'][:1500]}\nFirst words: {preview}")


class MotionAssetsTool(_MediaTool):
    name = "motion_assets"
    category = "read_only"
    description = (
        "أصول المشروع: action=list لقائمة الملفات المرفوعة وغيرها (مع المقاس والمدة)، "
        "action=icons مع queries (قائمة كلمات بالإنجليزي، كلها بطلب واحد) للبحث بمكتبة الأيقونات "
        "(أكتر من 46 ألف: tabler و ph و lucide و mdi و ri و iconoir و heroicons بلون الطبقة، si للعلامات "
        "التجارية، و fluent-emoji-flat و logos و circle-flags ملوّنة بألوانها — المعلّمة بـ (colour))."
    )
    parameters = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "icons"]},
            "queries": {"type": "array", "items": {"type": "string"}, "description": "كلمات البحث عن أيقونات، وحدة لكل أيقونة"},
            "query": {"type": "string"},
        },
        "required": ["action"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        if args.get("action") == "icons":
            from rafiq_agent.motion.icons import search

            queries = [str(q) for q in (args.get("queries") or []) if str(q).strip()]
            if args.get("query"):
                queries.append(str(args["query"]))
            if len(queries) <= 1:
                from rafiq_agent.motion.icons import is_colour

                names = [f"{n} (colour)" if is_colour(n) else n for n in search(queries[0] if queries else "")]
                return ToolResult(ok=True, output="\n".join(names) or "no icons match")
            from rafiq_agent.motion.icons import is_colour

            lines = []
            for q in queries[:20]:
                found = [f"{n} (colour)" if is_colour(n) else n for n in search(q, limit=10)]
                lines.append(f"{q}: {', '.join(found) if found else 'no icons match'}")
            return ToolResult(ok=True, output="\n".join(lines))
        async with SessionLocal() as session:
            rows = (await session.execute(select(MotionAsset).where(MotionAsset.project_id == self.project_id))).scalars().all()
            project = await session.get(MotionProject, self.project_id)
        used = {v["src"].replace("asset://", ""): k for k, v in ((project.scene.get("assets") or {}) if project else {}).items()}
        lines = [
            f"- {a.id} {a.kind} «{a.name}» {a.width or ''}×{a.height or ''} {f'{a.duration:.1f}s' if a.duration else ''}"
            f" {'(in scene as ' + used[a.id] + ')' if a.id in used else ''} {a.credit or ''}"
            for a in rows
        ]
        return ToolResult(ok=True, output="\n".join(lines) or "no assets yet — the user can upload, or use motion_stock / motion_image")


class MotionStockTool(_MediaTool):
    name = "motion_stock"
    category = "write"
    description = (
        "دوّر على صور مجانية (Unsplash أو Pexels بمفتاح المستخدم) وضيف وحدة للمشهد مع اعتمادها. "
        "بدون pick: بيرجع النتائج. مع pick (رقم من النتائج): بينزّلها ويضيفها كأصل."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "provider": {"type": "string", "enum": ["unsplash", "pexels"]},
            "orientation": {"type": "string", "enum": ["landscape", "portrait", "squarish"]},
            "pick": {"type": "integer", "description": "رقم النتيجة (من 1)"},
        },
        "required": ["query"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        provider = args.get("provider") or ("unsplash" if media.secret("unsplash") else "pexels")
        try:
            results = await media.stock_search(provider, str(args.get("query")), args.get("orientation"))
        except media.MediaError as exc:
            return ToolResult(ok=False, output=str(exc))
        pick = args.get("pick")
        if not pick:
            return ToolResult(ok=True, output="\n".join(f"{i + 1}. {r['alt'][:80]} — {r['width']}×{r['height']} — {r['credit']}" for i, r in enumerate(results)) or "nothing found")
        if not 1 <= int(pick) <= len(results):
            return ToolResult(ok=False, output="pick is out of range")
        item = results[int(pick) - 1]
        try:
            data = await media.stock_download(item)
        except media.MediaError as exc:
            return ToolResult(ok=False, output=str(exc))
        async with SessionLocal() as session:
            project = await session.get(MotionProject, self.project_id)
            if not project:
                return ToolResult(ok=False, output="project not found")
            asset = await media.store(
                session, project, data, f"{provider}-{item['id']}.jpg", "image/jpeg", "image", "stock",
                credit=f"{item['credit']} ({item['author_url']})", license=item["license"], width=item["width"], height=item["height"],
            )
            key, number = await _attach(session, project, asset, "photo", summary=f"stock photo: {item['credit']}")
            await session.commit()
        if self.on_change:
            await self.on_change(number)
        return ToolResult(ok=True, output=f"v{number}: asset «{key}» — {item['credit']} ({item['license']}). Use it in an image layer.")


class MotionImageTool(_MediaTool):
    name = "motion_image"
    category = "write"
    description = "ولّد صورة بموديل صور (مفتاح OpenAI تبع المستخدم) وضيفها للمشهد كأصل."
    parameters = {
        "type": "object",
        "properties": {"prompt": {"type": "string"}, "size": {"type": "string", "enum": ["1024x1024", "1024x1536", "1536x1024"]}},
        "required": ["prompt"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        async with SessionLocal() as session:
            project = await session.get(MotionProject, self.project_id)
            if not project:
                return ToolResult(ok=False, output="project not found")
            try:
                data = await media.generate_image(session, str(args.get("prompt")), str(args.get("size") or "1024x1024"))
            except media.MediaError as exc:
                return ToolResult(ok=False, output=str(exc))
            w, h = (int(x) for x in str(args.get("size") or "1024x1024").split("x"))
            asset = await media.store(session, project, data, "generated.png", "image/png", "image", "generated", meta={"prompt": args.get("prompt")}, width=w, height=h)
            key, number = await _attach(session, project, asset, "image", summary="generated image")
            await session.commit()
        if self.on_change:
            await self.on_change(number)
        return ToolResult(ok=True, output=f"v{number}: asset «{key}» ({w}×{h}). Use it in an image layer.")


def media_tools(project_id: str, on_change: Any = None) -> list[Tool]:
    return [
        MotionTtsTool(project_id, on_change),
        MotionTranscribeTool(project_id, on_change),
        MotionAssetsTool(project_id, on_change),
        MotionStockTool(project_id, on_change),
        MotionImageTool(project_id, on_change),
    ]
