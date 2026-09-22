"""One file with everything that is yours in Rafiq, and the way back from it.

A backup is a zip: the database (chats, tasks, settings, models, memory, usage), the skills
you installed, and the files you attached to chats — plus a small manifest saying what it
is and what's in it.

What it never holds is a secret. API keys, account tokens and MCP credentials live in the
Windows credential store and the database only keeps references to them, so a backup taken
here and restored on another computer brings every model and server back without their
keys; they're entered once more there. The browser profile, the Copilot sessions and the
agent's own port and token stay behind for the same reason.

Restoring replaces what is there now, so it first writes a backup of what is there now.
"""

from __future__ import annotations

import contextlib
import json
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from rafiq_agent.config import DATA_DIR, DB_PATH
from rafiq_agent.i18n import tr

APP = "rafiq"
FORMAT = 1
DB_NAME = "rafiq.db"
MANIFEST = "manifest.json"
# The folders that travel with the database. Everything else in the data folder is either
# rebuilt on its own (logs, worktrees) or a secret (browser profile, Copilot sessions).
FOLDERS = ("skills", "attachments")
# A backup that unpacks to more than this is refused before anything is written.
MAX_UNPACKED = 4 * 1024**3
# Tables a Rafiq database always has; a file without them isn't one.
REQUIRED_TABLES = {"chats", "chat_messages", "settings", "llm_models"}
SAFETY_DIR = DATA_DIR / "backups"
SAFETY_KEEP = 5


class BackupError(Exception):
    """A backup that can't be read or restored, in words the user can act on."""


def _snapshot(dest: Path) -> None:
    """A consistent copy of the live database. SQLite's own backup API, not a file copy,
    so a write landing mid-copy can't leave half a page behind."""
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(dest)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()


def _counts(db: Path) -> dict[str, int]:
    """How many of each thing the database holds — what the manifest, and the person about
    to restore it, want to know."""
    tables = {"chats": "chats", "messages": "chat_messages", "tasks": "tasks", "models": "llm_models", "memories": "memories"}
    out: dict[str, int] = {}
    con = sqlite3.connect(db)
    try:
        present = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for label, table in tables.items():
            out[label] = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] if table in present else 0
    finally:
        con.close()
    return out


