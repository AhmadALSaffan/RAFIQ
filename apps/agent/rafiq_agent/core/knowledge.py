"""A folder of the user's documents that answers can come from, with the file and page.

Different from the file index (core/file_index.py), which finds *which file*: this keeps the
passages themselves, page by page, so a reply can quote them and say where they came from. It
covers only the folders the user chose in Settings → Memory, and lives on this machine only,
in its own SQLite file (knowledge.db next to rafiq.db).

PDF and PowerPoint keep their page and slide numbers. Word, Excel and text have no reliable
page, so their source is the file alone; saying a page we can't know would be a lie. A PDF
that is only scanned pictures has no text to read: it's counted and shown as unread rather
than silently missing.

The words go in folded like chat search (core/search.py), and the scan only rereads what
changed, resting between files.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import sqlite3
import threading
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rafiq_agent.config import DATA_DIR
from rafiq_agent.core.file_index import (
    MAX_BYTES,
    OFFICE,
    SKIP_DIRS,
    TEXT,
    _expression,
    _office_text,
    read_words,
)
from rafiq_agent.core.search import index_text

log = logging.getLogger(__name__)

CHUNKS = "chunks_v1"
FILES = "files_v1"
RESCAN_SECONDS = 15 * 60
MAX_FILES = 20_000
MAX_PDF_PAGES = 1000
CHUNK_CHARS = 900
OVERLAP = 120
PASSAGE_CHARS = 800
REST_EVERY = 10
REST_SECONDS = 0.05
READABLE = TEXT | set(OFFICE) | {".pdf"}

_XML_TEXT = re.compile(r"<a:t(?:\s[^>]*)?>([^<]*)</a:t>")
_SLIDE = re.compile(r"ppt/slides/slide(\d+)\.xml$")
_lock = threading.Lock()
_state: dict[str, Any] = {"scanning": False, "last_scan": None, "error": None}


def db_path() -> Path:
    return DATA_DIR / "knowledge.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=30)
    conn.execute(f"CREATE VIRTUAL TABLE IF NOT EXISTS {CHUNKS} USING fts5(path UNINDEXED, page UNINDEXED, text UNINDEXED, name, body, tokenize='unicode61')")
    conn.execute(f"CREATE TABLE IF NOT EXISTS {FILES} (path TEXT PRIMARY KEY, mtime REAL, size INTEGER, chunks INTEGER)")
    return conn


# ── Reading a file, page by page ───────────────────────────────────────────────────────


def _pdf_pages(path: Path) -> list[tuple[int | None, str]]:
    from pypdf import PdfReader

    out: list[tuple[int | None, str]] = []
    for number, page in enumerate(PdfReader(str(path)).pages[:MAX_PDF_PAGES], 1):
        with contextlib.suppress(Exception):
            if text := (page.extract_text() or "").strip():
                out.append((number, text))
    return out


def _slides(path: Path) -> list[tuple[int | None, str]]:
    out: list[tuple[int | None, str]] = []
    with zipfile.ZipFile(path) as z:
        slides = sorted((int(m.group(1)), n) for n in z.namelist() if (m := _SLIDE.match(n)))
        for number, name in slides:
            if text := " ".join(_XML_TEXT.findall(z.read(name).decode("utf-8", "replace"))).strip():
                out.append((number, text))
    return out


def read_pages(path: Path) -> list[tuple[int | None, str]]:
    """(page or None, text) for each part of a file; [] when there's nothing to read in it."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            return _pdf_pages(path)
        if suffix == ".pptx":
            return _slides(path)
        if suffix in OFFICE:
            text = _office_text(path, OFFICE[suffix])
        else:
            text = read_words(path)
    except Exception:  # noqa: BLE001 - a broken or locked file is counted as unread
        log.debug("couldn't read %s", path, exc_info=True)
        return []
    return [(None, text)] if text.strip() else []


def chunks(text: str) -> list[str]:
    """Passages of about CHUNK_CHARS, broken at paragraphs where there are any; a passage cut
    in the middle repeats a little of the one before, so a sentence isn't lost at the seam."""
    out: list[str] = []
    current = ""
    for para in re.split(r"\n\s*\n|\r\n\s*\r\n", text):
        para = para.strip()
        if not para:
            continue
        while len(para) > CHUNK_CHARS:
            if current:
                out.append(current)
                current = ""
            out.append(para[:CHUNK_CHARS])
            para = para[CHUNK_CHARS - OVERLAP :]
        if current and len(current) + len(para) + 2 > CHUNK_CHARS:
            out.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        out.append(current)
    return out


# ── Scanning ───────────────────────────────────────────────────────────────────────────


def _walk(roots: list[str]):
    count = 0
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                if name.startswith(("~$", ".")) or Path(name).suffix.lower() not in READABLE:
                    continue
                count += 1
                if count > MAX_FILES:
                    return
                yield Path(dirpath) / name


