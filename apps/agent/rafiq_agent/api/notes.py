"""The notes page: the user's Markdown notes as files (core/notes.py does the work)."""

import mimetypes
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import notes
from rafiq_agent.core.agent_runtime import SETTINGS_KEY, load_settings
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import LlmModel, SettingsRow

router = APIRouter(prefix="/notes", tags=["notes"], dependencies=[Depends(require_token)])
raw_router = APIRouter(prefix="/notes", tags=["notes"])


async def _root() -> Path:
    return notes.notes_root((await load_settings()).notes_dir)


def _fail(e: Exception) -> HTTPException:
    if isinstance(e, notes.NoteError):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, FileNotFoundError):
        return HTTPException(status_code=404, detail=tr("الملاحظة مش موجودة: {0}", e.filename or ""))
    return HTTPException(status_code=400, detail=tr("ما قدرت أكمل: {0}", e))


@router.get("/tree")
async def get_tree() -> dict[str, object]:
    root = await _root()
    settings = await load_settings()
    return {
        "root": str(root),
        "default_root": str(notes.default_root()),
        "pinned": settings.notes_pinned,
        "items": [e.__dict__ for e in notes.tree(root)],
    }


@router.get("/search")
async def search(q: str = Query(..., max_length=200)) -> list[dict[str, object]]:
    return [h.__dict__ for h in notes.search(await _root(), q)]


@router.get("/file")
async def read_file(path: str = Query(...)) -> dict[str, object]:
    root = await _root()
    try:
        target = notes.resolve(root, path)
        text = notes.read(target)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    return {
        "path": notes.relative(root, target),
        "name": target.name,
        "content": text,
        "mtime": target.stat().st_mtime,
        "external": notes.is_external(notes.relative(root, target)),
    }


class SaveIn(BaseModel):
    path: str
    content: str
    # The modification time the editor loaded; a different one on disk means the file was
    # changed elsewhere since, and the save is refused instead of overwriting that change.
    base_mtime: float | None = None


@router.put("/file")
async def save_file(body: SaveIn) -> dict[str, object]:
    root = await _root()
    try:
        target = notes.resolve(root, body.path)
        if body.base_mtime is not None and target.exists() and abs(target.stat().st_mtime - body.base_mtime) > 0.001:
            raise HTTPException(status_code=409, detail=tr("الملف انعدّل من برا رفيق بعد ما فتحته."))
        mtime = notes.write(target, body.content)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    return {"path": notes.relative(root, target), "mtime": mtime}


class NewIn(BaseModel):
    folder: str = ""
    title: str = Field(default="", max_length=200)
    content: str = ""


@router.post("/new")
async def new_note(body: NewIn) -> dict[str, object]:
    root = await _root()
    try:
        target = notes.create(root, body.folder, body.title or tr("ملاحظة جديدة"), body.content)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    return {"path": notes.relative(root, target), "mtime": target.stat().st_mtime}


class FolderIn(BaseModel):
    path: str


@router.post("/folder")
async def new_folder(body: FolderIn) -> dict[str, str]:
    root = await _root()
    try:
        target = notes.make_folder(root, body.path)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    return {"path": notes.relative(root, target)}


class MoveIn(BaseModel):
    src: str
    dst: str


async def _update_pins(change) -> list[str]:
    async with SessionLocal() as session:
        row = await session.get(SettingsRow, SETTINGS_KEY)
        settings = AppSettings.model_validate(row.value) if row else AppSettings()
        settings.notes_pinned = change(list(settings.notes_pinned))[:200]
        if row:
            row.value = settings.model_dump()
        else:
            session.add(SettingsRow(key=SETTINGS_KEY, value=settings.model_dump()))
        await session.commit()
        return settings.notes_pinned


@router.post("/move")
async def move(body: MoveIn) -> dict[str, str]:
    root = await _root()
    try:
        target = notes.move(root, body.src, body.dst)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    new = notes.relative(root, target)
    src = body.src.rstrip("/")

    def follow(pins: list[str]) -> list[str]:
        return [new + p[len(src):] if p == src or p.startswith(src + "/") else p for p in pins]

    await _update_pins(follow)
    return {"path": new}


@router.post("/trash")
async def trash(body: FolderIn) -> dict[str, str]:
    root = await _root()
    try:
        notes.trash(root, body.path)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    gone = body.path.rstrip("/")
    await _update_pins(lambda pins: [p for p in pins if p != gone and not p.startswith(gone + "/")])
    return {"path": body.path}


