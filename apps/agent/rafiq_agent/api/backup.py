"""Backing up and restoring Rafiq's data.

The app picks a path in its own dialog and hands it here, so a backup never travels through
the window as bytes; the download and upload routes are there for the browser build and for
scripts.
"""

import asyncio
import os
import tempfile
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from starlette.background import BackgroundTask

from rafiq_agent.api.deps import require_token
from rafiq_agent.api.insights import VERSION
from rafiq_agent.core import backup
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.backup import BackupManifest, BackupPath, BackupSaved, RestoreOut
from rafiq_agent.storage.secrets import get_api_key

router = APIRouter(prefix="/backup", tags=["backup"], dependencies=[Depends(require_token)])

# One restore at a time; a second click while the first runs waits for it, then finds
# nothing left to do but its own.
_restoring = asyncio.Lock()


def _error(exc: backup.BackupError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _temp_zip(prefix: str) -> Path:
    """An empty temporary .zip path, closed, for the caller to fill and remove."""
    fd, name = tempfile.mkstemp(prefix=prefix, suffix=".zip")
    os.close(fd)
    return Path(name)


def _existing(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_file():
        raise HTTPException(status_code=404, detail=tr("ما لقيت الملف."))
    return path


@router.get("")
async def download() -> FileResponse:
    """The backup as a download (the browser build; the app saves to a path instead)."""
    path = _temp_zip("rafiq-backup-")
    backup.write_backup(path, VERSION)
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"rafiq-backup-{date.today().isoformat()}.zip",
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.post("/save", response_model=BackupSaved)
async def save(body: BackupPath) -> BackupSaved:
    target = Path(body.path).expanduser()
    if target.suffix.lower() != ".zip":
        target = target.with_suffix(".zip")
    try:
        manifest = backup.write_backup(target, VERSION)
    except OSError as exc:
        raise HTTPException(status_code=400, detail=tr("ما قدرت أكتب الملف: {0}", exc.strerror or str(exc))) from exc
    return BackupSaved(path=str(target), manifest=BackupManifest.model_validate(manifest))


@router.post("/inspect", response_model=BackupManifest)
async def inspect(body: BackupPath) -> BackupManifest:
    """What a backup holds — shown before the user agrees to replace everything with it."""
    try:
        return BackupManifest.model_validate(backup.read_manifest(_existing(body.path)))
    except backup.BackupError as exc:
        raise _error(exc) from exc


@router.post("/restore-file", response_model=RestoreOut)
async def restore_file(body: BackupPath) -> RestoreOut:
    return await _restore(_existing(body.path))


@router.post("/restore", response_model=RestoreOut)
async def restore_upload(file: UploadFile) -> RestoreOut:
    """The browser build's way in: the backup uploaded as a file."""
    path = _temp_zip("rafiq-restore-")
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
        return await _restore(path)
    finally:
        path.unlink(missing_ok=True)


def _busy() -> bool:
    from rafiq_agent.core.chat_service import turns_running
    from rafiq_agent.core.manager import manager

    return turns_running() or manager.busy()


async def _missing_secrets() -> int:
    """References in the restored database that this computer's credential store can't
    answer — what the user has to enter again."""
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import AuthAccount, IntegrationAccount, LlmModel

    refs: list[str] = []
    async with SessionLocal() as session:
        refs += [m.api_key_ref for m in (await session.execute(select(LlmModel))).scalars() if m.api_key_ref]
        refs += [i.secret_ref for i in (await session.execute(select(IntegrationAccount))).scalars() if i.secret_ref]
        refs += [a.secret_ref for a in (await session.execute(select(AuthAccount))).scalars() if a.secret_ref]
    return sum(1 for ref in refs if not get_api_key(ref))


async def _restore(archive: Path) -> RestoreOut:
    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.core.manager import manager
    from rafiq_agent.llm import usage
    from rafiq_agent.llm.resilience import set_concurrency
    from rafiq_agent.mcp_bridge import MANAGER as MCP
    from rafiq_agent.storage.db import engine, init_db

    if _busy():
        raise HTTPException(status_code=409, detail=tr("في ردود أو مهام شغّالة — وقّفها أو استنّاها تخلص، وبعدين استرجع."))
    try:
        backup.read_manifest(archive)  # refuse a bad file before anything is touched
    except backup.BackupError as exc:
        raise _error(exc) from exc

    async with _restoring:
        await usage.drain()  # the last calls' cost belongs to the data being replaced
        await MCP.shutdown()  # the restored server list connects on its own
        await engine.dispose()  # no pooled connection holds the old database open
        # Run on the event loop on purpose: nothing else can reach the database while the
        # files change underneath it.
        try:
            result = backup.restore_backup(archive, VERSION)
        except backup.BackupError as exc:
            raise _error(exc) from exc

        await init_db()  # a backup from an older Rafiq gains the columns added since
        settings = await load_settings()
        set_concurrency(settings.provider_concurrency)
        usage.set_budgets(settings.daily_budget_usd, settings.monthly_budget_usd)
        await usage.load_totals()
        await manager.recover()  # queued tasks in the backup go back in line
        MCP.warm()

    return RestoreOut(
        manifest=BackupManifest.model_validate(result["manifest"]),
        safety_copy=result["safety_copy"],
        missing_secrets=await _missing_secrets(),
    )
