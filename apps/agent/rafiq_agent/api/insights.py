"""What the app spent, and a report to send when something goes wrong.

Both read-only. The diagnostics report is built here rather than in the UI so it can be
checked in one place that nothing secret gets in: keys, tokens, account labels and file
contents never appear — only counts, names and settings.
"""

import platform
import sys
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.api.settings import SETTINGS_KEY
from rafiq_agent.llm import usage
from rafiq_agent.schemas.insights import Diagnostics, UsageByModel, UsageDay, UsageSummary
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import Chat, LlmModel, McpServer, Schedule, SettingsRow, Task, UsageRecord

router = APIRouter(tags=["insights"], dependencies=[Depends(require_token)])

VERSION = "0.3.0"


@router.get("/usage", response_model=UsageSummary)
async def usage_summary(
    days: int = Query(default=30, ge=1, le=365), session: AsyncSession = Depends(get_session)
) -> UsageSummary:
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (
        await session.execute(
            select(
                UsageRecord.model_ref,
                UsageRecord.model_name,
                func.sum(UsageRecord.prompt_tokens),
                func.sum(UsageRecord.completion_tokens),
                func.sum(UsageRecord.cached_tokens),
                func.sum(UsageRecord.cost_usd),
                func.count(),
            )
            .where(UsageRecord.created_at >= since)
            .group_by(UsageRecord.model_ref, UsageRecord.model_name)
        )
    ).all()
    names = dict(
        (await session.execute(select(LlmModel.id, LlmModel.name))).all()  # the user's own name for each agent
    )
    by_model = [
        UsageByModel(
            model_ref=ref,
            name=names.get(ref or "", model_name),
            calls=int(calls),
            prompt_tokens=int(prompt or 0),
            completion_tokens=int(completion or 0),
            cached_tokens=int(cached or 0),
            cost_usd=round(float(cost or 0.0), 6),
        )
        for ref, model_name, prompt, completion, cached, cost, calls in rows
    ]
    by_model.sort(key=lambda m: m.cost_usd, reverse=True)

    day_rows = (
        await session.execute(
            select(
                func.strftime("%Y-%m-%d", UsageRecord.created_at),
                func.sum(UsageRecord.cost_usd),
                func.sum(UsageRecord.prompt_tokens + UsageRecord.completion_tokens),
            )
            .where(UsageRecord.created_at >= since)
            .group_by(func.strftime("%Y-%m-%d", UsageRecord.created_at))
            .order_by(func.strftime("%Y-%m-%d", UsageRecord.created_at))
        )
    ).all()
    totals = usage.totals()
    return UsageSummary(
        days=days,
        today_usd=totals["today_usd"],
        month_usd=totals["month_usd"],
        daily_budget_usd=totals["daily_budget_usd"],
        monthly_budget_usd=totals["monthly_budget_usd"],
        total_usd=round(sum(m.cost_usd for m in by_model), 6),
        total_tokens=sum(m.prompt_tokens + m.completion_tokens for m in by_model),
        by_model=by_model,
        by_day=[
            UsageDay(date=day, cost_usd=round(float(cost or 0.0), 6), tokens=int(tokens or 0))
            for day, cost, tokens in day_rows
        ],
    )


@router.get("/diagnostics", response_model=Diagnostics)
async def diagnostics(session: AsyncSession = Depends(get_session)) -> Diagnostics:
    """A report the user can save and share — deliberately free of anything secret."""
    row = await session.get(SettingsRow, SETTINGS_KEY)
    settings = AppSettings.model_validate(row.value) if row else AppSettings()
    models = (await session.execute(select(LlmModel))).scalars().all()
    servers = (await session.execute(select(McpServer))).scalars().all()

    async def count(model: type) -> int:
        return int((await session.execute(select(func.count()).select_from(model))).scalar_one())

    failed = (
        (
            await session.execute(
                # Titles are the user's own words, so the report carries only ids and times.
                select(Task.id, Task.updated_at)
                .where(Task.status == "failed")
                .order_by(Task.updated_at.desc())
                .limit(10)
            )
        )
        .mappings()
        .all()
    )
    return Diagnostics(
        generated_at=datetime.now(UTC),
        version=VERSION,
        python=sys.version.split()[0],
        platform=f"{platform.system()} {platform.release()}",
        frozen=getattr(sys, "frozen", False),
        settings=settings.model_dump(),
        models=[
            {
                "provider": m.provider,
                "model_id": m.model_id,
                "auth_method": m.auth_method,
                "has_key": bool(m.api_key_ref),
                "has_base_url": bool(m.base_url),
                "options": sorted((m.options or {}).keys()),
                "verify_ok": m.verify_ok,
                "verify_error": m.verify_error,
                "supports_tools": m.supports_tools,
                "has_fallback": bool(m.fallback_model_id),
            }
            for m in models
        ],
        mcp_servers=[{"name": s.name, "transport": s.transport, "enabled": s.enabled} for s in servers],
        counts={
            "chats": await count(Chat),
            "tasks": await count(Task),
            "schedules": await count(Schedule),
            "models": len(models),
        },
        recent_failures=[
            {"id": f["id"], "at": f["updated_at"].isoformat() if f["updated_at"] else None}
            for f in failed
        ],
        usage=usage.totals(),
    )
