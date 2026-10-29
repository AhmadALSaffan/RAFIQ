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


MAX_IMAGE = 30 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}


class MotionFetchImageTool(_MediaTool):
    name = "motion_fetch_image"
    category = "write"
    description = (
        "نزّل صورة من رابط (http/https، حتى 30MB) وضيفها للمشهد كأصل — مثلاً خريطة كوكب (equirectangular) "
        "تلفّها على كرة 3D بـ texture، أو صورة لطبقة image. اكتب credit و license إذا الصورة إلها مصدر."
    )
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "رابط الصورة نفسها (jpg, png, webp)"},
            "name": {"type": "string", "description": "اسم قصير للأصل بالإنجليزي (earth, mars, saturn-rings…)"},
            "credit": {"type": "string"},
            "license": {"type": "string"},
        },
        "required": ["url"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        import httpx

        from rafiq_agent.tools.web import _public_only

        url = str(args.get("url") or "").strip()
        if why := await _public_only(url):
            return ToolResult(ok=False, output=why)
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as http, http.stream("GET", url, headers={"User-Agent": "Rafiq"}) as resp:
                if resp.status_code >= 400:
                    return ToolResult(ok=False, output=f"the server answered {resp.status_code}")
                if why := await _public_only(str(resp.url)):
                    return ToolResult(ok=False, output=why)
                mime = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if mime not in IMAGE_TYPES:
                    return ToolResult(ok=False, output=f"not an image ({mime or 'unknown type'}) — give the link to the image file itself")
                chunks: list[bytes] = []
                size = 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_IMAGE:
                        return ToolResult(ok=False, output="the image is bigger than 30MB")
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            return ToolResult(ok=False, output=f"couldn't download it: {exc}")
        data = b"".join(chunks)
        width = height = None
        try:
            import io

            from PIL import Image

            with Image.open(io.BytesIO(data)) as img:
                width, height = img.size
        except Exception:  # noqa: BLE001 - the engine reads the size again when it opens it
            pass
        base = "".join(c for c in str(args.get("name") or "image") if c.isalnum() or c in "-_")[:30] or "image"
        async with SessionLocal() as session:
            project = await session.get(MotionProject, self.project_id)
            if not project:
                return ToolResult(ok=False, output="project not found")
            asset = await media.store(
                session, project, data, f"{base}{IMAGE_TYPES[mime]}", mime, "image", "web",
                credit=(str(args["credit"])[:200] if args.get("credit") else None),
                license=(str(args["license"])[:80] if args.get("license") else None),
                meta={"url": url}, width=width, height=height,
            )
            key, number = await _attach(session, project, asset, base, summary=f"image from {url[:80]}")
            await session.commit()
        if self.on_change:
            await self.on_change(number)
        size_note = f" ({width}×{height})" if width else ""
        return ToolResult(ok=True, output=f"v{number}: asset «{key}»{size_note}. Use it as an image layer, or as a 3D texture: \"texture\": \"{key}\".")


COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia asks every client to say who it is
COMMONS_AGENT = "Rafiq/1.0 (https://github.com/AhmadALSaffan/RAFIQ; motion reference photos)"
REFERENCE_SIDE = 1024
COPY_METHOD = (
    "Copy it as a 3D scene, piece by piece — don't invent a different place:\n"
    "1. Name what you see, left → right and front → back: every tower (its place across the picture "
    "as x from -1 to 1, its height against the tallest, how wide, its form box|slab|round|tapered|"
    "twisted|stepped|triangle|lshape, its top flat|spire|pyramid|dome|crown|helipad|antenna, its façade "
    "grid|bands|fins|curtain|diagrid, its colour or glass tint, a podium), then water, roads, trees, "
    "hills, the sky.\n"
    "2. Build each one as its own `building` (or tree, water, mountain…) with those fields — never a "
    "`city` to copy a real place, and never two towers alike unless they are alike in the picture.\n"
    "3. Match the camera to the photo: its height (street level, a rooftop, the air), its distance and "
    "lens (far skylines: fov 25–35), where the horizon sits; the background gradient and light from its "
    "sky and time of day.\n"
    "4. motion_render_frames, compare with the photo, fix the biggest difference, again."
)


class MotionReferenceTool(Tool):
    """A real photo to copy from, looked at, not added: the model sees it and rebuilds it."""

    name = "motion_reference"
    category = "read"
    description = (
        "Find real photos of a place or a thing (Wikimedia Commons; or the link to an image) and look at "
        "them — to copy a real skyline, a landmark, a street, a building or an object in 3D exactly as "
        "it is. The photos come back to you to see; they aren't added to the video (use "
        "motion_fetch_image for that). Search in English with the place's name: «Dubai Marina skyline», "
        "«Manhattan skyline from Brooklyn», «Riyadh Kingdom Centre»."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "what to find, in English (the place's name + skyline / street / building)"},
            "url": {"type": "string", "description": "or the link to one image to look at"},
            "count": {"type": "integer", "minimum": 1, "maximum": 3, "description": "how many photos to see (default 2)"},
            "skip": {"type": "integer", "minimum": 0, "description": "skip this many results (to see others)"},
        },
    }

    def __init__(self, project_id: str, chat_model: str | None = None) -> None:
        self.project_id = project_id
        self.chat_model = chat_model

    async def _search(self, http: Any, query: str, want: int, skip: int) -> list[dict[str, Any]]:
        resp = await http.get(COMMONS_API, params={
            "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
            "gsrsearch": f"{query} filetype:bitmap", "gsrlimit": str(min(20, want + skip + 6)),
            "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": str(REFERENCE_SIDE),
        })
        resp.raise_for_status()
        pages = sorted((resp.json().get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
        found = []
        for page in pages:
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("mime") not in ("image/jpeg", "image/png", "image/webp") or (info.get("width") or 0) < 800:
                continue
            meta = info.get("extmetadata") or {}
            found.append({
                "title": str(page.get("title", "")).removeprefix("File:"),
                "thumb": info.get("thumburl") or info.get("url"),
                "page": info.get("descriptionurl"),
                "credit": _meta_text(meta, "Artist") or "unknown",
                "license": _meta_text(meta, "LicenseShortName") or "see the page",
            })
        return found[skip: skip + want]

    async def run(self, args: dict[str, Any]) -> ToolResult:
        import base64
        import io

        import httpx
        from PIL import Image

        from rafiq_agent.llm.discovery import supports_vision
        from rafiq_agent.tools.web import _public_only

        query = str(args.get("query") or "").strip()
        url = str(args.get("url") or "").strip()
        if not query and not url:
            return ToolResult(ok=False, output="give a query (the place's name in English) or a url")
        want = max(1, min(3, int(args.get("count") or 2)))
        try:
            async with httpx.AsyncClient(timeout=40, follow_redirects=True, headers={"User-Agent": COMMONS_AGENT}) as http:
                if url:
                    if why := await _public_only(url):
                        return ToolResult(ok=False, output=why)
                    items = [{"title": url.rsplit("/", 1)[-1][:80], "thumb": url, "page": url, "credit": "", "license": ""}]
                else:
                    items = await self._search(http, query, want, max(0, int(args.get("skip") or 0)))
                if not items:
                    return ToolResult(ok=False, output="no photos found — try other words (the place's English name, + skyline, + aerial)")
                images: list[str] = []
                lines: list[str] = []
                for item in items:
                    resp = await http.get(item["thumb"])
                    if resp.status_code >= 400 or len(resp.content) > MAX_IMAGE:
                        continue
                    try:
                        with Image.open(io.BytesIO(resp.content)) as img:
                            img = img.convert("RGB")
                            img.thumbnail((REFERENCE_SIDE, REFERENCE_SIDE))
                            out = io.BytesIO()
                            img.save(out, "JPEG", quality=82)
                            size = img.size
                    except Exception:  # noqa: BLE001 - not a picture after all: skip it
                        continue
                    images.append("data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode())
                    credit = f" — {item['credit']}, {item['license']}" if item["credit"] else ""
                    lines.append(f"{len(images)}. {item['title']} ({size[0]}×{size[1]}){credit} {item['page']}")
        except httpx.HTTPError as exc:
            return ToolResult(ok=False, output=f"couldn't reach the photos: {exc}")
        if not images:
            return ToolResult(ok=False, output="the photos wouldn't open — try another query or skip")
        listing = "\n".join(lines)
        if supports_vision(self.chat_model or "") is False:
            return ToolResult(ok=True, output=f"{listing}\n\n(this model can't see pictures: build from what you know of the place)\n\n{COPY_METHOD}")
        return ToolResult(ok=True, output=f"{listing}\n\n{COPY_METHOD}", images=images)


def _meta_text(meta: dict[str, Any], key: str) -> str:
    """A Commons metadata field (often HTML) as short plain text."""
    import re

    html = str((meta.get(key) or {}).get("value") or "")
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html)).strip()[:80]


def media_tools(project_id: str, on_change: Any = None) -> list[Tool]:
    return [
        MotionTtsTool(project_id, on_change),
        MotionTranscribeTool(project_id, on_change),
        MotionAssetsTool(project_id, on_change),
        MotionStockTool(project_id, on_change),
        MotionImageTool(project_id, on_change),
        MotionFetchImageTool(project_id, on_change),
    ]
