"""Per-agent knowledge bases: local folders an agent answers from, with citations.

A *source* is one folder on this computer. An agent sees a source only while it holds a
*grant* for it: the user attaches a folder to an agent in that agent's Knowledge section (one
folder can serve several agents, indexed once). Every retrieval reads the grants afresh and
filters by them inside the query, before anything is ranked, so removing a folder from an
agent takes effect on its very next search.

Different from core/knowledge.py (one folder for every chat, PDF and Office pages): here each
passage keeps the line range it came from, so a citation opens the file at the passage.

Everything lives in `agent_knowledge.db` next to rafiq.db, on this computer only. Markdown and
plain text for now. Passages are cut at Markdown headings (the heading path is kept) and then
to about 1,200 characters at blank lines. Each one gets a citation ID, `kb-` and ten hex
digits from its source, file and text: the same passage keeps its ID across refreshes, and a
changed one gets a new ID.

Search is by words (SQLite FTS5, Arabic and English folded like chat search), and also by
meaning when embeddings are on (core/embeddings.py); the two rankings are fused.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import os
import re
import sqlite3
import sys
import threading
import time
import uuid
from array import array
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from rafiq_agent.config import DATA_DIR
from rafiq_agent.core.file_index import SKIP_DIRS, _expression
from rafiq_agent.core.search import index_text

log = logging.getLogger(__name__)

EXTENSIONS = {".md", ".markdown", ".txt"}
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_FILES = 10_000
CHUNK_CHARS = 1200
MAX_PASSAGE = 4000
KEYWORD_CANDIDATES = 60
VECTOR_CANDIDATES = 60
# Below this, a passage found by meaning alone isn't evidence.
MIN_SIMILARITY = 0.35
CITATION = re.compile(r"\bkb-[0-9a-f]{10}\b")

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")
_lock = threading.RLock()
_jobs: dict[str, asyncio.Task] = {}


def db_path() -> Path:
    return DATA_DIR / "agent_knowledge.db"


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path(), timeout=30)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS kb_sources (
            id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued', error TEXT, indexed_at REAL,
            files INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0, embedded INTEGER NOT NULL DEFAULT 0,
            embed_key TEXT);
        CREATE TABLE IF NOT EXISTS kb_grants (
            agent_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
            created REAL NOT NULL, PRIMARY KEY (agent_id, source_id));
        CREATE TABLE IF NOT EXISTS kb_files (
            source_id TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE, rel_path TEXT NOT NULL,
            mtime REAL NOT NULL, size INTEGER NOT NULL, sha TEXT NOT NULL, PRIMARY KEY (source_id, rel_path));
        CREATE TABLE IF NOT EXISTS kb_chunks (
            id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
            rel_path TEXT NOT NULL, heading TEXT, line_start INTEGER NOT NULL, line_end INTEGER NOT NULL,
            text TEXT NOT NULL, vector BLOB, embed_key TEXT);
        CREATE INDEX IF NOT EXISTS kb_chunks_file ON kb_chunks (source_id, rel_path);
        CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(id UNINDEXED, source_id UNINDEXED, body, tokenize='unicode61');
        """
    )
    return conn


# ── Cutting a file into passages ───────────────────────────────────────────────────────


@dataclass
class Piece:
    heading: str | None
    line_start: int  # 1-based, inclusive
    line_end: int
    text: str


def split(text: str, markdown: bool) -> list[Piece]:
    """Passages of one file, each with its heading path (Markdown) and its lines."""
    lines = text.splitlines()
    pieces: list[Piece] = []
    stack: list[str] = []
    heading: str | None = None
    start = 0
    fenced = False

    def flush(end: int) -> None:
        pieces.extend(_windows(lines, start, end, heading))

    for i, line in enumerate(lines):
        if markdown and _FENCE.match(line):
            fenced = not fenced
        match = _HEADING.match(line) if markdown and not fenced else None
        if match:
            flush(i)
            level = len(match.group(1))
            stack = stack[: level - 1] + [match.group(2).strip()]
            heading, start = " › ".join(stack), i
    flush(len(lines))
    return pieces


