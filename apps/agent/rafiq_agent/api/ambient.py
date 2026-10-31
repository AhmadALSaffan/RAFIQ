"""The council, the morning radio, and the offers Rafiq makes from what it noticed."""

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core import compare, council, patterns, radio
from rafiq_agent.core.agent_runtime import load_settings
from rafiq_agent.i18n import tr
from rafiq_agent.llm import usage
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import RadioEpisode, Suggestion

router = APIRouter(tags=["ambient"], dependencies=[Depends(require_token)])


# ── The council ────────────────────────────────────────────────────────────────────────


class CouncilIn(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    model_ids: list[str] = Field(min_length=1, max_length=8)
    workspace_id: str | None = None


@router.post("/council")
async def ask_council(body: CouncilIn) -> StreamingResponse:
    seats = await council.load_seats(body.model_ids)
    if len(seats) < council.MIN_SEATS:
        raise HTTPException(status_code=400, detail=tr("المجلس بده نموذجين مختلفين على الأقل."))
    try:
        usage.check_budget()
    except usage.BudgetExceeded as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    async def events() -> AsyncIterator[str]:
        async for event in council.run(body.question, seats, body.workspace_id):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


# ── Comparing two models ───────────────────────────────────────────────────────────────


class CompareIn(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    model_ids: list[str] = Field(min_length=2, max_length=2)


@router.post("/compare")
async def compare_models(body: CompareIn) -> StreamingResponse:
    seats = await council.load_seats(body.model_ids)
    if len(seats) < 2:
        raise HTTPException(status_code=400, detail=tr("اختار نموذجين مختلفين شغّالين."))
    try:
        usage.check_budget()
    except usage.BudgetExceeded as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc

    async def events() -> AsyncIterator[str]:
        async for event in compare.run(body.question, seats):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


# ── The radio ──────────────────────────────────────────────────────────────────────────


class EpisodeOut(BaseModel):
    id: str
    day: str
    script: str
    error: str | None = None
    heard_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RadioOut(BaseModel):
    enabled: bool
    episode: EpisodeOut | None = None


async def _today(session: AsyncSession) -> RadioEpisode | None:
    return (await session.execute(select(RadioEpisode).where(RadioEpisode.day == radio.today_key()))).scalar_one_or_none()


@router.get("/radio/today", response_model=RadioOut)
async def radio_today(session: AsyncSession = Depends(get_session)) -> RadioOut:
    settings = await load_settings()
    row = await _today(session)
    return RadioOut(enabled=settings.radio_enabled, episode=EpisodeOut.model_validate(row) if row else None)


@router.post("/radio/make", response_model=EpisodeOut)
async def radio_make() -> EpisodeOut:
    """Writes today's episode now, replacing one that's there."""
    return EpisodeOut.model_validate(await radio.make_episode(await load_settings(), replace=True))


@router.post("/radio/{episode_id}/heard", status_code=204)
async def radio_heard(episode_id: str, session: AsyncSession = Depends(get_session)) -> None:
    row = await session.get(RadioEpisode, episode_id)
    if row is not None:
        row.heard_at = datetime.now(UTC)
        await session.commit()


@router.post("/radio/{episode_id}/chat")
async def radio_chat(episode_id: str, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """The episode as a chat, to ask about it."""
    row = await session.get(RadioEpisode, episode_id)
    if row is None or not row.script:
        raise HTTPException(status_code=404, detail="episode not found")
    return {"chat_id": await radio.episode_chat(row)}


# ── What Rafiq noticed ─────────────────────────────────────────────────────────────────


class SuggestionOut(BaseModel):
    id: str
    kind: str
    title: str
    draft: dict
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/suggestions", response_model=list[SuggestionOut])
async def list_suggestions(session: AsyncSession = Depends(get_session)) -> list[SuggestionOut]:
    if not (await load_settings()).notice_patterns:
        return []
    rows = await session.execute(select(Suggestion).where(Suggestion.status == "new").order_by(Suggestion.created_at.desc()).limit(10))
    return [SuggestionOut.model_validate(r) for r in rows.scalars().all()]


@router.post("/suggestions/refresh")
async def refresh_suggestions() -> dict[str, int]:
    if not (await load_settings()).notice_patterns:
        return {"added": 0}
    return {"added": await patterns.refresh()}


class AcceptIn(BaseModel):
    model_id: str | None = None


@router.post("/suggestions/{suggestion_id}/accept")
async def accept_suggestion(suggestion_id: str, body: AcceptIn) -> dict[str, str]:
    made = await patterns.accept(suggestion_id, body.model_id)
    if made is None:
        raise HTTPException(status_code=400, detail=tr("ضيف نموذج أول، عشان رفيق يقدر يعملها."))
    return made


@router.post("/suggestions/{suggestion_id}/dismiss", status_code=204)
async def dismiss_suggestion(suggestion_id: str) -> None:
    await patterns.dismiss(suggestion_id)