class PinIn(BaseModel):
    path: str
    pinned: bool


@router.post("/pin")
async def pin(body: PinIn) -> dict[str, list[str]]:
    def change(pins: list[str]) -> list[str]:
        rest = [p for p in pins if p != body.path]
        return [body.path, *rest] if body.pinned else rest

    return {"pinned": await _update_pins(change)}


class ImageIn(BaseModel):
    note: str
    name: str = "image"
    data_url: str


@router.post("/image")
async def save_image(body: ImageIn) -> dict[str, str]:
    root = await _root()
    try:
        src = notes.save_image(root, body.note, body.name, body.data_url)
    except (notes.NoteError, OSError, ValueError) as e:
        raise _fail(e) from e
    return {"src": src}


@raw_router.get("/image")
async def image(note: str = Query(...), src: str = Query(...), token: str = Query(...)) -> FileResponse:
    """A picture in a note — an <img> can't send the Authorization header, so ?token=."""
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")
    try:
        target = notes.image_file(await _root(), note, src)
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    return FileResponse(target, media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream")


class ExportIn(BaseModel):
    path: str
    dest: str
    format: Literal["docx"] = "docx"


@router.post("/export")
async def export(body: ExportIn) -> dict[str, str]:
    """A note as a Word document, right to left where it's Arabic, at a path the user chose."""
    from rafiq_agent.tools.office import build_docx

    root = await _root()
    dest = Path(body.dest).expanduser()
    if not dest.is_absolute() or dest.suffix.lower() != ".docx":
        raise HTTPException(status_code=400, detail=tr("اختار مكان لملف Word."))
    try:
        text = notes.read(notes.resolve(root, body.path))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(build_docx(text))
    except (notes.NoteError, OSError) as e:
        raise _fail(e) from e
    return {"path": str(dest)}


# ── Help with the writing ─────────────────────────────────────────────────────────────────
# The editor sends the selected text and what to do with it; the model's answer replaces
# the selection once the user accepts it. These prompts are for the model.

ASSIST = {
    "tidy": "Reorganise this text into clear, well-structured Markdown: headings where they help, short paragraphs, lists for lists. Keep every idea and the writer's own words and language. Change nothing else.",
    "continue": "Continue this text naturally from where it stops, in the same language, voice and format, for one or two paragraphs. Reply with the continuation only, not the original.",
    "translate": "Translate this text: Arabic into English, anything else into Arabic. Keep the Markdown, code, names and links as they are.",
    "shorten": "Make this text shorter and clearer, keeping its meaning, its language and its Markdown.",
    "fix": "Fix spelling, grammar and punctuation in this text without changing its meaning, language, wording or Markdown more than needed.",
}


class AssistIn(BaseModel):
    action: Literal["tidy", "continue", "translate", "shorten", "fix"]
    text: str = Field(min_length=1, max_length=40_000)
    model_id: str | None = None


async def _assist_llm(model_id: str | None):
    """The model that helps: the one the user picked in the editor; without a pick, the
    helper model from Settings, or else the first working model. Returns it and its name."""
    from rafiq_agent.auth.resolve import llm_for

    async with SessionLocal() as session:
        if model_id:
            picked = await session.get(LlmModel, model_id)
            if picked is not None:
                return llm_for(picked), picked.name
        settings = await load_settings()
        helper = await session.get(LlmModel, settings.helper_model_id) if settings.helper_model_id else None
        if helper is not None and helper.verify_ok is not False:
            return llm_for(helper), helper.name
        rows = await session.execute(select(LlmModel).where(LlmModel.verify_ok.is_not(False)).limit(1))
        first = rows.scalars().first()
    return (llm_for(first), first.name) if first is not None else (None, "")


@router.post("/assist")
async def assist(body: AssistIn) -> dict[str, str]:
    llm, name = await _assist_llm(body.model_id)
    if llm is None:
        raise HTTPException(status_code=400, detail=tr("ضيف نموذج من صفحة النماذج أول."))
    messages = [
        {
            "role": "system",
            "content": ASSIST[body.action]
            + " Reply with the resulting text only — no introduction, no quotes around it, no code fence around it.",
        },
        {"role": "user", "content": body.text},
    ]
    try:
        text = await llm.complete(messages, max_tokens=4000)
    except Exception as e:  # noqa: BLE001 - the provider's own message is the useful one
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"text": text.strip(), "model": name}