def scan(roots: list[str]) -> dict[str, int]:
    """Brings the passages up to date with `roots`; files outside them drop out."""
    if not _lock.acquire(blocking=False):
        return {"busy": 1}
    _state["scanning"] = True
    done = {"added": 0, "updated": 0, "removed": 0, "seen": 0}
    try:
        conn = _connect()
        try:
            known = {row[0]: (row[1], row[2]) for row in conn.execute(f"SELECT path, mtime, size FROM {FILES}")}
            seen: set[str] = set()
            read = 0
            for path in _walk([r for r in roots if Path(r).is_dir()]):
                try:
                    info = path.stat()
                except OSError:
                    continue
                key = str(path)
                seen.add(key)
                done["seen"] += 1
                old = known.get(key)
                mtime = round(info.st_mtime, 2)
                if old and float(old[0]) == mtime and int(old[1]) == info.st_size:
                    continue
                conn.execute(f"DELETE FROM {CHUNKS} WHERE path = ?", (key,))
                count = 0
                if info.st_size <= MAX_BYTES:
                    name = index_text(path.stem.replace("_", " ").replace("-", " "))
                    for page, text in read_pages(path):
                        for piece in chunks(text):
                            conn.execute(
                                f"INSERT INTO {CHUNKS} (path, page, text, name, body) VALUES (?, ?, ?, ?, ?)",
                                (key, page, piece, name, index_text(piece)),
                            )
                            count += 1
                conn.execute(f"INSERT OR REPLACE INTO {FILES} VALUES (?, ?, ?, ?)", (key, mtime, info.st_size, count))
                done["updated" if old else "added"] += 1
                read += 1
                if read % REST_EVERY == 0:
                    conn.commit()
                    time.sleep(REST_SECONDS)
            for key in known:
                if key not in seen:
                    conn.execute(f"DELETE FROM {CHUNKS} WHERE path = ?", (key,))
                    conn.execute(f"DELETE FROM {FILES} WHERE path = ?", (key,))
                    done["removed"] += 1
            conn.commit()
        finally:
            conn.close()
        _state["last_scan"] = datetime.now(UTC).isoformat()
        _state["error"] = None
    except Exception as exc:  # noqa: BLE001 - shown in Settings
        _state["error"] = str(exc)
        log.info("knowledge scan failed", exc_info=True)
    finally:
        _state["scanning"] = False
        _lock.release()
    return done


def clear() -> None:
    with _lock, contextlib.suppress(OSError):
        db_path().unlink()


def status() -> dict[str, Any]:
    files = passages = 0
    unread: list[str] = []
    if db_path().exists():
        with contextlib.suppress(sqlite3.Error):
            conn = _connect()
            try:
                files = int(conn.execute(f"SELECT count(*) FROM {FILES}").fetchone()[0])
                passages = int(conn.execute(f"SELECT coalesce(sum(chunks), 0) FROM {FILES}").fetchone()[0])
                unread = [Path(p).name for (p,) in conn.execute(f"SELECT path FROM {FILES} WHERE chunks = 0 LIMIT 20")]
            finally:
                conn.close()
    return {"files": files, "passages": passages, "unread": unread, **_state}


# ── Searching ──────────────────────────────────────────────────────────────────────────


@dataclass
class Passage:
    path: str
    page: int | None
    text: str
    score: float


def search(words: list[str], limit: int = 8) -> list[Passage]:
    expression = _expression(words)
    if not expression or not db_path().exists():
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            f"SELECT path, page, text, bm25({CHUNKS}, 0, 0, 0, 2.0, 1.0) AS rank FROM {CHUNKS} WHERE {CHUNKS} MATCH ? ORDER BY rank LIMIT ?",
            (expression, limit * 3),
        ).fetchall()
    finally:
        conn.close()
    out: list[Passage] = []
    for path, page, text, rank in rows:
        if Path(path).exists():
            out.append(Passage(path, int(page) if page is not None else None, text, -float(rank)))
        if len(out) >= limit:
            break
    return out


def describe(passages: list[Passage], start: int = 1) -> str:
    """Numbered passages. The app reads these header lines to show the sources under the
    reply, whatever the model does with them; keep their shape in step with sources.ts."""
    blocks = []
    for i, p in enumerate(passages, start):
        where = f"{Path(p.path).name} · p.{p.page}" if p.page is not None else Path(p.path).name
        blocks.append(f"[{i}] {where} · {p.path}\n{p.text[:PASSAGE_CHARS]}")
    return "\n\n".join(blocks)


# ── Keeping it current ─────────────────────────────────────────────────────────────────

_wake = asyncio.Event()


def rescan_soon() -> None:
    with contextlib.suppress(RuntimeError):
        asyncio.get_running_loop().call_soon_threadsafe(_wake.set)


async def run_forever() -> None:
    from rafiq_agent.core.agent_runtime import load_settings

    await asyncio.sleep(20)
    while True:
        try:
            await asyncio.to_thread(scan, (await load_settings()).knowledge_dirs)
        except Exception:  # noqa: BLE001
            log.info("knowledge loop failed", exc_info=True)
        _wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(_wake.wait(), RESCAN_SECONDS)
