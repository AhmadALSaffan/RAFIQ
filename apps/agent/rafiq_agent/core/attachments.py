import base64
import io
import mimetypes
import re
from pathlib import Path
from typing import Any

from PIL import Image
from pypdf import PdfReader
from sqlalchemy import select

from rafiq_agent.config import DATA_DIR
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Attachment

ATTACH_DIR = DATA_DIR / "attachments"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_TEXT_CHARS = 60_000
MAX_IMAGE_EDGE = 1568  # Anthropic's recommended long edge; also keeps every provider under its size cap

_TEXT_MIMES = {
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/sql",
}


class AttachmentError(Exception):
    pass


def classify(name: str, mime: str, head: bytes) -> str:
    if mime.startswith("image/") and mime != "image/svg+xml":
        return "image"
    if mime == "application/pdf" or name.lower().endswith(".pdf"):
        return "pdf"
    if mime.startswith("text/") or mime in _TEXT_MIMES:
        return "text"
    try:
        head.decode("utf-8")
        return "text"
    except UnicodeDecodeError:
        return "binary"


def _safe_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", Path(name).name).strip() or "file"
    return cleaned[:120]


async def save_upload(name: str, mime: str | None, data: bytes) -> Attachment:
    if len(data) > MAX_UPLOAD_BYTES:
        raise AttachmentError("الملف أكبر من 25 ميغا.")
    name = _safe_name(name)
    mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"
    kind = classify(name, mime, data[:4096])

    async with SessionLocal() as session:
        attachment = Attachment(name=name, mime=mime, kind=kind, size=len(data), path="")
        session.add(attachment)
        await session.flush()
        folder = ATTACH_DIR / attachment.id
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / name
        target.write_bytes(data)
        attachment.path = str(target)
        await session.commit()
        await session.refresh(attachment)
        return attachment


async def load_attachments(ids: list[str]) -> list[Attachment]:
    if not ids:
        return []
    async with SessionLocal() as session:
        rows = (await session.execute(select(Attachment).where(Attachment.id.in_(ids)))).scalars().all()
    by_id = {a.id: a for a in rows}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise AttachmentError("في مرفق مش موجود — جرّب ترفعه مرة ثانية.")
    return [by_id[i] for i in ids]


def meta(a: Attachment) -> dict[str, Any]:
    return {"id": a.id, "name": a.name, "mime": a.mime, "kind": a.kind, "size": a.size}


def _image_data_url(path: str) -> str:
    with Image.open(path) as img:
        img.load()
        if max(img.size) > MAX_IMAGE_EDGE:
            img.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        buffer = io.BytesIO()
        if has_alpha:
            img.convert("RGBA").save(buffer, format="PNG", optimize=True)
            mime = "image/png"
        else:
            img.convert("RGB").save(buffer, format="JPEG", quality=85)
            mime = "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(buffer.getvalue()).decode()}"


def _pdf_text(path: str) -> str:
    reader = PdfReader(path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        pages.append(f"--- صفحة {i} ---\n{page.extract_text() or ''}")
        if sum(len(p) for p in pages) > MAX_TEXT_CHARS:
            break
    return "\n".join(pages)


def _truncate(text: str) -> str:
    return text if len(text) <= MAX_TEXT_CHARS else text[:MAX_TEXT_CHARS] + "\n… (مقطوع — الملف أطول من هيك)"


def build_user_content(
    text: str, attachments: list[Attachment], vision: bool | None
) -> str | list[dict[str, Any]]:
    """Turns a user message + attachments into an OpenAI-style content value (litellm maps it per provider)."""
    if not attachments:
        return text

    parts: list[dict[str, Any]] = []
    notes: list[str] = []
    for a in attachments:
        try:
            if a.kind == "image":
                if vision is False:
                    notes.append(f"[صورة مرفقة «{a.name}» — هالموديل ما بيقدر يشوف الصور]")
                else:
                    parts.append({"type": "image_url", "image_url": {"url": _image_data_url(a.path)}})
                    notes.append(f"[صورة مرفقة: {a.name}]")
            elif a.kind == "pdf":
                notes.append(f"📎 ملف PDF «{a.name}»:\n{_truncate(_pdf_text(a.path))}")
            elif a.kind == "text":
                content = Path(a.path).read_text(encoding="utf-8", errors="replace")
                notes.append(f"📎 ملف «{a.name}»:\n```\n{_truncate(content)}\n```")
            else:
                notes.append(f"[ملف مرفق «{a.name}» ({a.mime}, {a.size} بايت) — نوعه ما بينقرأ كنص]")
        except Exception as exc:  # noqa: BLE001 - one unreadable file shouldn't sink the message
            notes.append(f"[ما قدرت أقرأ «{a.name}»: {exc}]")

    combined = "\n\n".join([text, *notes]) if text else "\n\n".join(notes)
    if not any(p["type"] == "image_url" for p in parts):
        return combined
    return [{"type": "text", "text": combined}, *parts]
