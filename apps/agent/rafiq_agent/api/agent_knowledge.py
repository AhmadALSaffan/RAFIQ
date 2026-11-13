"""An agent's knowledge base: the folders attached to it, their index, and its citations.

Mounted under /settings (api/settings.py): /settings/knowledge-bases/…. Every route that reads
a passage takes the agent and checks its grant first (core/agent_knowledge.py).
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.core import agent_knowledge, embeddings
from rafiq_agent.core.local import is_local
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import LlmModel

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])


class AttachIn(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


async def _agent(session: AsyncSession, agent_id: str) -> LlmModel:
    agent = await session.get(LlmModel, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    return agent


async def _overview(session: AsyncSession, agent: LlmModel) -> dict:
    from rafiq_agent.core.agent_runtime import load_settings

    settings = await load_settings()
    embedding_agent = None
    if settings.rag_embedding == "agent" and settings.rag_embedding_agent_id:
        embedding_agent = await session.get(LlmModel, settings.rag_embedding_agent_id)
    sources = agent_knowledge.sources_for(agent.id)
    # A folder left "indexing" by a closed app is picked up again.
    for source in sources:
        if source["status"] in ("queued", "indexing") and source["id"] not in agent_knowledge._jobs:
            agent_knowledge.refresh_soon(source["id"])
    return {
        "agent_id": agent.id,
        "sources": sources,
        "formats": sorted(agent_knowledge.EXTENSIONS),
        "index_path": str(agent_knowledge.db_path()),
        "embedding": embeddings.describe(settings, embedding_agent),
        # Retrieved excerpts go to this agent's provider when it writes an answer.
        "chat_provider": agent.provider,
        "chat_local": is_local(agent.provider),
    }


@router.get("/agents/{agent_id}")
async def overview(agent_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    return await _overview(session, await _agent(session, agent_id))


@router.post("/agents/{agent_id}/sources", status_code=201)
async def attach(agent_id: str, body: AttachIn, session: AsyncSession = Depends(get_session)) -> dict:
    agent = await _agent(session, agent_id)
    try:
        await asyncio.to_thread(agent_knowledge.attach, agent.id, body.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await _overview(session, agent)


@router.delete("/agents/{agent_id}/sources/{source_id}")
async def detach(agent_id: str, source_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    agent = await _agent(session, agent_id)
    if not await asyncio.to_thread(agent_knowledge.detach, agent.id, source_id):
        raise HTTPException(status_code=404, detail="this agent doesn't have that folder")
    return await _overview(session, agent)


@router.post("/agents/{agent_id}/sources/{source_id}/refresh", status_code=202)
async def refresh(agent_id: str, source_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    agent = await _agent(session, agent_id)
    if not agent_knowledge.granted(agent.id, source_id):
        raise HTTPException(status_code=404, detail="this agent doesn't have that folder")
    agent_knowledge.refresh_soon(source_id)
    return await _overview(session, agent)


@router.get("/agents/{agent_id}/citations/{citation_id}")
async def citation(agent_id: str, citation_id: str) -> dict:
    """The cited passage with a few lines around it — only for an agent that still has the
    folder. A citation the app can't find here is shown as unverified, never as a link."""
    found = await asyncio.to_thread(agent_knowledge.citation, agent_id, citation_id)
    if found is None:
        raise HTTPException(status_code=404, detail="citation not found for this agent")
    return found


@router.post("/agents/{agent_id}/citations/{citation_id}/open")
async def open_citation(agent_id: str, citation_id: str) -> dict:
    opened = await asyncio.to_thread(agent_knowledge.open_citation, agent_id, citation_id)
    if opened is None:
        raise HTTPException(status_code=404, detail="citation not found for this agent")
    return opened
