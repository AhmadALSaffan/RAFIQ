"""What the app spent (and every call behind it, as a CSV), a report to send when something
goes wrong, and the logs.

All read-only. The diagnostics report is built here rather than in the UI so it can be
checked in one place that nothing secret gets in: keys, tokens, account labels and file
contents never appear — only counts, names and settings. The logs go through the same
door: every line is scrubbed of secrets before it leaves (core/logs.py).
"""

import csv
import io
import platform
import sys
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.api.settings import SETTINGS_KEY
from rafiq_agent.core import logs
from rafiq_agent.i18n import tr
from rafiq_agent.llm import usage
from rafiq_agent.schemas.insights import (
    Diagnostics,
    LogInfo,
    LogOut,
    UsageByModel,
    UsageByWorkspace,
    UsageDay,
    UsageSource,
    UsageSummary,
)
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import (
    AuthAccount,
    Chat,
    IntegrationAccount,
    LlmModel,
    McpServer,
    Schedule,
    SettingsRow,
    Task,
    UsageRecord,
    Workspace,
)

router = APIRouter(tags=["insights"], dependencies=[Depends(require_token)])

VERSION = "0.5.12"


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
        by_workspace=[
            UsageByWorkspace(
                id=ws.id, name=ws.name, color=ws.color,
                today_usd=usage.workspace_today(ws.id), daily_budget_usd=ws.daily_budget_usd,
            )
            for ws in (await session.execute(select(Workspace).order_by(Workspace.created_at))).scalars()
        ],
    )


# ── Every call, for a spreadsheet ─────────────────────────────────────────────────────


def _day_bound(day: str | None, *, end: bool) -> datetime | None:
    """A YYYY-MM-DD day in the user's own time zone, as the UTC instant it starts (or, for
    `end`, the instant the next day starts) — the way the rows are stored."""
    if not day:
        return None
    try:
        parsed = date.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=tr("التاريخ لازم يكون بالشكل YYYY-MM-DD.")) from exc
    if end:
        parsed += timedelta(days=1)
    return datetime.combine(parsed, time.min).astimezone().astimezone(UTC)


def _usage_filter(since: str | None, until: str | None, model_ref: str | None, source: str | None) -> list:
    where = []
    if (start := _day_bound(since, end=False)) is not None:
        where.append(UsageRecord.created_at >= start)
    if (stop := _day_bound(until, end=True)) is not None:
        where.append(UsageRecord.created_at < stop)
    if model_ref:
        where.append(UsageRecord.model_ref == model_ref)
    if source:
        where.append(UsageRecord.scope_id == source)
    return where


async def _titles(session: AsyncSession, ids: set[str]) -> dict[str, str]:
    """The chat or task each call was for, by its current title."""
    if not ids:
        return {}
    chats = (await session.execute(select(Chat.id, Chat.title).where(Chat.id.in_(ids)))).all()
    tasks = (await session.execute(select(Task.id, Task.title).where(Task.id.in_(ids)))).all()
    return {**dict(tasks), **dict(chats)}


@router.get("/usage/sources", response_model=list[UsageSource])
async def usage_sources(
    since: str | None = None, until: str | None = None, session: AsyncSession = Depends(get_session)
) -> list[UsageSource]:
    """The chats and tasks that made calls in the period, most expensive first."""
    rows = (
        await session.execute(
            select(UsageRecord.scope, UsageRecord.scope_id, func.count(), func.sum(UsageRecord.cost_usd))
            .where(UsageRecord.scope_id.is_not(None), UsageRecord.scope.in_(("chat", "task")), *_usage_filter(since, until, None, None))
            .group_by(UsageRecord.scope, UsageRecord.scope_id)
        )
    ).all()
    titles = await _titles(session, {r[1] for r in rows})
    out = [
        UsageSource(kind=kind, id=scope_id, title=titles.get(scope_id) or tr("(محذوفة)"), calls=int(calls), cost_usd=round(float(cost or 0.0), 6))
        for kind, scope_id, calls, cost in rows
    ]
    out.sort(key=lambda s: (s.cost_usd, s.calls), reverse=True)
    return out


