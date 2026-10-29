"""Tasks that start when something happens, not at a time: a new file lands in a folder,
text is copied, or a program opens. They are schedules of their own kinds ("folder",
"clipboard", "app"), listed, edited and recorded with the timed ones.

A loop looks every few seconds. What it saw last time is kept in memory only, and the
first look after the app starts (or after a trigger is saved) only takes note of what is
already there — so files that were in the folder all along, the text already on the
clipboard, or a program that was already open never start anything.

Every start is a task like any other, with what happened added to its instructions. So a
trigger can't burn through a budget by itself, each one waits a little between runs and
starts at most `MAX_PER_HOUR` tasks an hour.
"""

from __future__ import annotations

import asyncio
import contextlib
import fnmatch
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Schedule, ScheduleRun

log = logging.getLogger(__name__)

EVENT_KINDS = frozenset({"folder", "clipboard", "app"})
TICK_SECONDS = 3
# Between two starts of the same trigger, and how many it may start in an hour.
MIN_GAP_SECONDS = {"folder": 10, "clipboard": 8, "app": 30}
MAX_PER_HOUR = 30
# Files still being written: browsers' partial downloads, Office lock files, temp files.
PARTIAL = ("*.crdownload", "*.part", "*.partial", "*.tmp", "*.download", "~$*", ".~lock*", "*.opdownload")
MAX_FILES_PER_RUN = 20
MAX_CLIP = 4000
MIN_CLIP = 3
CLIP_FILTERS = ("any", "latin", "arabic", "link")
_LINK = re.compile(r"^\s*https?://\S+\s*$", re.I)


@dataclass
class _Seen:
    """What one trigger saw last time, and when it last started a task."""

    snapshot: Any = None
    pending: dict[str, int] = field(default_factory=dict)  # new file → size at last look
    starts: list[float] = field(default_factory=list)


_seen: dict[str, _Seen] = {}


def forget(schedule_id: str) -> None:
    """A trigger saved again starts fresh: its next look only takes note of what's there."""
    _seen.pop(schedule_id, None)


# ── What happened ──────────────────────────────────────────────────────────────────────


def patterns(raw: str | None) -> list[str]:
    """"*.pdf, *.jpg" → ["*.pdf", "*.jpg"]; nothing = every file."""
    return [p.strip() for p in re.split(r"[,;\s]+", raw or "") if p.strip()] or ["*"]


def wanted_file(name: str, filter_raw: str | None) -> bool:
    low = name.lower()
    if any(fnmatch.fnmatch(low, p) for p in PARTIAL):
        return False
    return any(fnmatch.fnmatch(low, p.lower()) for p in patterns(filter_raw))


def list_folder(folder: str) -> dict[str, int]:
    """The files directly in `folder` (not in sub-folders), name → size."""
    out: dict[str, int] = {}
    with contextlib.suppress(OSError), os.scandir(folder) as entries:
        for entry in entries:
            with contextlib.suppress(OSError):
                if entry.is_file():
                    out[entry.name] = entry.stat().st_size
    return out


def new_files(seen: _Seen, folder: str, filter_raw: str | None) -> list[str]:
    """Files that appeared since the last look and have stopped growing (a download being
    written is waited for). The first look returns nothing."""
    now = list_folder(folder)
    if seen.snapshot is None:
        seen.snapshot = set(now)
        return []
    ready: list[str] = []
    for name in set(now) - seen.snapshot:
        if not wanted_file(name, filter_raw):
            continue
        size = now[name]
        if seen.pending.get(name) == size and size > 0:
            ready.append(name)
            seen.pending.pop(name, None)
        else:
            seen.pending[name] = size
    for name in [n for n in seen.pending if n not in now]:
        seen.pending.pop(name, None)
    # Known from now on: everything but the files still being written.
    seen.snapshot = set(now) - set(seen.pending)
    return sorted(ready)[:MAX_FILES_PER_RUN]


def clip_matches(text: str, kind: str | None) -> bool:
    text = text.strip()
    if len(text) < MIN_CLIP:
        return False
    kind = kind or "any"
    letters = [c for c in text if c.isalpha()]
    arabic = sum(1 for c in letters if 0x0600 <= ord(c) <= 0x06FF)
    if kind == "link":
        return bool(_LINK.match(text))
    if kind == "arabic":
        return bool(letters) and arabic / len(letters) >= 0.5
    if kind == "latin":
        latin = sum(1 for c in letters if c.isascii())
        return bool(letters) and latin / len(letters) >= 0.7 and not _LINK.match(text)
    return True


