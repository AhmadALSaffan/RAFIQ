"""Chat endpoints.

Routes only: validate input, call `core.chat_service`, shape the response. The turn itself
(context building, the agent loop, the SSE events) lives in the service.
"""

from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from rafiq_agent.api.deps import require_token
from rafiq_agent.core.chat_service import (
    ChatError,
    ChatTurn,
    active_turn,
    fallback_of,
    provider_for,
    resolve_permission,
    settings_of,
    stop_turn,
    summarize,
)
from rafiq_agent.core.agent_runtime import load_settings
from rafiq_agent.core.export_html import render as render_html
from rafiq_agent.core.prompts import DEFAULT_TITLE
from rafiq_agent.core.tasks_service import TaskCreateError, resolve_working_dir
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.chats import (
    ChatCreate,
    ChatDetailOut,
    ChatFork,
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
async def list_chats(
    workspace_id: str | None = Query(None), session: AsyncSession = Depends(get_session)
) -> list[ChatSummaryOut]:
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
        .where(Chat.workspace_id == workspace_id if workspace_id else True)
        .order_by(Chat.pinned.desc(), Chat.updated_at.desc())
    )
    out = []
    for chat, count in rows.all():
        summary = ChatSummaryOut.model_validate(chat)
        summary.message_count = count
        summary.streaming = active_turn(chat.id) is not None
        out.append(summary)
    return out


@router.post("", response_model=ChatDetailOut, status_code=201)
async def create_chat(body: ChatCreate, session: AsyncSession = Depends(get_session)) -> ChatDetailOut:
    chat = Chat(
        title=tr(DEFAULT_TITLE),
        model_id=body.model_id,
        working_dir=_checked_dir(body.working_dir),
        workspace_id=body.workspace_id or None,
        # Only the one field: everything else stays on its schema default, so a default we
        # improve later still reaches chats created today.
        settings={"saver": (await load_settings()).token_saver},
    )
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
    out = ChatDetailOut.model_validate(chat)
    out.streaming = active_turn(chat_id) is not None
    return out


@router.get("/{chat_id}/export")
async def export_chat(
    chat_id: str, format: str = Query("html"), session: AsyncSession = Depends(get_session)
) -> Response:
    """The whole chat as one file to share: HTML (self-contained, both themes) or Markdown."""
    result = await session.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="chat not found")
    models = {m.id: m.name for m in (await session.execute(select(LlmModel))).scalars().all()}
    messages = [
        {
            "role": m.role,
            "content": m.content,
            "parts": m.parts,
            "created_at": m.created_at,
            "model_id": m.model_id,
        }
        for m in chat.messages
    ]
    # Headers are latin-1: an Arabic title goes in the RFC 5987 form, with an ASCII fallback.
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in chat.title)[:60].strip() or "chat"
    ascii_name = safe.encode("ascii", "ignore").decode().strip() or "chat"
    encoded = quote(safe)
    if format == "md":
        lines = [f"# {chat.title}", ""]
        for m in messages:
            who = f"**{tr('أنا')}**" if m["role"] == "user" else f"**{models.get(m['model_id'] or '', tr('رفيق'))}**"
            lines += [who, "", m["content"] or "", ""]
        body = "\n".join(lines)
        return Response(
            body,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}.md\"; filename*=UTF-8''{encoded}.md"},
        )
    html = render_html(chat.title, messages, models)
    return Response(
        html,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}.html\"; filename*=UTF-8''{encoded}.html"},
    )


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
    stop_turn(chat_id)
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

        llm = provider_for(model, settings_of(chat), await fallback_of(session, model))
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


@router.post("/{chat_id}/messages/{message_id}/truncate", response_model=ChatDetailOut)
async def truncate_from(
    chat_id: str, message_id: str, session: AsyncSession = Depends(get_session)
) -> ChatDetailOut:
    """Drops this message and everything after it — how editing a question works: the
    chat goes back to just before it, then the new wording is sent."""
    message = await session.get(ChatMessage, message_id)
    if not message or message.chat_id != chat_id:
        raise HTTPException(status_code=404, detail="message not found")
    stop_turn(chat_id)
    result = await session.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="chat not found")
    cutoff = message.created_at
    for m in list(chat.messages):
        if m.created_at > cutoff or m.id == message_id:
            await session.delete(m)
    await session.commit()
    await session.refresh(chat)
    return await get_chat(chat_id, session)


@router.post("/{chat_id}/fork", response_model=ChatDetailOut, status_code=201)
async def fork_chat(
    chat_id: str, body: ChatFork, session: AsyncSession = Depends(get_session)
) -> ChatDetailOut:
    """Copies the chat up to a message into a new one, so a different direction can be
    tried without losing this one."""
    result = await session.execute(
        select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.messages))
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="chat not found")
    history = sorted(chat.messages, key=lambda m: m.created_at)
    if body.until_message_id:
        index = next((i for i, m in enumerate(history) if m.id == body.until_message_id), None)
        if index is None:
            raise HTTPException(status_code=404, detail="message not found")
        history = history[: index + 1]

    fork = Chat(
        title=tr("نسخة: {0}", chat.title)[:120],
        model_id=chat.model_id,
        working_dir=chat.working_dir,
        settings=chat.settings,
        mode=chat.mode,
        # The summary only describes turns that were kept whole; a partial copy re-summarises.
        summary=chat.summary if len(history) == len(chat.messages) else None,
        summary_until=chat.summary_until if len(history) == len(chat.messages) else None,
    )
    session.add(fork)
    await session.flush()
    for m in history:
        session.add(
            ChatMessage(
                chat_id=fork.id,
                role=m.role,
                content=m.content,
                reasoning=m.reasoning,
                model_id=m.model_id,
                parts=m.parts,
                attachments=m.attachments,
                created_at=m.created_at,
            )
        )
    await session.commit()
    return await get_chat(fork.id, session)


def _sse(turn: ChatTurn) -> StreamingResponse:
    return StreamingResponse(
        turn.subscribe(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )


@router.post("/{chat_id}/messages")
async def send_message(chat_id: str, body: MessageCreate) -> StreamingResponse:
    """Starts a reply and streams it. The reply keeps going if the stream is closed."""
    turn = ChatTurn(chat_id, body.content, body.model_id, body.attachment_ids)
    try:
        await turn.prepare()
        await turn.start()
    except ChatError as exc:
        raise _http(exc) from exc
    return _sse(turn)


@router.get("/{chat_id}/stream", response_model=None)
async def reattach(chat_id: str) -> StreamingResponse | Response:
    """The reply being written in this chat, from its first event; 204 when there is none."""
    turn = active_turn(chat_id)
    if turn is None:
        return Response(status_code=204)
    return _sse(turn)


@router.post("/{chat_id}/stop", status_code=202)
async def stop_reply(chat_id: str) -> dict[str, bool]:
    """Stops the reply being written; what it produced so far is kept."""
    return {"stopped": stop_turn(chat_id)}