def _windows(lines: list[str], start: int, end: int, heading: str | None) -> list[Piece]:
    """Lines [start, end) packed into passages of about CHUNK_CHARS, cut at blank lines."""
    out: list[Piece] = []
    i = start
    while i < end:
        size, j, blank = 0, i, None
        while j < end and (size == 0 or size + len(lines[j]) + 1 <= CHUNK_CHARS):
            size += len(lines[j]) + 1
            if j > i and not lines[j].strip():
                blank = j
            j += 1
        if j < end and blank is not None:
            j = blank
        first, last = i, j - 1
        while first <= last and not lines[first].strip():
            first += 1
        while last >= first and not lines[last].strip():
            last -= 1
        body = [ln for ln in lines[first : last + 1] if not _HEADING.match(ln)]
        if first <= last and any(ln.strip() for ln in body):
            out.append(Piece(heading, first + 1, last + 1, "\n".join(lines[first : last + 1])[:MAX_PASSAGE]))
        i = max(j, i + 1)
    return out


def citation_id(source_id: str, rel_path: str, text: str, nth: int) -> str:
    digest = hashlib.sha1(f"{source_id}\0{rel_path}\0{nth}\0{text}".encode()).hexdigest()
    return f"kb-{digest[:10]}"


# ── Sources and grants ─────────────────────────────────────────────────────────────────


def _source_row(row: tuple) -> dict[str, Any]:
    keys = ("id", "path", "name", "status", "error", "indexed_at", "files", "chunks", "embedded", "embed_key")
    return dict(zip(keys, row, strict=True))


_SOURCE_COLUMNS = "s.id, s.path, s.name, s.status, s.error, s.indexed_at, s.files, s.chunks, s.embedded, s.embed_key"


def sources_for(agent_id: str) -> list[dict[str, Any]]:
    """The folders this agent may read, as they stand now."""
    if not db_path().exists():
        return []
    with _lock:
        conn = _connect()
        try:
            rows = conn.execute(
                f"SELECT {_SOURCE_COLUMNS} FROM kb_grants g JOIN kb_sources s ON s.id = g.source_id "
                "WHERE g.agent_id = ? ORDER BY g.created",
                (agent_id,),
            ).fetchall()
        finally:
            conn.close()
    return [_source_row(r) for r in rows]


def has_sources(agent_id: str | None) -> bool:
    return bool(agent_id) and bool(sources_for(agent_id))


def attach(agent_id: str, folder: str) -> dict[str, Any]:
    """Gives the agent this folder (indexing it if no agent had it). Returns the source."""
    root = Path(folder).expanduser()
    if not root.is_dir():
        raise ValueError("folder not found")
    path = str(root.resolve())
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT id FROM kb_sources WHERE path = ?", (path,)).fetchone()
            if row is None:
                source_id = uuid.uuid4().hex[:12]
                conn.execute(
                    "INSERT INTO kb_sources (id, path, name, created) VALUES (?, ?, ?, ?)",
                    (source_id, path, root.resolve().name or path, time.time()),
                )
                fresh = True
            else:
                source_id, fresh = row[0], False
            conn.execute(
                "INSERT OR IGNORE INTO kb_grants (agent_id, source_id, created) VALUES (?, ?, ?)",
                (agent_id, source_id, time.time()),
            )
            conn.commit()
        finally:
            conn.close()
    if fresh:
        refresh_soon(source_id)
    return next(s for s in sources_for(agent_id) if s["id"] == source_id)


def detach(agent_id: str, source_id: str) -> bool:
    """Takes the folder away from the agent. A folder no agent has any more is forgotten,
    index and all."""
    with _lock:
        conn = _connect()
        try:
            gone = conn.execute("DELETE FROM kb_grants WHERE agent_id = ? AND source_id = ?", (agent_id, source_id)).rowcount
            left = conn.execute("SELECT count(*) FROM kb_grants WHERE source_id = ?", (source_id,)).fetchone()[0]
            if gone and not left:
                _forget(conn, source_id)
            conn.commit()
        finally:
            conn.close()
    return bool(gone)


