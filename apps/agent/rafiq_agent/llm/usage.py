"""What every model call costs, and the budget that stops them.

Each request reports its tokens; litellm's price table turns those into dollars. The
numbers are written to `usage_records` and kept as running totals in memory, so checking
a budget before a call is a comparison, not a query.

Scope (which chat or task a call belongs to) travels in a context variable, so a turn
sets it once and every call underneath it — including the ones tools make — is counted
against the right thing.
"""

import asyncio
import contextlib
import logging
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import litellm

log = logging.getLogger(__name__)

_scope: ContextVar[tuple[str, str | None, str | None]] = ContextVar("usage_scope", default=("other", None, None))

# Running totals, so a budget check costs nothing. Loaded from the DB on startup.
_today_key = ""
_month_key = ""
_today_usd = 0.0
_month_usd = 0.0
_daily_budget = 0.0
_monthly_budget = 0.0
# Rows still being written, so nothing is lost if the app closes mid-write.
_pending: set[asyncio.Task] = set()


async def drain() -> None:
    """Waits for the rows still being written (shutdown, and tests reading them back)."""
    if _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


class BudgetExceeded(Exception):
    """Raised instead of calling a provider once the user's budget is used up."""


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    cost_usd: float = 0.0

    def __bool__(self) -> bool:
        return bool(self.prompt_tokens or self.completion_tokens)


def scope(kind: str, scope_id: str | None = None, model_ref: str | None = None):
    """Count everything under this block against one chat, task or design."""
    return _ScopeToken(kind, scope_id, model_ref)


class _ScopeToken:
    def __init__(self, kind: str, scope_id: str | None, model_ref: str | None) -> None:
        self._value = (kind, scope_id, model_ref)
        self._token = None

    def __enter__(self) -> None:
        self._token = _scope.set(self._value)

    def __exit__(self, *exc: object) -> None:
        if self._token is not None:
            _scope.reset(self._token)

    def apply(self) -> None:
        """Set the scope for the rest of this asyncio task, without a block."""
        _scope.set(self._value)


def _keys(now: datetime) -> tuple[str, str]:
    return now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")


def set_budgets(daily_usd: float | None, monthly_usd: float | None) -> None:
    """0 or None means no limit."""
    global _daily_budget, _monthly_budget
    _daily_budget = max(0.0, float(daily_usd or 0.0))
    _monthly_budget = max(0.0, float(monthly_usd or 0.0))


def totals() -> dict[str, float]:
    _roll_over()
    return {
        "today_usd": round(_today_usd, 6),
        "month_usd": round(_month_usd, 6),
        "daily_budget_usd": _daily_budget,
        "monthly_budget_usd": _monthly_budget,
    }


def _roll_over() -> None:
    """A new day (or month) starts its total from zero."""
    global _today_key, _month_key, _today_usd, _month_usd
    day, month = _keys(datetime.now(UTC))
    if day != _today_key:
        _today_key, _today_usd = day, 0.0
    if month != _month_key:
        _month_key, _month_usd = month, 0.0


def check_budget() -> None:
    """Raises `BudgetExceeded` when the day's or month's limit is already spent."""
    from rafiq_agent.i18n import tr

    _roll_over()
    if _daily_budget and _today_usd >= _daily_budget:
        raise BudgetExceeded(tr("وصلت حد المصروف اليومي ({0}$). غيّره أو طفّيه من الإعدادات ← الاستهلاك.", f"{_daily_budget:g}"))
    if _monthly_budget and _month_usd >= _monthly_budget:
        raise BudgetExceeded(tr("وصلت حد المصروف الشهري ({0}$). غيّره أو طفّيه من الإعدادات ← الاستهلاك.", f"{_monthly_budget:g}"))


def measure(model: str, raw: Any) -> Usage:
    """Turns a provider's usage block into tokens and dollars."""
    if raw is None:
        return Usage()
    get = raw.get if isinstance(raw, dict) else lambda k, d=0: getattr(raw, k, d)
    prompt = int(get("prompt_tokens", 0) or 0)
    completion = int(get("completion_tokens", 0) or 0)
    details = get("prompt_tokens_details", None)
    cached = 0
    if details is not None:
        cached = int((details.get("cached_tokens", 0) if isinstance(details, dict) else getattr(details, "cached_tokens", 0)) or 0)
    cost = 0.0
    with contextlib.suppress(Exception):
        # Unknown models simply have no price — the tokens are still recorded.
        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model, prompt_tokens=prompt, completion_tokens=completion
        )
        cost = float(prompt_cost) + float(completion_cost)
    return Usage(prompt, completion, cached, cost)


def estimate(model: str, messages: list[dict[str, Any]], produced: str) -> dict[str, int]:
    """Token counts for a provider that reports none — litellm's own counter, so the
    figure is an honest estimate rather than a blank."""
    try:
        prompt = int(litellm.token_counter(model=model, messages=messages))
        completion = int(litellm.token_counter(model=model, text=produced)) if produced else 0
    except Exception:  # noqa: BLE001 - an unknown tokenizer means no estimate
        return {}
    return {"prompt_tokens": prompt, "completion_tokens": completion}


def record(model: str, raw: Any) -> None:
    """Counts one call. Never raises: a bookkeeping problem must not break a reply."""
    try:
        usage = measure(model, raw)
        if not usage:
            return
        kind, scope_id, model_ref = _scope.get()
        _add(usage.cost_usd)
        # Written in the background so a reply never waits on bookkeeping.
        task = asyncio.get_running_loop().create_task(_write(model, usage, kind, scope_id, model_ref))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
    except Exception:  # noqa: BLE001 - bookkeeping is never fatal
        log.debug("usage not recorded", exc_info=True)


def _add(cost: float) -> None:
    global _today_usd, _month_usd
    _roll_over()
    _today_usd += cost
    _month_usd += cost


async def _write(model: str, usage: Usage, kind: str, scope_id: str | None, model_ref: str | None) -> None:
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import UsageRecord

    try:
        async with SessionLocal() as session:
            session.add(
                UsageRecord(
                    model_name=model,
                    model_ref=model_ref,
                    scope=kind,
                    scope_id=scope_id,
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    cached_tokens=usage.cached_tokens,
                    cost_usd=usage.cost_usd,
                )
            )
            await session.commit()
    except Exception:  # noqa: BLE001 - bookkeeping is never fatal
        log.debug("usage row not written", exc_info=True)


async def load_totals() -> None:
    """Brings today's and this month's spending back after a restart."""
    global _today_key, _month_key, _today_usd, _month_usd
    from sqlalchemy import func, select

    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import UsageRecord

    now = datetime.now(UTC)
    _today_key, _month_key = _keys(now)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    try:
        async with SessionLocal() as session:
            _month_usd = float(
                (
                    await session.execute(
                        select(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0)).where(
                            UsageRecord.created_at >= month_start
                        )
                    )
                ).scalar_one()
            )
            _today_usd = float(
                (
                    await session.execute(
                        select(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0)).where(
                            UsageRecord.created_at >= day_start
                        )
                    )
                ).scalar_one()
            )
    except Exception:  # noqa: BLE001 - an empty total is better than a failed start
        log.debug("usage totals not loaded", exc_info=True)
