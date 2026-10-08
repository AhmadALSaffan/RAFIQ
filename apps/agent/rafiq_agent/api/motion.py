"""The motion page's backend: projects and their chats, the scene and its versions, assets,
exports (written to disk in chunks and checked when done), brand kits, media keys, and the
channel the engine in the app answers the agent on."""

import asyncio
import json
import mimetypes
import re
import struct
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import motion as service
from rafiq_agent.core.agent_runtime import SETTINGS_KEY, load_settings
from rafiq_agent.core.workspace import session_dir
from rafiq_agent.i18n import tr
from rafiq_agent.motion import brand, bridge, media, mp4
from rafiq_agent.motion import lint as structural_lint
from rafiq_agent.motion import scene as rms
from rafiq_agent.schemas.chats import ReplySettings
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import (
    Chat,
    ChatMessage,
    LlmModel,
    MotionAsset,
    MotionProject,
    MotionRender,
    MotionVersion,
    SettingsRow,
    Workspace,
)
from rafiq_agent.storage.secrets import delete_named_secret, set_named_secret

router = APIRouter(prefix="/motion", tags=["motion"], dependencies=[Depends(require_token)])
# Files for <video>/<img> tags, which can't send a header: the token comes as ?token=.
files_router = APIRouter(prefix="/motion", tags=["motion"])

MAX_UPLOAD = 4 * 1024 * 1024 * 1024  # 4 GB
KINDS = {"image": "image", "video": "video", "audio": "audio"}


def _now() -> datetime:
    return datetime.now(UTC)


# ── Schemas ─────────────────────────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    model_id: str
    title: str | None = None
    aspect: str = "9:16"
    fps: int = 30
    duration: float = 10.0
    brand: str | None = None  # a template name, or None = the workspace's kit
    workspace_id: str | None = None
    working_dir: str | None = None


class ProjectSummary(BaseModel):
    id: str
    title: str
    chat_id: str
    model_id: str | None
    workspace_id: str | None
    version: int
    width: int
    height: int
    fps: int
    duration: float
    layers: int
    last_render: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ProjectOut(BaseModel):
    id: str
    title: str
    chat_id: str
    model_id: str | None
    workspace_id: str | None
    folder: str
    version: int
    scene: dict[str, Any]
    kit: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ProjectUpdate(BaseModel):
    title: str | None = None


class PatchIn(BaseModel):
    patch: list[dict[str, Any]]
    summary: str = ""
    # Say it in the chat too, so the model knows what the user changed by hand.
    note: bool = True


class SceneIn(BaseModel):
    scene: dict[str, Any]
    summary: str = ""


class VersionOut(BaseModel):
    number: int
    author: str
    summary: str
    created_at: datetime


class AssetOut(BaseModel):
    id: str
    kind: str
    name: str
    mime: str
    size: int
    source: str
    credit: str | None = None
    license: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    meta: dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RenderIn(BaseModel):
    settings: dict[str, Any]
    name: str | None = None


class RenderOut(BaseModel):
    id: str
    project_id: str
    settings: dict[str, Any]
    path: str
    encoder: str | None = None
    status: str
    size: int
    report: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None

    model_config = {"from_attributes": True}


class FinishIn(BaseModel):
    expect: dict[str, Any] = {}
    encoder: str | None = None
    # What the engine checked itself (Lottie: how closely each frame matches).
    extra: dict[str, Any] = {}


class FailIn(BaseModel):
    error: str
    canceled: bool = False


class KitIn(BaseModel):
    kit: dict[str, Any] | None  # None resets to the default
    workspace_id: str | None = None


class MediaKeyIn(BaseModel):
    name: str  # elevenlabs | azure_speech | azure_speech_region | unsplash | pexels
    value: str | None = None


class EngineReply(BaseModel):
    ok: bool
    result: Any = None
    error: str | None = None


# ── Helpers ─────────────────────────────────────────────────────────────────────────────


async def _project(session: AsyncSession, project_id: str) -> MotionProject:
    project = await session.get(MotionProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=tr("ما لقيت مشروع الموشن."))
    return project