def forget_agent(agent_id: str) -> None:
    """The agent was deleted: its grants go, and so do folders only it had."""
    for source in sources_for(agent_id):
        detach(agent_id, source["id"])


def _forget(conn: sqlite3.Connection, source_id: str) -> None:
    job = _jobs.pop(source_id, None)
    if job is not None:
        job.cancel()
    conn.execute("DELETE FROM kb_fts WHERE source_id = ?", (source_id,))
    conn.execute("DELETE FROM kb_chunks WHERE source_id = ?", (source_id,))
    conn.execute("DELETE FROM kb_files WHERE source_id = ?", (source_id,))
    conn.execute("DELETE FROM kb_sources WHERE id = ?", (source_id,))


def granted(agent_id: str, source_id: str) -> bool:
    return any(s["id"] == source_id for s in sources_for(agent_id))


# ── Indexing ───────────────────────────────────────────────────────────────────────────


def _walk(root: Path) -> dict[str, tuple[float, int]]:
    """rel_path → (mtime, size) for every Markdown and text file under the folder."""
    found: dict[str, tuple[float, int]] = {}
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            path = Path(current) / name
            if path.suffix.lower() not in EXTENSIONS:
                continue
            try:
                info = path.stat()
            except OSError:
                continue
            if info.st_size > MAX_FILE_BYTES:
                continue
            found[path.relative_to(root).as_posix()] = (info.st_mtime, info.st_size)
            if len(found) >= MAX_FILES:
                return found
    return found