def read_clipboard() -> str | None:
    """The text on the Windows clipboard, or None (not Windows, no text, busy)."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.GetClipboardData.restype = wintypes.HANDLE
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    cf_unicode = 13
    if not user32.OpenClipboard(None):
        return None
    try:
        handle = user32.GetClipboardData(cf_unicode)
        if not handle:
            return None
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            return None
        try:
            return ctypes.wstring_at(pointer)
        finally:
            kernel32.GlobalUnlock(handle)
    finally:
        user32.CloseClipboard()


def clipboard_number() -> int | None:
    """Windows counts every change to the clipboard; reading the count costs nothing."""
    if sys.platform != "win32":
        return None
    import ctypes

    return int(ctypes.windll.user32.GetClipboardSequenceNumber())


def running_programs() -> set[str]:
    """Names of the programs running now, lower case, without ".exe"."""
    import psutil

    names: set[str] = set()
    for proc in psutil.process_iter(["name"]):
        name = (proc.info.get("name") or "").lower()
        if name:
            names.add(name.removesuffix(".exe"))
    return names


def program_matches(names: set[str], wanted: str) -> bool:
    want = wanted.lower().strip().removesuffix(".exe")
    return bool(want) and any(want == n or want in n for n in names)


def event_text(kind: str, detail: dict[str, Any]) -> str:
    """What happened, added under the trigger's instructions."""
    if kind == "folder":
        files = "\n".join(f"- {p}" for p in detail["files"])
        return f"New files just arrived in {detail['folder']}:\n{files}\nWork on these files."
    if kind == "clipboard":
        return f'The user just copied this text:\n"""\n{detail["text"]}\n"""'
    return f"The program «{detail['program']}» was just opened on this computer."


# ── The loop ───────────────────────────────────────────────────────────────────────────


def _may_start(seen: _Seen, kind: str, now: float) -> bool:
    seen.starts = [s for s in seen.starts if now - s < 3600]
    if len(seen.starts) >= MAX_PER_HOUR:
        return False
    return not seen.starts or now - seen.starts[-1] >= MIN_GAP_SECONDS.get(kind, 10)


async def _start(schedule: Schedule, detail: dict[str, Any]) -> None:
    from rafiq_agent.core.tasks_service import TaskCreateError, create_task

    async with SessionLocal() as session:
        row = await session.get(Schedule, schedule.id)
        if row is None or not row.enabled:
            return
        now = datetime.now(UTC)
        try:
            task = await create_task(
                title=row.title,
                prompt=f"{row.prompt}\n\n{event_text(row.kind, detail)}",
                model_id=row.model_id,
                working_dir=row.working_dir,
                origin={"schedule_id": row.id, "trigger": row.kind},
            )
        except TaskCreateError as exc:
            session.add(ScheduleRun(schedule_id=row.id, trigger=row.kind, error=str(exc), created_at=now))
        else:
            row.last_task_id = task.id
            session.add(ScheduleRun(schedule_id=row.id, task_id=task.id, trigger=row.kind, created_at=now))
        row.last_run_at = now
        await session.commit()


async def tick() -> int:
    """One look at every event trigger; starts the tasks that are due. Returns how many."""
    async with SessionLocal() as session:
        rows = (
            await session.execute(select(Schedule).where(Schedule.enabled.is_(True), Schedule.kind.in_(EVENT_KINDS)))
        ).scalars().all()
    live = {r.id for r in rows}
    for gone in [k for k in _seen if k not in live]:
        _seen.pop(gone, None)
    if not rows:
        return 0

    started = 0
    now = time.monotonic()
    programs: set[str] | None = None
    clip_no = clipboard_number() if any(r.kind == "clipboard" for r in rows) else None
    clip_text: str | None = None
    for row in rows:
        seen = _seen.setdefault(row.id, _Seen())
        detail: dict[str, Any] | None = None
        if row.kind == "folder" and row.watch:
            files = await asyncio.to_thread(new_files, seen, row.watch, row.watch_filter)
            if files:
                detail = {"folder": row.watch, "files": [str(Path(row.watch) / f) for f in files]}
        elif row.kind == "clipboard" and clip_no is not None:
            if seen.snapshot is None:
                seen.snapshot = clip_no
            elif clip_no != seen.snapshot:
                seen.snapshot = clip_no
                if clip_text is None:
                    clip_text = (await asyncio.to_thread(read_clipboard)) or ""
                if clip_matches(clip_text, row.watch_filter):
                    detail = {"text": clip_text.strip()[:MAX_CLIP]}
        elif row.kind == "app" and row.watch:
            if programs is None:
                programs = await asyncio.to_thread(running_programs)
            running = program_matches(programs, row.watch)
            was = seen.snapshot
            seen.snapshot = running
            if was is False and running:
                detail = {"program": row.watch}
        if detail and _may_start(seen, row.kind, now):
            seen.starts.append(now)
            await _start(row, detail)
            started += 1
    return started


async def run_forever() -> None:
    while True:
        try:
            await tick()
        except Exception:  # noqa: BLE001 - one bad look mustn't stop the watching
            log.info("trigger look failed", exc_info=True)
        await asyncio.sleep(TICK_SECONDS)
