from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import SettingsRow

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
    return body