def _read(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig",):
        with contextlib.suppress(UnicodeDecodeError):
            return raw.decode(encoding)
    return raw.decode("utf-8", errors="replace")


def _set(conn: sqlite3.Connection, source_id: str, **values: Any) -> None:
    sets = ", ".join(f"{k} = ?" for k in values)
    conn.execute(f"UPDATE kb_sources SET {sets} WHERE id = ?", (*values.values(), source_id))


def _sync_files(source_id: str) -> dict[str, int]:
    """Reads what changed under the folder and drops what was deleted. Blocking."""
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT path FROM kb_sources WHERE id = ?", (source_id,)).fetchone()
            if row is None:
                return {}
            root = Path(row[0])
            _set(conn, source_id, status="indexing", error=None)
            conn.commit()
            known = {r[0]: (r[1], r[2], r[3]) for r in conn.execute("SELECT rel_path, mtime, size, sha FROM kb_files WHERE source_id = ?", (source_id,))}
        finally:
            conn.close()
    if not root.is_dir():
        raise FileNotFoundError("folder not found")
    current = _walk(root)
    stats = {"read": 0, "removed": 0}
    with _lock:
        conn = _connect()
        try:
            for rel in set(known) - set(current):
                _drop_file(conn, source_id, rel)
                stats["removed"] += 1
            for rel, (mtime, size) in current.items():
                before = known.get(rel)
                if before and before[0] == mtime and before[1] == size:
                    continue
                try:
                    text = _read(root / rel)
                except OSError:
                    continue
                sha = hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()
                if before and before[2] == sha:
                    conn.execute("UPDATE kb_files SET mtime = ?, size = ? WHERE source_id = ? AND rel_path = ?", (mtime, size, source_id, rel))
                    continue
                _drop_file(conn, source_id, rel)
                markdown = Path(rel).suffix.lower() in (".md", ".markdown")
                seen: dict[str, int] = {}
                for piece in split(text, markdown):
                    nth = seen.get(piece.text, 0)
                    seen[piece.text] = nth + 1
                    cid = citation_id(source_id, rel, piece.text, nth)
                    conn.execute(
                        "INSERT OR REPLACE INTO kb_chunks (id, source_id, rel_path, heading, line_start, line_end, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (cid, source_id, rel, piece.heading, piece.line_start, piece.line_end, piece.text),
                    )
                    words = f"{Path(rel).stem.replace('_', ' ').replace('-', ' ')}\n{piece.heading or ''}\n{piece.text}"
                    conn.execute("INSERT INTO kb_fts (id, source_id, body) VALUES (?, ?, ?)", (cid, source_id, index_text(words)))
                conn.execute(
                    "INSERT OR REPLACE INTO kb_files (source_id, rel_path, mtime, size, sha) VALUES (?, ?, ?, ?, ?)",
                    (source_id, rel, mtime, size, sha),
                )
                stats["read"] += 1
            files = conn.execute("SELECT count(*) FROM kb_files WHERE source_id = ?", (source_id,)).fetchone()[0]
            chunks = conn.execute("SELECT count(*) FROM kb_chunks WHERE source_id = ?", (source_id,)).fetchone()[0]
            _set(conn, source_id, files=files, chunks=chunks)
            conn.commit()
        finally:
            conn.close()
    return stats


def _drop_file(conn: sqlite3.Connection, source_id: str, rel: str) -> None:
    ids = [r[0] for r in conn.execute("SELECT id FROM kb_chunks WHERE source_id = ? AND rel_path = ?", (source_id, rel))]
    for cid in ids:
        conn.execute("DELETE FROM kb_fts WHERE id = ?", (cid,))
    conn.execute("DELETE FROM kb_chunks WHERE source_id = ? AND rel_path = ?", (source_id, rel))
    conn.execute("DELETE FROM kb_files WHERE source_id = ? AND rel_path = ?", (source_id, rel))


def _pack(vector: list[float]) -> bytes:
    return array("f", vector).tobytes()


def _unpack(blob: bytes) -> array:
    out = array("f")
    out.frombytes(blob)
    return out


async def _embed_missing(source_id: str) -> None:
    """Vectors for the passages that have none from the current embedding model."""
    from rafiq_agent.core import embeddings

    embedder = await embeddings.current()
    if embedder is None:
        return
    with _lock:
        conn = _connect()
        try:
            todo = conn.execute(
                "SELECT id, heading, text FROM kb_chunks WHERE source_id = ? AND (embed_key IS NULL OR embed_key != ?)",
                (source_id, embedder.key),
            ).fetchall()
        finally:
            conn.close()
    for start in range(0, len(todo), 64):
        batch = todo[start : start + 64]
        vectors = await embedder.embed([f"{h}\n{t}" if h else t for _, h, t in batch])
        with _lock:
            conn = _connect()
            try:
                for (cid, _, _), vector in zip(batch, vectors, strict=True):
                    conn.execute("UPDATE kb_chunks SET vector = ?, embed_key = ? WHERE id = ?", (_pack(vector), embedder.key, cid))
                conn.commit()
            finally:
                conn.close()
    with _lock:
        conn = _connect()
        try:
            embedded = conn.execute("SELECT count(*) FROM kb_chunks WHERE source_id = ? AND embed_key = ?", (source_id, embedder.key)).fetchone()[0]
            _set(conn, source_id, embedded=embedded, embed_key=embedder.key)
            conn.commit()
        finally:
            conn.close()


async def index(source_id: str) -> dict[str, int]:
    """Brings one folder's index up to date: changed files reread, deleted ones dropped,
    then vectors for new passages when embeddings are on."""
    error = None
    stats: dict[str, int] = {}
    try:
        stats = await asyncio.to_thread(_sync_files, source_id)
        try:
            await _embed_missing(source_id)
        except Exception as exc:  # noqa: BLE001 - words still work; the user sees why meaning doesn't
            error = f"embeddings: {exc}"
            log.warning("knowledge base %s: %s", source_id, error)
    except FileNotFoundError:
        error = "folder not found"
    except Exception as exc:  # noqa: BLE001
        error = str(exc)[:300]
        log.exception("knowledge base %s failed", source_id)
    with _lock:
        conn = _connect()
        try:
            _set(conn, source_id, status="error" if error and not stats else "ready", error=error, indexed_at=time.time())
            conn.commit()
        finally:
            conn.close()
    return stats


def refresh_soon(source_id: str) -> None:
    """Indexes the folder in the background (once at a time)."""
    job = _jobs.get(source_id)
    if job is not None and not job.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    with _lock:
        conn = _connect()
        try:
            _set(conn, source_id, status="queued")
            conn.commit()
        finally:
            conn.close()
    _jobs[source_id] = loop.create_task(index(source_id))


def refresh_all() -> None:
    """Every folder, e.g. after the embedding model changed."""
    if not db_path().exists():
        return
    with _lock:
        conn = _connect()
        try:
            ids = [r[0] for r in conn.execute("SELECT id FROM kb_sources")]
        finally:
            conn.close()
    for source_id in ids:
        refresh_soon(source_id)


# ── Retrieval ──────────────────────────────────────────────────────────────────────────


@dataclass
class Passage:
    id: str
    source_id: str
    source_name: str
    rel_path: str
    heading: str | None
    line_start: int
    line_end: int
    text: str
    score: float = 0.0

    def meta(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("text")
        data.pop("score")
        return data


@dataclass
class Retrieval:
    passages: list[Passage]
    sources: int
    reason: str  # "found" | "no_access" | "empty" | "no_match"
    embedder: str | None = None
    embedder_local: bool = True


def _keyword(conn: sqlite3.Connection, allowed: list[str], words: list[str]) -> list[str]:
    expression = _expression(words)
    if not expression:
        return []
    marks = ",".join("?" * len(allowed))
    # The grant filter sits in the same query as the match, so another folder's passages are
    # never ranked, let alone returned.
    rows = conn.execute(
        f"SELECT id FROM kb_fts WHERE kb_fts MATCH ? AND source_id IN ({marks}) ORDER BY bm25(kb_fts) LIMIT ?",
        (expression, *allowed, KEYWORD_CANDIDATES),
    ).fetchall()
    return [r[0] for r in rows]


def _vector(conn: sqlite3.Connection, allowed: list[str], key: str, query: list[float]) -> list[tuple[str, float]]:
    marks = ",".join("?" * len(allowed))
    rows = conn.execute(
        f"SELECT id, vector FROM kb_chunks WHERE source_id IN ({marks}) AND embed_key = ? AND vector IS NOT NULL",
        (*allowed, key),
    ).fetchall()
    scored = []
    for cid, blob in rows:
        vector = _unpack(blob)
        if len(vector) != len(query):
            continue
        score = sum(a * b for a, b in zip(vector, query, strict=True))
        if score >= MIN_SIMILARITY:
            scored.append((cid, score))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:VECTOR_CANDIDATES]


async def retrieve(agent_id: str, question: str, words: list[str], limit: int = 6) -> Retrieval:
    """Passages for this agent only. The grants are read now, not when the chat started."""
    sources = sources_for(agent_id)
    if not sources:
        return Retrieval([], 0, "no_access")
    allowed = [s["id"] for s in sources]
    names = {s["id"]: s["name"] for s in sources}
    if not any(s["chunks"] for s in sources):
        return Retrieval([], len(sources), "empty")

    query_vector: list[float] | None = None
    key = None
    embedder_label = None
    embedder_local = True
    from rafiq_agent.core import embeddings

    try:
        embedder = await embeddings.current()
    except Exception:  # noqa: BLE001 - words alone still answer
        embedder = None
    if embedder is not None and any(s["embed_key"] == embedder.key and s["embedded"] for s in sources):
        try:
            query_vector = (await embedder.embed([question or " ".join(words)]))[0]
            key, embedder_label, embedder_local = embedder.key, embedder.label, embedder.local
        except Exception as exc:  # noqa: BLE001
            log.warning("knowledge search without meaning: %s", exc)

    def run() -> list[Passage]:
        with _lock:
            conn = _connect()
            try:
                keyword = _keyword(conn, allowed, [*words, question] if question else words)
                vector = _vector(conn, allowed, key, query_vector) if query_vector and key else []
                # Reciprocal rank fusion: a passage high on either list ranks high.
                fused: dict[str, float] = {}
                for rank, cid in enumerate(keyword):
                    fused[cid] = fused.get(cid, 0) + 1 / (60 + rank)
                for rank, (cid, _) in enumerate(vector):
                    fused[cid] = fused.get(cid, 0) + 1 / (60 + rank)
                best = sorted(fused, key=fused.get, reverse=True)[:limit]
                if not best:
                    return []
                marks = ",".join("?" * len(best))
                grant_marks = ",".join("?" * len(allowed))
                rows = conn.execute(
                    f"SELECT id, source_id, rel_path, heading, line_start, line_end, text FROM kb_chunks "
                    f"WHERE id IN ({marks}) AND source_id IN ({grant_marks})",
                    (*best, *allowed),
                ).fetchall()
            finally:
                conn.close()
        by_id = {r[0]: r for r in rows}
        return [
            Passage(r[0], r[1], names[r[1]], r[2], r[3], r[4], r[5], r[6], round(fused[r[0]], 5))
            for cid in best
            if (r := by_id.get(cid))
        ]

    passages = await asyncio.to_thread(run)
    return Retrieval(passages, len(sources), "found" if passages else "no_match", embedder_label, embedder_local)


def describe(passages: list[Passage]) -> str:
    out = []
    for p in passages:
        where = f"{p.source_name}/{p.rel_path}" + (f" › {p.heading}" if p.heading else "") + f", lines {p.line_start}-{p.line_end}"
        out.append(f"[{p.id}] {where}\n{p.text}")
    return "\n\n---\n\n".join(out)


# ── Citations ──────────────────────────────────────────────────────────────────────────


def citation(agent_id: str, cid: str, context: int = 3) -> dict[str, Any] | None:
    """The cited passage, for an agent that still has its folder; None otherwise."""
    if not CITATION.fullmatch(cid) or not db_path().exists():
        return None
    sources = {s["id"]: s for s in sources_for(agent_id)}
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT id, source_id, rel_path, heading, line_start, line_end, text FROM kb_chunks WHERE id = ?", (cid,)
            ).fetchone()
        finally:
            conn.close()
    if row is None or row[1] not in sources:
        return None
    source = sources[row[1]]
    root = Path(source["path"]).resolve()
    path = (root / row[2]).resolve()
    if not path.is_relative_to(root):
        return None
    lines: list[str] = []
    first = max(1, row[4] - context)
    with contextlib.suppress(OSError):
        lines = _read(path).splitlines()[first - 1 : row[5] + context]
    return {
        "id": row[0],
        "source_id": row[1],
        "source_name": source["name"],
        "rel_path": row[2],
        "path": str(path),
        "heading": row[3],
        "line_start": row[4],
        "line_end": row[5],
        "text": row[6],
        "exists": path.is_file(),
        "context_start": first,
        "context": lines,
    }


def open_citation(agent_id: str, cid: str) -> dict[str, Any] | None:
    """Opens the cited file: in VS Code at the passage's first line when it's installed,
    otherwise in the program the system opens such files with (no line there)."""
    import shutil
    import subprocess

    found = citation(agent_id, cid, context=0)
    if found is None or not found["exists"]:
        return None
    path, line = found["path"], found["line_start"]
    flags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW
    code = shutil.which("code")
    if code:
        subprocess.Popen([code, "--goto", f"{path}:{line}"], creationflags=flags)  # noqa: S603
        return {"opened": "editor", "line": line}
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])  # noqa: S603, S607
    else:
        subprocess.Popen(["xdg-open", path])  # noqa: S603, S607
    return {"opened": "default", "line": None}
