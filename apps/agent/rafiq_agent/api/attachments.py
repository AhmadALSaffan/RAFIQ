from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.attachments import AttachmentError, meta, save_upload
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Attachment

router = APIRouter(prefix="/attachments", tags=["attachments"])


@router.post("", dependencies=[Depends(require_token)], status_code=201)
async def upload(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    try:
        attachment = await save_upload(file.filename or "file", file.content_type, data)
    except AttachmentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return meta(attachment)


@router.get("/{attachment_id}/raw")
async def raw(attachment_id: str, token: str = Query(...)) -> FileResponse:
    # <img src> can't carry an Authorization header, so previews authenticate via ?token=.
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")
    async with SessionLocal() as session:
        attachment = await session.get(Attachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(attachment.path, media_type=attachment.mime, filename=attachment.name)
