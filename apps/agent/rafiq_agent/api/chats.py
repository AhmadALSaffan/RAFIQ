"""Chat endpoints.

Routes only: validate input, call `core.chat_service`, shape the response. The turn itself
(context building, the agent loop, the SSE events) lives in the service.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from rafiq_agent.api.deps import require_token
from rafiq_agent.core.chat_service import (
    ChatError,
    ChatTurn,
    provider_for,
    resolve_permission,
    settings_of,
    summarize,
)
from rafiq_agent.core.prompts import DEFAULT_TITLE
from rafiq_agent.core.tasks_service import TaskCreateError, resolve_working_dir
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.chats import (
    ChatCreate,
    ChatDetailOut,
    ChatSummaryOut,
    ChatUpdate,
    MessageCreate,
    SummarizeIn,
    SummarizeOut,
)
from rafiq_agent.storage.db import SessionLocal, get_session
from rafiq_agent.storage.models import Chat, ChatMessage, LlmModel

router = APIRouter(prefix="/chats", tags=["chats"], dependencies=[Depends(require_token)])


def _now() -> datetime:
    return datetime.now(UTC)


def _checked_dir(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        directory = resolve_working_dir(raw)
    except TaskCreateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return str(directory) if directory else None


def _http(error: ChatError) -> HTTPException:
    return HTTPException(status_code=error.status, detail=str(error))


@router.get("", response_model=list[ChatSummaryOut])
async def list_chats(session: AsyncSession = Depends(get_session)) -> list[ChatSummaryOut]:
    counts = (
        select(ChatMessage.chat_id, func.count(ChatMessage.id).label("n"))
        .group_by(ChatMessage.chat_id)
        .subquery()
    )
    rows = await session.execute(
        select(Chat, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.chat_id == Chat.id)
        # Design sessions live on the designs page; they'd only be noise here.
        .where(func.coalesce(Chat.mode, "chat") != "design")
        .order_by(Chat.pinned.desc(), Chat.updated_at.desc())
    )
    out = []
    for chat, count in rows.all():
        summary = ChatSummaryOut.model_validate(chat)
        summary.message_count = count
        out.append(summary)
    return out


@router.post("", response_model=ChatDetailOut, status_code=201)
async def create_chat(body: ChatCreate, session: AsyncSession = Depends(get_session)) -> ChatDetailOut:
    chat = Chat(title=tr(DEFAULT_TITLE), model_id=body.model_id, working_dir=_checked_dir(body.working_dir))
    session.add(chat)
    await session.commit()
    await session.refresh(chat)
    return ChatDetailOut(**ChatSummaryOut.model_validate(chat).model_dump(), messages=[])


@router.get("/{chat_id}", response_model=ChatDetailOut)
async def get_chat(chat_id: str, session: AsyncSession = Depends(get_session)) -> ChatDetailOut:
    result = await session.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="chat not found")
    return ChatDetailOut.model_validate(chat)


@router.patch("/{chat_id}", response_model=ChatSummaryOut)
async def update_chat(
    chat_id: str, body: ChatUpdate, session: AsyncSession = Depends(get_session)
) -> ChatSummaryOut:
    chat = await session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="chat not found")
    if body.title is not None and body.title.strip():
        chat.title = body.title.strip()[:120]
    if body.model_id is not None:
        chat.model_id = body.model_id
    if body.pinned is not None:
        chat.pinned = body.pinned
    if body.working_dir is not None:
        chat.working_dir = _checked_dir(body.working_dir)
    if body.settings is not None:
        chat.settings = body.settings.model_dump()
    await session.commit()
    await session.refresh(chat)
    return ChatSummaryOut.model_validate(chat)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, session: AsyncSession = Depends(get_session)) -> None:
    result = await session.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="chat not found")
    await session.delete(chat)
    await session.commit()


@router.post("/{chat_id}/permissions/{request_id}", status_code=202)
async def resolve_chat_permission(chat_id: str, request_id: str, resolution: str) -> dict[str, bool]:
    if resolution not in ("approved", "denied"):
        raise HTTPException(status_code=400, detail="resolution must be 'approved' or 'denied'")
    return {"resolved": resolve_permission(request_id, resolution)}


@router.post("/{chat_id}/summarize", response_model=SummarizeOut)
async def summarize_chat(chat_id: str, body: SummarizeIn) -> SummarizeOut:
    """Condenses the chat so later turns send a short summary instead of the whole history."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
        )
        chat = result.scalar_one_or_none()
        if not chat:
            raise HTTPException(status_code=404, detail="chat not found")
        model = await session.get(LlmModel, body.model_id or chat.model_id or "")
        if not model:
            raise HTTPException(status_code=400, detail=tr("اختار نموذج أول عشان ألخّص فيه."))

        llm = provider_for(model, settings_of(chat))
        try:
            report = await summarize(chat, list(chat.messages), llm, max(0, body.keep))
        except ChatError as exc:
            raise _http(exc) from exc
        except Exception as exc:  # noqa: BLE001 - provider failures become a readable message
            from rafiq_agent.llm.discovery import friendly_error

            raise HTTPException(status_code=502, detail=friendly_error(exc)) from exc

        chat.updated_at = _now()
        await session.commit()
        return SummarizeOut(summary_until=chat.summary_until or "", **report)


@router.delete("/{chat_id}/messages/{message_id}", status_code=204)
async def delete_message(chat_id: str, message_id: str, session: AsyncSession = Depends(get_session)) -> None:
    """Used by /أعد — drops the last reply before the same prompt is sent again."""
    message = await session.get(ChatMessage, message_id)
    if not message or message.chat_id != chat_id:
        raise HTTPException(status_code=404, detail="message not found")
    await session.delete(message)
    await session.commit()


@router.post("/{chat_id}/messages")
async def send_message(chat_id: str, body: MessageCreate) -> StreamingResponse:
    turn = ChatTurn(chat_id, body.content, body.model_id, body.attachment_ids)
    try:
        await turn.prepare()
    except ChatError as exc:
        raise _http(exc) from exc
    return StreamingResponse(
        turn.stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )
