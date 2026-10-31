import asyncio
import contextlib

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core import file_index, knowledge
from rafiq_agent.core.manager import manager
from rafiq_agent.llm import usage
from rafiq_agent.llm.resilience import set_concurrency
from rafiq_agent.schemas.automation import WebSearchKeyIn, WebSearchKeys
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import SettingsRow
from rafiq_agent.storage.secrets import delete_named_secret, get_named_secret, set_named_secret
from rafiq_agent.tools.web import search_key_name

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_token)])

SETTINGS_KEY = "app"


@router.get("", response_model=AppSettings)
async def get_settings(session: AsyncSession = Depends(get_session)) -> AppSettings:
    row = await session.get(SettingsRow, SETTINGS_KEY)
    if not row:
        return AppSettings()
    return AppSettings.model_validate(row.value)


@router.put("", response_model=AppSettings)
async def update_settings(body: AppSettings, session: AsyncSession = Depends(get_session)) -> AppSettings:
    row = await session.get(SettingsRow, SETTINGS_KEY)
    # The brand kit is saved (and checked) through /motion/kit only; a settings page holding
    # an older copy mustn't put it back.
    body.brand_kit = (row.value or {}).get("brand_kit") if row else None
    # Pins likewise change through /notes/pin only.
    body.notes_pinned = list((row.value or {}).get("notes_pinned") or []) if row else []
    before = AppSettings.model_validate(row.value) if row else AppSettings()
    if row:
        row.value = body.model_dump()
    else:
        row = SettingsRow(key=SETTINGS_KEY, value=body.model_dump())
        session.add(row)
    await session.commit()
    set_concurrency(body.provider_concurrency)
    usage.set_budgets(body.daily_budget_usd, body.monthly_budget_usd)
    manager.reschedule()  # a higher parallel limit lets waiting tasks start right away
    if (before.file_search_enabled, before.file_search_dirs) != (body.file_search_enabled, body.file_search_dirs):
        file_index.rescan_soon()
    if before.knowledge_dirs != body.knowledge_dirs:
        knowledge.rescan_soon()
    return body


@router.get("/knowledge")
async def knowledge_status() -> dict:
    """How far the knowledge folder has been read, and what couldn't be."""
    return knowledge.status()


@router.post("/knowledge/rescan", status_code=202)
async def knowledge_rescan() -> dict:
    knowledge.rescan_soon()
    return {"ok": True}


@router.delete("/knowledge", status_code=204)
async def knowledge_clear() -> None:
    """Forgets what was read (it's read again on the next look while a folder is chosen)."""
    await asyncio.to_thread(knowledge.clear)


@router.get("/file-search")
async def file_search_status() -> dict:
    """How far the index of the user's files has got, and which folders it covers."""
    from rafiq_agent.core.agent_runtime import load_settings

    settings = await load_settings()
    return {**file_index.status(), "folders": file_index.folders(settings.file_search_dirs)}


@router.post("/file-search/rescan", status_code=202)
async def file_search_rescan() -> dict:
    file_index.rescan_soon()
    return {"ok": True}


@router.delete("/file-search", status_code=204)
async def file_search_clear() -> None:
    """Empties the index (it fills in again on the next look while search stays on)."""
    await asyncio.to_thread(file_index.clear)


@router.get("/web-search", response_model=WebSearchKeys)
async def web_search_keys() -> WebSearchKeys:
    """Which search services have a key saved — never the keys themselves."""
    return WebSearchKeys(
        brave=bool(get_named_secret(search_key_name("brave"))),
        tavily=bool(get_named_secret(search_key_name("tavily"))),
    )


@router.put("/web-search", response_model=WebSearchKeys)
async def save_web_search_key(body: WebSearchKeyIn) -> WebSearchKeys:
    """Saves a search API key in the keychain (an empty key removes it)."""
    name = search_key_name(body.provider)
    if body.key.strip():
        set_named_secret(name, body.key.strip())
    else:
        with contextlib.suppress(Exception):
            delete_named_secret(name)
    return await web_search_keys()