async def _out(session: AsyncSession, project: MotionProject) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        title=project.title,
        chat_id=project.chat_id,
        model_id=project.model_id,
        workspace_id=project.workspace_id,
        folder=project.folder,
        version=project.version,
        scene=project.scene,
        kit=await service.kit_for(session, project),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _summary(project: MotionProject, render: MotionRender | None) -> ProjectSummary:
    comp = project.scene.get("composition", {})
    return ProjectSummary(
        id=project.id,
        title=project.title,
        chat_id=project.chat_id,
        model_id=project.model_id,
        workspace_id=project.workspace_id,
        version=project.version,
        width=comp.get("width", 0),
        height=comp.get("height", 0),
        fps=comp.get("fps", 30),
        duration=comp.get("duration", 0),
        layers=len(rms.layer_ids(project.scene)),
        last_render={"id": render.id, "status": render.status, "path": render.path, "settings": render.settings, "finished_at": render.finished_at}
        if render
        else None,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


# ── Format, kits, keys ──────────────────────────────────────────────────────────────────


@router.get("/schema")
async def get_schema() -> dict[str, Any]:
    """RMS v1, the format the engine draws (also in the motion skill as schema.json)."""
    return rms.schema()


@router.get("/kits")
async def kit_templates() -> dict[str, Any]:
    return {"templates": brand.TEMPLATES, "fonts": brand.FONTS, "default": brand.DEFAULT_KIT}


@router.get("/kit")
async def get_kit(workspace_id: str | None = None, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """The kit a workspace (or, without one, the app) uses, and whether it's its own."""
    if workspace_id:
        ws = await session.get(Workspace, workspace_id)
        if ws and ws.brand_kit:
            return {"kit": brand.normalize(ws.brand_kit), "own": True}
    settings = await load_settings()
    if settings.brand_kit:
        return {"kit": brand.normalize(settings.brand_kit), "own": not workspace_id}
    return {"kit": brand.template(None), "own": False}


@router.put("/kit")
async def save_kit(body: KitIn, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    if body.kit is not None:
        kit = brand.normalize(body.kit)
        problems = brand.check_kit(kit)
        if problems:
            raise HTTPException(status_code=400, detail="; ".join(problems))
    else:
        kit = None
    if body.workspace_id:
        ws = await session.get(Workspace, body.workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="workspace not found")
        ws.brand_kit = kit
    else:
        row = await session.get(SettingsRow, SETTINGS_KEY)
        value = dict(row.value) if row else {}
        value["brand_kit"] = kit
        if row:
            row.value = value
        else:
            session.add(SettingsRow(key=SETTINGS_KEY, value=value))
    await session.commit()
    return await get_kit(body.workspace_id, session)


@router.get("/keys")
async def media_keys() -> dict[str, bool]:
    """Which media keys are set — never their values."""
    return {name: bool(media.secret(name)) for name in media.SECRET_NAMES}


@router.put("/keys")
async def save_media_key(body: MediaKeyIn) -> dict[str, bool]:
    if body.name not in media.SECRET_NAMES:
        raise HTTPException(status_code=400, detail="unknown key")
    if body.value and body.value.strip():
        set_named_secret(media.SECRET_NAMES[body.name], body.value.strip())
    else:
        delete_named_secret(media.SECRET_NAMES[body.name])
    return await media_keys()


# ── Projects ────────────────────────────────────────────────────────────────────────────


@router.get("/projects", response_model=list[ProjectSummary])
async def list_projects(workspace_id: str | None = None, session: AsyncSession = Depends(get_session)) -> list[ProjectSummary]:
    query = select(MotionProject).order_by(MotionProject.updated_at.desc())
    if workspace_id:
        query = query.where(MotionProject.workspace_id == workspace_id)
    projects = (await session.execute(query)).scalars().all()
    ids = [p.last_render_id for p in projects if p.last_render_id]
    renders = {r.id: r for r in (await session.execute(select(MotionRender).where(MotionRender.id.in_(ids)))).scalars().all()} if ids else {}
    return [_summary(p, renders.get(p.last_render_id or "")) for p in projects]


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectCreate, session: AsyncSession = Depends(get_session)) -> ProjectOut:
    model = await session.get(LlmModel, body.model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    if body.aspect not in rms.ASPECTS and body.aspect != "custom":
        raise HTTPException(status_code=400, detail="aspect must be 9:16, 1:1, 16:9, 4:5 or custom")
    if body.fps not in (24, 25, 30, 50, 60, 120):
        raise HTTPException(status_code=400, detail="fps must be 24, 25, 30, 50, 60 or 120")
    title = (body.title or tr("مشروع موشن")).strip()[:80]
    scene = rms.new_scene(body.aspect, body.fps, max(0.5, min(body.duration, 7200)), title)
    if body.brand and body.brand in brand.TEMPLATES:
        scene["brand"] = body.brand
    chat = Chat(
        title=tr("موشن: {0}", title),
        model_id=model.id,
        mode="motion",
        settings=ReplySettings().model_dump(),
        workspace_id=body.workspace_id or None,
    )
    session.add(chat)
    await session.flush()
    project = MotionProject(title=title, workspace_id=body.workspace_id or None, chat_id=chat.id, model_id=model.id, folder="", scene=scene, version=1)
    session.add(project)
    await session.flush()
    folder = Path(body.working_dir) if body.working_dir and Path(body.working_dir).is_dir() else session_dir("motion", project.id, title)
    project.folder = str(folder)
    chat.working_dir = str(folder)
    session.add(MotionVersion(project_id=project.id, number=1, scene=scene, author="user", summary=tr("مشهد فاضي")))
    await session.commit()
    await session.refresh(project)
    service.write_scene_file(project)
    return await _out(session, project)


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, session: AsyncSession = Depends(get_session)) -> ProjectOut:
    return await _out(session, await _project(session, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, body: ProjectUpdate, session: AsyncSession = Depends(get_session)) -> ProjectOut:
    project = await _project(session, project_id)
    if body.title and body.title.strip():
        project.title = body.title.strip()[:80]
        chat = await session.get(Chat, project.chat_id)
        if chat:
            chat.title = tr("موشن: {0}", project.title)
    project.updated_at = _now()
    await session.commit()
    return await _out(session, project)


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str, session: AsyncSession = Depends(get_session)) -> None:
    """Removes the project from Rafiq. Its folder (and the videos in it) stay on disk."""
    project = await _project(session, project_id)
    chat = await session.get(Chat, project.chat_id)
    if chat:
        await session.delete(chat)
    for model in (MotionVersion, MotionAsset, MotionRender):
        await session.execute(delete(model).where(model.project_id == project.id))
    await session.delete(project)
    await session.commit()


@router.post("/projects/{project_id}/patch")
async def patch_scene(project_id: str, body: PatchIn, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """A change from the timeline or the inspector: a new version, a line in the chat, and
    the structural check (the page runs the engine's own checks itself)."""
    project = await _project(session, project_id)
    try:
        scene, version = await service.change(session, project, body.patch, "user", body.summary or tr("تعديل يدوي"))
    except service.MotionChangeError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc), "errors": exc.errors}) from exc
    if body.note and body.summary:
        session.add(
            ChatMessage(
                chat_id=project.chat_id,
                role="user",
                content=tr("✎ عدّلت بإيدي (v{0}): {1}", version.number, body.summary),
                parts=[{"kind": "motion_note", "version": version.number}],
            )
        )
    kit = await service.kit_for(session, project, scene)
    await session.commit()
    return {"version": version.number, "scene": scene, "issues": structural_lint.structural(scene, kit)}


