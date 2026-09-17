"""What Rafiq remembers: list, add by hand, switch off, forget."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core.memory import MAX_TEXT, remember
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import Memory

router = APIRouter(prefix="/memories", tags=["memory"], dependencies=[Depends(require_token)])


class MemoryIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    kind: str = "fact"


class MemoryUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=MAX_TEXT)
    kind: str | None = None
    enabled: bool | None = None


class MemoryOut(BaseModel):
    id: str
    text: str
    kind: str
    source_chat_id: str | None
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[MemoryOut])
async def list_memories(session: AsyncSession = Depends(get_session)) -> list[MemoryOut]:
    rows = await session.execute(select(Memory).order_by(Memory.created_at.desc()))
    return [MemoryOut.model_validate(m) for m in rows.scalars().all()]


@router.post("", response_model=MemoryOut, status_code=201)
async def add_memory(body: MemoryIn) -> MemoryOut:
    return MemoryOut.model_validate(await remember(body.text, body.kind))


@router.patch("/{memory_id}", response_model=MemoryOut)
async def update_memory(memory_id: str, body: MemoryUpdate, session: AsyncSession = Depends(get_session)) -> MemoryOut:
    row = await session.get(Memory, memory_id)
    if not row:
        raise HTTPException(status_code=404, detail="memory not found")
    if body.text is not None:
        row.text = " ".join(body.text.split())
    if body.kind in ("preference", "project", "fact"):
        row.kind = body.kind
    if body.enabled is not None:
        row.enabled = body.enabled
    await session.commit()
    await session.refresh(row)
    return MemoryOut.model_validate(row)


@router.delete("/{memory_id}", status_code=204)
async def delete_memory(memory_id: str, session: AsyncSession = Depends(get_session)) -> None:
    row = await session.get(Memory, memory_id)
    if row:
        await session.delete(row)
        await session.commit()


@router.delete("", status_code=204)
async def forget_everything(session: AsyncSession = Depends(get_session)) -> None:
    for row in (await session.execute(select(Memory))).scalars().all():
        await session.delete(row)
    await session.commit()
