"""Search inside the user's files by what they say, not only by their names: «the invoice
from March», «the rental contract».

An index of what's in the files is kept on this machine only, in its own SQLite file
(file_index.db next to rafiq.db, so a long scan never holds up the app's own database). It
covers the folders chosen in Settings — Documents, Desktop and Downloads unless the user
picked others — and reads text, Markdown, code, CSV, Word, PowerPoint, Excel and PDF. Every
other file (pictures, videos, programs) is found by its name and folder.

The words go in folded the same way chat search folds them (core/search.py): «الفاتورة»,
«فاتورة» and «بالفاتورة» find each other, case and accents don't matter. Finding by
*meaning* is the model's half: the tool asks it for the other words the same thing might be
written with — both languages, singular and plural — and any of them may match. A file
matching more of them, in its name, or more recently changed comes first.

The scan keeps itself current: a background loop looks again every so often and only
reads files whose size or time changed, then rests between files so a laptop doesn't feel
it. Files that are gone drop out.
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
from rafiq_agent.core.search import index_text, snippet, terms

log = logging.getLogger(__name__)

INDEX_VERSION = 1
TABLE = f"files_v{INDEX_VERSION}"
RESCAN_SECONDS = 20 * 60
MAX_FILES = 60_000
MAX_BYTES = 25 * 1024 * 1024  # bigger files are found by name only
MAX_TEXT = 120_000  # characters of a file's text that are indexed
PDF_PAGES = 30
REST_EVERY = 25  # files read between short rests
REST_SECONDS = 0.05

TEXT = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".log", ".ini", ".yaml", ".yml",
        ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".cs", ".cpp", ".c", ".h", ".go", ".rs", ".php", ".rb", ".sql",
        ".sh", ".ps1", ".bat", ".css", ".srt", ".vtt", ".rtf"}
OFFICE = {".docx": "word/document.xml", ".pptx": "ppt/slides/", ".xlsx": "xl/sharedStrings.xml"}
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "$recycle.bin", "appdata", ".cache", "dist", "build",
             "target", ".idea", ".vscode", "site-packages", "obj", "bin"}
KINDS = {
    "pdf": {".pdf"},
    "doc": {".docx", ".doc", ".odt", ".rtf", ".txt", ".md"},
    "sheet": {".xlsx", ".xls", ".csv", ".ods"},
    "slides": {".pptx", ".ppt", ".odp"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".svg"},
    "video": {".mp4", ".mov", ".mkv", ".avi", ".webm"},
    "audio": {".mp3", ".wav", ".m4a", ".ogg", ".flac"},
}

_XML_TEXT = re.compile(r"<(?:w:t|a:t|t)(?:\s[^>]*)?>([^<]*)</(?:w:t|a:t|t)>")
_lock = threading.Lock()
_state: dict[str, Any] = {"scanning": False, "last_scan": None, "error": None}


def db_path() -> Path:
    return DATA_DIR / "file_index.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=30)
    conn.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS {TABLE} USING fts5("
        "path UNINDEXED, mtime UNINDEXED, size UNINDEXED, name, body, tokenize='unicode61')"
    )
    return conn


def default_dirs() -> list[str]:
    """Documents, Desktop and Downloads — where Windows really keeps them: OneDrive often
    takes over Documents and Desktop, so both places are looked at."""
    home = Path.home()
    found: list[str] = []
    for name in ("Documents", "Desktop", "Downloads"):
        for place in (home / "OneDrive" / name, home / name):
            if place.is_dir() and str(place) not in found:
                found.append(str(place))
    return found


def folders(chosen: list[str] | None) -> list[str]:
    picked = [str(Path(p).expanduser()) for p in (chosen or []) if p and p.strip()]
    return [p for p in (picked or default_dirs()) if Path(p).is_dir()]


# ── Reading a file's words ─────────────────────────────────────────────────────────────


def _office_text(path: Path, member: str) -> str:
    out: list[str] = []
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if n.startswith(member) and n.endswith(".xml")) if member.endswith("/") else [member]
        for name in names:
            with contextlib.suppress(KeyError):
                xml = z.read(name).decode("utf-8", "replace")
                out.append(" ".join(_XML_TEXT.findall(xml)))
            if sum(len(x) for x in out) > MAX_TEXT:
                break
    return "\n".join(out)


def _pdf_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    out: list[str] = []
    for page in reader.pages[:PDF_PAGES]:
        with contextlib.suppress(Exception):
            out.append(page.extract_text() or "")
        if sum(len(x) for x in out) > MAX_TEXT:
            break
    return "\n".join(out)


def read_words(path: Path) -> str:
    """The text inside a file, as far as it can be read; "" for anything else."""
    suffix = path.suffix.lower()
    try:
        if suffix in TEXT:
            with path.open("rb") as handle:
                raw = handle.read(MAX_TEXT * 2)
            for encoding in ("utf-8", "utf-16", "cp1256"):
                with contextlib.suppress(UnicodeDecodeError):
                    return raw.decode(encoding)[:MAX_TEXT]
            return raw.decode("utf-8", "replace")[:MAX_TEXT]
        if suffix in OFFICE:
            return _office_text(path, OFFICE[suffix])[:MAX_TEXT]
        if suffix == ".pdf":
            return _pdf_text(path)[:MAX_TEXT]
    except Exception:  # noqa: BLE001 - a broken or locked file is found by its name
        log.debug("couldn't read %s", path, exc_info=True)
    return ""


def name_words(path: Path) -> str:
    """A file's name and its folder's, with _ - . as spaces, so «فاتورة_آذار.pdf» has words."""
    words = re.sub(r"[_\-.]+", " ", f"{path.parent.name} {path.stem} {path.suffix.lstrip('.')}")
    return index_text(words)


# ── Scanning ───────────────────────────────────────────────────────────────────────────


def _walk(roots: list[str]):
    count = 0
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                if name.startswith(("~$", ".")):
                    continue
                count += 1
                if count > MAX_FILES:
                    return
                yield Path(dirpath) / name


def scan(roots: list[str], stop: threading.Event | None = None) -> dict[str, int]:
    """Brings the index up to date with `roots`. Returns what it did."""
    if not _lock.acquire(blocking=False):
        return {"busy": 1}
    _state["scanning"] = True
    done = {"added": 0, "updated": 0, "removed": 0, "seen": 0}
    try:
        conn = _connect()
        try:
            known = {row[0]: (row[1], row[2], row[3]) for row in conn.execute(f"SELECT path, mtime, size, rowid FROM {TABLE}")}
            seen: set[str] = set()
            read = 0
            for path in _walk(roots):
                if stop is not None and stop.is_set():
                    break
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
                body = index_text(read_words(path)) if info.st_size <= MAX_BYTES else ""
                if old:
                    conn.execute(f"DELETE FROM {TABLE} WHERE rowid = ?", (old[2],))
                conn.execute(
                    f"INSERT INTO {TABLE} (path, mtime, size, name, body) VALUES (?, ?, ?, ?, ?)",
                    (key, mtime, info.st_size, name_words(path), body),
                )
                done["updated" if old else "added"] += 1
                read += 1
                if read % REST_EVERY == 0:
                    conn.commit()
                    time.sleep(REST_SECONDS)
            if stop is None or not stop.is_set():
                for key, (_, _, rowid) in known.items():
                    if key not in seen:
                        conn.execute(f"DELETE FROM {TABLE} WHERE rowid = ?", (rowid,))
                        done["removed"] += 1
            conn.commit()
        finally:
            conn.close()
        _state["last_scan"] = datetime.now(UTC).isoformat()
        _state["error"] = None
    except Exception as exc:  # noqa: BLE001 - shown in Settings
        _state["error"] = str(exc)
        log.info("file index scan failed", exc_info=True)
    finally:
        _state["scanning"] = False
        _lock.release()
    return done


def clear() -> None:
    with _lock, contextlib.suppress(OSError):
        db_path().unlink()


def status() -> dict[str, Any]:
    count = 0
    if db_path().exists():
        with contextlib.suppress(sqlite3.Error):
            conn = _connect()
            try:
                count = int(conn.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0])
            finally:
                conn.close()
    return {"files": count, **_state}


# ── Searching ──────────────────────────────────────────────────────────────────────────


@dataclass
class Hit:
    path: str
    modified: str
    size: int
    snippet: str
    score: float


def _expression(words: list[str]) -> str:
    """Any of the words (each in its forms, as a prefix) — a file needn't have them all."""
    groups = [g for w in words for g in terms(w)]
    seen: set[str] = set()
    parts = []
    for forms in groups:
        for f in forms:
            if f not in seen:
                seen.add(f)
                parts.append(f'"{f}"*')
    return " OR ".join(parts)