@router.put("/projects/{project_id}/scene")
async def replace_scene(project_id: str, body: SceneIn, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Replaces the whole scene (an import, or a template). Still a version."""
    project = await _project(session, project_id)
    errors = rms.validate(body.scene)
    if errors:
        raise HTTPException(status_code=400, detail={"message": "invalid scene", "errors": errors})
    version = await service.save_version(session, project, body.scene, None, "user", body.summary or tr("مشهد جديد"))
    await session.commit()
    return {"version": version.number, "scene": body.scene}


@router.post("/projects/{project_id}/check")
async def check_scene(project_id: str, target: str = "mp4", session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    project = await _project(session, project_id)
    kit = await service.kit_for(session, project)
    return await service.check(project.scene, kit, target, full=False)


# ── Versions ────────────────────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/versions", response_model=list[VersionOut])
async def versions(project_id: str, session: AsyncSession = Depends(get_session)) -> list[VersionOut]:
    rows = await session.execute(
        select(MotionVersion).where(MotionVersion.project_id == project_id).order_by(MotionVersion.number.desc())
    )
    return [VersionOut(number=v.number, author=v.author, summary=v.summary, created_at=v.created_at) for v in rows.scalars().all()]


@router.get("/projects/{project_id}/versions/{number}")
async def version_scene(project_id: str, number: int, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    row = await session.execute(
        select(MotionVersion).where(MotionVersion.project_id == project_id, MotionVersion.number == number)
    )
    version = row.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail=tr("ما لقيت هالنسخة."))
    return {"number": version.number, "scene": version.scene, "author": version.author, "summary": version.summary}


@router.post("/projects/{project_id}/versions/{number}/restore", response_model=ProjectOut)
async def restore_version(project_id: str, number: int, session: AsyncSession = Depends(get_session)) -> ProjectOut:
    project = await _project(session, project_id)
    try:
        await service.restore(session, project, number)
    except service.MotionChangeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    session.add(ChatMessage(chat_id=project.chat_id, role="user", content=tr("↺ رجّعت النسخة v{0}.", number), parts=[{"kind": "motion_note"}]))
    await session.commit()
    return await _out(session, project)


# ── Assets ──────────────────────────────────────────────────────────────────────────────


def _kind_of(mime: str, name: str) -> str:
    if name.lower().endswith(".json") or name.lower().endswith(".lottie"):
        return "lottie"
    if mime == "image/svg+xml":
        return "svg"
    return KINDS.get(mime.split("/")[0], "image")


@router.get("/projects/{project_id}/assets", response_model=list[AssetOut])
async def list_assets(project_id: str, session: AsyncSession = Depends(get_session)) -> list[AssetOut]:
    rows = await session.execute(select(MotionAsset).where(MotionAsset.project_id == project_id).order_by(MotionAsset.created_at))
    return [AssetOut.model_validate(a) for a in rows.scalars().all()]


@router.post("/projects/{project_id}/assets", response_model=AssetOut, status_code=201)
async def upload_asset(
    project_id: str,
    file: UploadFile = File(...),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    duration: float | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> AssetOut:
    project = await _project(session, project_id)
    name = file.filename or "file"
    mime = file.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
    kind = _kind_of(mime, name)
    folder = Path(project.folder) / "assets"
    folder.mkdir(parents=True, exist_ok=True)
    asset = MotionAsset(project_id=project.id, kind=kind, name=name[:120], mime=mime, path="", source="upload", width=width, height=height, duration=duration)
    session.add(asset)
    await session.flush()
    target = folder / f"{asset.id}{Path(name).suffix.lower() or mimetypes.guess_extension(mime) or ''}"
    size = 0
    with target.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=tr("الملف أكبر من 4 جيجا."))
            out.write(chunk)
    asset.path = str(target)
    asset.size = size
    await session.commit()
    await session.refresh(asset)
    return AssetOut.model_validate(asset)


class AssetMetaIn(BaseModel):
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    meta: dict[str, Any] | None = None


@router.patch("/assets/{asset_id}", response_model=AssetOut)
async def update_asset(asset_id: str, body: AssetMetaIn, session: AsyncSession = Depends(get_session)) -> AssetOut:
    """What the engine learned when it opened the file (size, duration, words…)."""
    asset = await session.get(MotionAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
    for key in ("width", "height", "duration"):
        value = getattr(body, key)
        if value is not None:
            setattr(asset, key, value)
    if body.meta is not None:
        asset.meta = {**(asset.meta or {}), **body.meta}
    await session.commit()
    await session.refresh(asset)
    return AssetOut.model_validate(asset)


@router.get("/assets/{asset_id}", response_model=AssetOut)
async def asset_info(asset_id: str, session: AsyncSession = Depends(get_session)) -> AssetOut:
    asset = await session.get(MotionAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
    return AssetOut.model_validate(asset)


@router.delete("/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, session: AsyncSession = Depends(get_session)) -> None:
    asset = await session.get(MotionAsset, asset_id)
    if not asset:
        return
    Path(asset.path).unlink(missing_ok=True)
    await session.delete(asset)
    await session.commit()


@files_router.get("/assets/{asset_id}/file")
async def asset_file(asset_id: str, token: str = Query(...)) -> FileResponse:
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")
    from rafiq_agent.storage.db import SessionLocal

    async with SessionLocal() as session:
        asset = await session.get(MotionAsset, asset_id)
    if not asset or not Path(asset.path).is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(asset.path, media_type=asset.mime, filename=asset.name)


@router.post("/projects/{project_id}/assets/{asset_id}/transcribe")
async def transcribe_asset(project_id: str, asset_id: str, language: str | None = None, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Words with their times, from the asset's speech — for captions."""
    asset = await session.get(MotionAsset, asset_id)
    if not asset or asset.project_id != project_id:
        raise HTTPException(status_code=404, detail="asset not found")
    try:
        result = await media.transcribe_words(session, Path(asset.path), language)
    except media.MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    asset.meta = {**(asset.meta or {}), "words": result["words"], "transcript": result["text"]}
    await session.commit()
    return result


class TtsIn(BaseModel):
    text: str
    voice: str | None = None


@router.post("/projects/{project_id}/tts", response_model=AssetOut, status_code=201)
async def tts(project_id: str, body: TtsIn, session: AsyncSession = Depends(get_session)) -> AssetOut:
    project = await _project(session, project_id)
    settings = await load_settings()
    try:
        data, mime = await media.speak(session, body.text, settings.tts_provider, body.voice or settings.tts_voice)
    except media.MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    asset = await media.store_voiceover(session, project, data, mime, body.text)
    await session.commit()
    await session.refresh(asset)
    return AssetOut.model_validate(asset)


class StockIn(BaseModel):
    provider: str = "unsplash"
    query: str
    orientation: str | None = None


@router.post("/stock/search")
async def stock_search(body: StockIn) -> list[dict[str, Any]]:
    try:
        return await media.stock_search(body.provider, body.query, body.orientation)
    except media.MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/projects/{project_id}/stock", response_model=AssetOut, status_code=201)
async def stock_add(project_id: str, item: dict[str, Any], session: AsyncSession = Depends(get_session)) -> AssetOut:
    project = await _project(session, project_id)
    try:
        data = await media.stock_download(item)
    except media.MediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    asset = await media.store(
        session, project, data, f"{item.get('provider')}-{item.get('id')}.jpg", "image/jpeg", "image", "stock",
        credit=f"{item.get('credit')} ({item.get('author_url')})", license=item.get("license"), width=item.get("width"), height=item.get("height"),
    )
    await session.commit()
    await session.refresh(asset)
    return AssetOut.model_validate(asset)


# ── Renders ─────────────────────────────────────────────────────────────────────────────

_SAFE = re.compile(r"[^\w؀-ۿ -]+")


@router.post("/projects/{project_id}/renders", response_model=RenderOut, status_code=201)
async def start_render(project_id: str, body: RenderIn, session: AsyncSession = Depends(get_session)) -> RenderOut:
    """Opens a file for an export; the engine then writes it in chunks."""
    project = await _project(session, project_id)
    folder = Path(project.folder) / "renders"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = _now().strftime("%Y%m%d-%H%M%S")
    base = _SAFE.sub("", body.name or project.title).strip() or "motion"
    ext = ".lottie" if body.settings.get("format") == "dotlottie" else ".json" if body.settings.get("format") == "lottie" else ".mp4"
    path = folder / f"{base[:60]}-{stamp}{ext}"
    path.write_bytes(b"")
    render = MotionRender(project_id=project.id, settings=body.settings, path=str(path), status="running")
    session.add(render)
    await session.commit()
    await session.refresh(render)
    return RenderOut.model_validate(render)


@router.put("/renders/{render_id}/chunk")
async def write_chunk(render_id: str, request: Request, position: int = Query(..., ge=0), session: AsyncSession = Depends(get_session)) -> dict[str, int]:
    """Writes bytes at `position` (the muxer may come back to patch a header)."""
    render = await session.get(MotionRender, render_id)
    if not render or render.status != "running":
        raise HTTPException(status_code=409, detail="this export isn't running")
    data = await request.body()
    with open(render.path, "r+b") as out:
        out.seek(position)
        out.write(data)
    return {"written": len(data)}


@router.post("/renders/{render_id}/finish", response_model=RenderOut)
async def finish_render(render_id: str, body: FinishIn, session: AsyncSession = Depends(get_session)) -> RenderOut:
    """Reads the file back and says whether it's what was asked for."""
    render = await session.get(MotionRender, render_id)
    if not render:
        raise HTTPException(status_code=404, detail="render not found")
    render.encoder = body.encoder
    render.size = Path(render.path).stat().st_size if Path(render.path).exists() else 0
    render.finished_at = _now()
    if render.path.endswith(".mp4"):
        try:
            report, problems = await asyncio.to_thread(mp4.verify, render.path, body.expect)
        except (ValueError, OSError, struct.error) as exc:
            report, problems = {}, [f"can't read the file back: {exc}"]
        render.report = {**report, "problems": problems}
        render.status = "done" if not problems else "failed"
        render.error = "; ".join(problems) or None
    else:
        render.report = {"size": render.size, **body.extra}
        problems = list(body.extra.get("problems") or [])
        render.status = "done" if render.size > 0 and not problems else "failed"
        render.error = "; ".join(problems) or None
    project = await session.get(MotionProject, render.project_id)
    if project and render.status == "done":
        project.last_render_id = render.id
    await session.commit()
    await session.refresh(render)
    return RenderOut.model_validate(render)


@router.post("/renders/{render_id}/fail", response_model=RenderOut)
async def fail_render(render_id: str, body: FailIn, session: AsyncSession = Depends(get_session)) -> RenderOut:
    render = await session.get(MotionRender, render_id)
    if not render:
        raise HTTPException(status_code=404, detail="render not found")
    render.status = "canceled" if body.canceled else "failed"
    render.error = body.error[:2000]
    render.finished_at = _now()
    if body.canceled:
        Path(render.path).unlink(missing_ok=True)
    await session.commit()
    await session.refresh(render)
    return RenderOut.model_validate(render)


@router.get("/projects/{project_id}/renders", response_model=list[RenderOut])
async def list_renders(project_id: str, session: AsyncSession = Depends(get_session)) -> list[RenderOut]:
    rows = await session.execute(select(MotionRender).where(MotionRender.project_id == project_id).order_by(MotionRender.created_at.desc()))
    return [RenderOut.model_validate(r) for r in rows.scalars().all()]


@files_router.get("/renders/{render_id}/file")
async def render_file(render_id: str, token: str = Query(...)) -> FileResponse:
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")
    from rafiq_agent.storage.db import SessionLocal

    async with SessionLocal() as session:
        render = await session.get(MotionRender, render_id)
    if not render or not Path(render.path).is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(render.path, media_type=mimetypes.guess_type(render.path)[0] or "video/mp4", filename=Path(render.path).name)


# ── The engine channel ──────────────────────────────────────────────────────────────────


@router.get("/engine/stream")
async def engine_stream() -> StreamingResponse:
    """The app's engine listens here for work the agent needs done in a browser."""
    queue = bridge.connect()

    async def events():
        try:
            yield "data: {\"kind\": \"hello\"}\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=20)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False, default=str)}\n\n"
        finally:
            bridge.disconnect(queue)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/engine/reply/{request_id}")
async def engine_reply(request_id: str, body: EngineReply) -> dict[str, bool]:
    return {"accepted": bridge.resolve(request_id, body.ok, body.result, body.error)}


@router.get("/engine/status")
async def engine_status() -> dict[str, Any]:
    from rafiq_agent.motion import ffmpeg, local_models

    return {"connected": bridge.connected(), "ffmpeg": ffmpeg.status(), "local": local_models.status()}


# ── Local models, on demand ─────────────────────────────────────────────────────────────

_local_tasks: dict[str, asyncio.Task] = {}


@router.get("/local")
async def local_status() -> dict[str, Any]:
    from rafiq_agent.motion import local_models

    return local_models.status()


@router.post("/local/{pack}/install")
async def local_install(pack: str) -> dict[str, Any]:
    """Starts the download of one pack (the user pressed its button, having seen its licences).
    Poll GET /motion/local for progress."""
    from rafiq_agent.motion import local_models

    if pack not in local_models.PACKS:
        raise HTTPException(status_code=404, detail="unknown pack")
    task = _local_tasks.get(pack)
    if task is None or task.done():
        task = asyncio.create_task(local_models.install(pack))
        task.add_done_callback(lambda t: t.exception())  # failures land in status()
        _local_tasks[pack] = task
    return local_models.status()


@router.delete("/local/{pack}", status_code=204)
async def local_remove(pack: str) -> None:
    from rafiq_agent.motion import local_models

    if pack not in local_models.PACKS:
        raise HTTPException(status_code=404, detail="unknown pack")
    local_models.remove(pack)


# ── FFmpeg, on demand ───────────────────────────────────────────────────────────────────

_install_task: asyncio.Task | None = None


@router.get("/ffmpeg")
async def ffmpeg_status() -> dict[str, Any]:
    from rafiq_agent.motion import ffmpeg

    return ffmpeg.status()


@router.post("/ffmpeg/install")
async def ffmpeg_install() -> dict[str, Any]:
    """Starts the download (the user pressed the button). Poll GET /motion/ffmpeg for progress."""
    from rafiq_agent.motion import ffmpeg

    global _install_task
    if _install_task is None or _install_task.done():
        _install_task = asyncio.create_task(ffmpeg.install())
        _install_task.add_done_callback(lambda t: t.exception())  # failures land in status()
    return ffmpeg.status()


@router.delete("/ffmpeg", status_code=204)
async def ffmpeg_remove() -> None:
    from rafiq_agent.motion import ffmpeg

    ffmpeg.remove()


class TranscodeIn(BaseModel):
    settings: dict[str, Any]
    expect: dict[str, Any] = {}


@router.post("/renders/{render_id}/transcode", response_model=RenderOut)
async def transcode_render(render_id: str, body: TranscodeIn, session: AsyncSession = Depends(get_session)) -> RenderOut:
    """The engine wrote a high-rate H.264 intermediate; FFmpeg makes the asked-for codec from
    it (H.265 on NVENC/AMF/Quick Sync), then the result is read back like any export."""
    from rafiq_agent.motion import ffmpeg

    render = await session.get(MotionRender, render_id)
    if not render:
        raise HTTPException(status_code=404, detail="render not found")
    if not ffmpeg.binary():
        render.status = "failed"
        render.error = "needs-ffmpeg"
        await session.commit()
        raise HTTPException(status_code=409, detail=tr("هالتصدير بيلزمه FFmpeg — نزّله من نافذة التصدير."))
    src = Path(render.path)
    intermediate = src.with_suffix(".intermediate.mp4")
    src.replace(intermediate)
    codec = str(body.settings.get("codec") or "h264")
    expect = body.expect
    from rafiq_agent.motion.export_rates import bitrate_for

    bitrate = bitrate_for(int(expect.get("width") or 1920), int(expect.get("height") or 1080), float(expect.get("fps") or 30), codec, str(body.settings.get("quality") or "auto"))
    try:
        encoder = await asyncio.to_thread(ffmpeg.transcode, intermediate, src, codec, bitrate, bool(expect.get("audio")))
    except ffmpeg.FfmpegError as exc:
        intermediate.replace(src)
        render.status = "failed"
        render.error = str(exc)
        render.finished_at = _now()
        await session.commit()
        await session.refresh(render)
        return RenderOut.model_validate(render)
    intermediate.unlink(missing_ok=True)
    return await finish_render(render_id, FinishIn(expect=expect, encoder=f"ffmpeg {encoder} @ {bitrate / 1e6:.1f} Mbps"), session)


@router.post("/assets/{asset_id}/working-copy", response_model=AssetOut)
async def working_copy(asset_id: str, session: AsyncSession = Depends(get_session)) -> AssetOut:
    """For a video the engine can't decode: an H.264 copy, made once, used instead."""
    from rafiq_agent.motion import ffmpeg

    asset = await session.get(MotionAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="asset not found")
    if not ffmpeg.binary():
        raise HTTPException(status_code=409, detail=tr("هالفيديو بيلزمه FFmpeg ليتحوّل — نزّله من الإعدادات."))
    src = Path(asset.path)
    dst = src.with_name(f"{src.stem}.work.mp4")
    try:
        encoder = await asyncio.to_thread(ffmpeg.working_copy, src, dst)
    except ffmpeg.FfmpegError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    asset.meta = {**(asset.meta or {}), "original": str(src), "converted_with": encoder}
    asset.path = str(dst)
    asset.mime = "video/mp4"
    asset.size = dst.stat().st_size
    await session.commit()
    await session.refresh(asset)
    return AssetOut.model_validate(asset)


class OutlineIn(BaseModel):
    lines: list[dict[str, Any]]  # {text, family, weight, px, dir}


@router.post("/outline")
async def outline(body: OutlineIn) -> list[dict[str, Any]]:
    """Text lines as glyph contours, shaped by HarfBuzz with the kit's own fonts (Lottie export)."""
    from rafiq_agent.motion.outline import outline_line

    def run() -> list[dict[str, Any]]:
        return [
            outline_line(str(line.get("text", "")), str(line.get("family", "IBM Plex Sans Arabic")), int(line.get("weight", 500)), float(line.get("px", 32)), str(line.get("dir", "rtl")))
            for line in body.lines[:500]
        ]

    return await asyncio.to_thread(run)
