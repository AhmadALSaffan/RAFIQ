import contextlib

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
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
    if row:
        row.value = body.model_dump()
    else:
        row = SettingsRow(key=SETTINGS_KEY, value=body.model_dump())
        session.add(row)
    await session.commit()
    set_concurrency(body.provider_concurrency)
    usage.set_budgets(body.daily_budget_usd, body.monthly_budget_usd)
    manager.reschedule()  # a higher parallel limit lets waiting tasks start right away
    return body


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