def search(words: list[str], kind: str | None = None, since: datetime | None = None, limit: int = 15) -> list[Hit]:
    expression = _expression(words)
    if not expression or not db_path().exists():
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            f"SELECT path, mtime, size, bm25({TABLE}, 0, 0, 0, 4.0, 1.0) AS rank, body FROM {TABLE} "
            f"WHERE {TABLE} MATCH ? ORDER BY rank LIMIT 400",
            (expression,),
        ).fetchall()
    finally:
        conn.close()
    suffixes = KINDS.get(kind or "")
    folded_words = [form for w in words for g in terms(w) for form in g]
    hits: list[Hit] = []
    now = time.time()
    for path, mtime, size, rank, _body in rows:
        p = Path(path)
        if suffixes and p.suffix.lower() not in suffixes:
            continue
        modified = float(mtime)
        if since and modified < since.timestamp():
            continue
        if not p.exists():
            continue
        # bm25 is negative (lower is better); newer files get a small push.
        age_days = max(0.0, (now - modified) / 86400)
        score = -float(rank) + 2.0 / (1.0 + age_days / 30)
        hits.append(Hit(path, datetime.fromtimestamp(modified).strftime("%Y-%m-%d %H:%M"), int(size), "", score))
    hits.sort(key=lambda h: h.score, reverse=True)
    hits = hits[:limit]
    for hit in hits:
        text = read_words(Path(hit.path))
        if text:
            hit.snippet = snippet(text, folded_words)[0]
    return hits