def _cell(value: object) -> object:
    """A spreadsheet reads a cell that starts with = + - @ as a formula. A chat title is the
    user's own text, but it shouldn't run as one when the file is opened."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@router.get("/usage/export")
async def usage_export(
    since: str | None = None,
    until: str | None = None,
    model_ref: str | None = None,
    source: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Every model call in the period as CSV: when, which model, what for, tokens, cost.
    Filtered by day range, by model, and by one chat or task."""
    records = (
        await session.execute(
            select(UsageRecord).where(*_usage_filter(since, until, model_ref, source)).order_by(UsageRecord.created_at)
        )
    ).scalars().all()
    names = dict((await session.execute(select(LlmModel.id, LlmModel.name))).all())
    titles = await _titles(session, {r.scope_id for r in records if r.scope_id})
    designs = set((await session.execute(select(Chat.id).where(Chat.mode == "design"))).scalars())
    kinds = {"chat": tr("محادثة"), "task": tr("مهمة"), "design": tr("تصميم")}

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(
        [
            tr("الوقت"),
            tr("النموذج"),
            tr("معرّف النموذج"),
            tr("النوع"),
            tr("المحادثة أو المهمة"),
            tr("توكنات الإدخال"),
            tr("منها من الكاش"),
            tr("توكنات الإخراج"),
            tr("الكلفة (دولار)"),
        ]
    )
    for r in records:
        stamp = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=UTC)
        writer.writerow(
            [
                stamp.astimezone().strftime("%Y-%m-%d %H:%M:%S"),
                _cell(names.get(r.model_ref or "", r.model_name)),
                _cell(r.model_name),
                kinds["design"] if r.scope_id in designs else kinds.get(r.scope, tr("غير ذلك")),
                _cell(titles.get(r.scope_id or "", "")),
                r.prompt_tokens,
                r.cached_tokens,
                r.completion_tokens,
                f"{r.cost_usd:.6f}",
            ]
        )
    name = f"rafiq-usage-{since or 'all'}-{until or date.today().isoformat()}.csv"
    # The byte-order mark tells Excel the file is UTF-8, so Arabic titles open as Arabic.
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
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


# ── Logs ──────────────────────────────────────────────────────────────────────


async def _server_names(session: AsyncSession) -> dict[str, str]:
    from rafiq_agent.mcp_bridge import slug

    servers = (await session.execute(select(McpServer))).scalars().all()
    return {slug(s.name): s.name for s in servers}


async def _known_secrets(session: AsyncSession) -> list[str]:
    """Every secret Rafiq holds, so each can be masked exactly wherever a log repeats it.
    Read from the credential store here and dropped when the request ends."""
    import contextlib
    import json

    from rafiq_agent.config import AUTH_TOKEN
    from rafiq_agent.mcp_bridge import load_secrets
    from rafiq_agent.mcp_oauth import secret_name as oauth_secret_name
    from rafiq_agent.storage.secrets import get_api_key, get_named_secret

    found: list[str | None] = [AUTH_TOKEN]
    refs = [m.api_key_ref for m in (await session.execute(select(LlmModel))).scalars()]
    refs += [i.secret_ref for i in (await session.execute(select(IntegrationAccount))).scalars()]
    refs += [a.secret_ref for a in (await session.execute(select(AuthAccount))).scalars()]
    for ref in refs:
        if ref:
            with contextlib.suppress(Exception):
                found.append(get_api_key(ref))
    for server in (await session.execute(select(McpServer))).scalars():
        with contextlib.suppress(Exception):
            saved = load_secrets(server.id)
            found += list(saved["env"].values()) + list(saved["headers"].values())
        with contextlib.suppress(Exception):
            oauth = json.loads(get_named_secret(oauth_secret_name(server.id)) or "{}")
            found += [(oauth.get("tokens") or {}).get(k) for k in ("access_token", "refresh_token")]
            found.append((oauth.get("client") or {}).get("client_secret"))
    return [s for s in found if isinstance(s, str) and s]


@router.get("/logs", response_model=list[LogInfo])
async def list_logs(session: AsyncSession = Depends(get_session)) -> list[LogInfo]:
    return [
        LogInfo(id=log.id, name=log.name, kind=log.kind, size=log.size, modified=log.modified)
        for log in logs.list_logs(await _server_names(session))
    ]


@router.get("/logs/{log_id}", response_model=LogOut)
async def read_log(
    log_id: str,
    lines: int = Query(logs.DEFAULT_LINES, ge=1, le=logs.MAX_LINES),
    session: AsyncSession = Depends(get_session),
) -> LogOut:
    log = logs.find(log_id, await _server_names(session))
    if log is None:
        raise HTTPException(status_code=404, detail=tr("ما لقيت هالسجل."))
    try:
        text, truncated = logs.tail(log.path, lines)
    except OSError as exc:
        raise HTTPException(status_code=409, detail=tr("ما قدرت أقرأ السجل: {0}", exc.strerror or str(exc))) from exc
    text = logs.redact(text, await _known_secrets(session))
    return LogOut(
        id=log.id,
        name=log.name,
        kind=log.kind,
        size=log.size,
        modified=log.modified,
        text=text,
        lines=len(text.splitlines()),
        truncated=truncated,
        path=str(log.path),
    )