def _files(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*") if p.is_file()) if folder.is_dir() else []


def write_backup(target: Path, version: str) -> dict[str, Any]:
    """Write a backup of this Rafiq to `target` (a .zip). Returns its manifest."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rafiq-backup-") as tmp:
        db = Path(tmp) / DB_NAME
        _snapshot(db)
        counts = _counts(db)
        folders = {name: _files(DATA_DIR / name) for name in FOLDERS}
        counts["skills"] = len({p.relative_to(DATA_DIR / "skills").parts[0] for p in folders["skills"]})
        counts["attachments"] = len(folders["attachments"])
        manifest = {
            "app": APP,
            "format": FORMAT,
            "version": version,
            "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "counts": counts,
        }
        # Written beside the target and moved into place, so a failed write never leaves a
        # half-finished zip where the user expects a backup.
        partial = target.with_name(target.name + ".partial")
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2))
            zf.write(db, DB_NAME)
            for name, paths in folders.items():
                for path in paths:
                    zf.write(path, PurePosixPath(name, *path.relative_to(DATA_DIR / name).parts).as_posix())
        partial.replace(target)
    return manifest


# ── Reading one back ──────────────────────────────────────────────────────────


def _safe_member(name: str) -> bool:
    """Only the manifest, the database, and files under the known folders — nothing that
    climbs out of the data folder or lands somewhere absolute."""
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        return False
    if name in (MANIFEST, DB_NAME):
        return True
    return len(path.parts) >= 2 and path.parts[0] in FOLDERS


def read_manifest(archive: Path) -> dict[str, Any]:
    """The manifest of a backup, after checking it is one this Rafiq can restore."""
    try:
        zf = zipfile.ZipFile(archive)
    except (zipfile.BadZipFile, OSError) as exc:
        raise BackupError(tr("هالملف مش نسخة احتياطية من رفيق.")) from exc
    with zf:
        names = zf.namelist()
        if MANIFEST not in names or DB_NAME not in names:
            raise BackupError(tr("هالملف مش نسخة احتياطية من رفيق."))
        try:
            manifest = json.loads(zf.read(MANIFEST).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise BackupError(tr("هالملف مش نسخة احتياطية من رفيق.")) from exc
        if not isinstance(manifest, dict) or manifest.get("app") != APP:
            raise BackupError(tr("هالملف مش نسخة احتياطية من رفيق."))
        if not isinstance(manifest.get("format"), int) or manifest["format"] > FORMAT:
            raise BackupError(tr("هالنسخة من إصدار أحدث من رفيق — حدّث التطبيق أول وبعدين استرجعها."))
        if any(not _safe_member(n) for n in names if not n.endswith("/")):
            raise BackupError(tr("النسخة فيها ملفات بمسارات مش مسموحة، فما استرجعتها."))
        if sum(i.file_size for i in zf.infolist()) > MAX_UNPACKED:
            raise BackupError(tr("النسخة أكبر من المسموح بعد فكّها، فما استرجعتها."))
    return manifest


def _check_database(db: Path) -> None:
    try:
        con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
        try:
            if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise BackupError(tr("قاعدة البيانات بالنسخة تالفة، فما استرجعتها."))
            tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            con.close()
    except sqlite3.DatabaseError as exc:
        raise BackupError(tr("قاعدة البيانات بالنسخة تالفة، فما استرجعتها.")) from exc
    if not tables >= REQUIRED_TABLES:
        raise BackupError(tr("هالملف مش نسخة احتياطية من رفيق."))


def _keep_latest(folder: Path, keep: int) -> None:
    olds = sorted(folder.glob("before-restore-*.zip"))
    for old in olds[: max(0, len(olds) - keep)]:
        with contextlib.suppress(OSError):
            old.unlink()


def safety_copy(version: str) -> Path:
    """A backup of the way things are right now, kept in the data folder before a restore
    replaces them. The last few are kept; older ones are removed."""
    SAFETY_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    path = SAFETY_DIR / f"before-restore-{stamp}.zip"
    write_backup(path, version)
    _keep_latest(SAFETY_DIR, SAFETY_KEEP)
    return path


def _swap_folder(staged: Path, live: Path) -> None:
    """Put `staged` where `live` is. The old folder is moved aside first and removed only
    once the new one is in place."""
    aside = live.with_name(live.name + ".old")
    if aside.exists():
        shutil.rmtree(aside, ignore_errors=True)
    if live.exists():
        live.rename(aside)
    if staged.exists():
        staged.rename(live)
    else:
        live.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(aside, ignore_errors=True)


def restore_backup(archive: Path, version: str) -> dict[str, Any]:
    """Replace this Rafiq's data with the backup's. The caller has made sure nothing is
    running and closed the database's pooled connections; it reopens and migrates after.

    Returns the backup's manifest and where the safety copy of the old data went.
    """
    manifest = read_manifest(archive)
    with tempfile.TemporaryDirectory(prefix="rafiq-restore-", dir=DATA_DIR) as tmp:
        staging = Path(tmp)
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                dest = staging.joinpath(*PurePosixPath(info.filename).parts)
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out)
        _check_database(staging / DB_NAME)

        safety = safety_copy(version)

        # The database: copied into the live file through SQLite's backup API, so the file
        # the app has open is the one that changes — no rename under an open handle.
        src = sqlite3.connect(staging / DB_NAME)
        dst = sqlite3.connect(DB_PATH)
        try:
            with dst:
                src.backup(dst)
        finally:
            dst.close()
            src.close()

        for name in FOLDERS:
            _swap_folder(staging / name, DATA_DIR / name)

    return {"manifest": manifest, "safety_copy": str(safety)}