def describe(hits: list[Hit]) -> str:
    if not hits:
        return ""
    lines = []
    for i, h in enumerate(hits, 1):
        size = f"{h.size / 1024:.0f} KB" if h.size < 1024 * 1024 else f"{h.size / 1024 / 1024:.1f} MB"
        line = f"{i}. {h.path}  ({h.modified}, {size})"
        if h.snippet:
            line += f"\n   «{' '.join(h.snippet.split())[:220]}»"
        lines.append(line)
    return "\n".join(lines)


# ── Keeping it current ─────────────────────────────────────────────────────────────────

_wake = asyncio.Event()


def rescan_soon() -> None:
    """Settings changed or the user asked: look again now rather than at the next turn."""
    with contextlib.suppress(RuntimeError):
        asyncio.get_running_loop().call_soon_threadsafe(_wake.set)


async def run_forever() -> None:
    from rafiq_agent.core.agent_runtime import load_settings

    await asyncio.sleep(45)  # let the app start first
    while True:
        try:
            settings = await load_settings()
            if settings.file_search_enabled:
                await asyncio.to_thread(scan, folders(settings.file_search_dirs))
        except Exception:  # noqa: BLE001
            log.info("file index loop failed", exc_info=True)
        _wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(_wake.wait(), RESCAN_SECONDS)
