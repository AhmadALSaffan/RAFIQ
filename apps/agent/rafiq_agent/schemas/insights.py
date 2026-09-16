from datetime import datetime
from typing import Any

from pydantic import BaseModel


class UsageByModel(BaseModel):
    model_ref: str | None
    name: str
    calls: int
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int
    cost_usd: float


class UsageDay(BaseModel):
    date: str
    cost_usd: float
    tokens: int


class UsageSummary(BaseModel):
    days: int
    today_usd: float
    month_usd: float
    daily_budget_usd: float
    monthly_budget_usd: float
    total_usd: float
    total_tokens: int
    by_model: list[UsageByModel]
    by_day: list[UsageDay]


class Diagnostics(BaseModel):
    """Everything useful for a bug report and nothing secret — see api/insights.py."""

    generated_at: datetime
    version: str
    python: str
    platform: str
    frozen: bool
    settings: dict[str, Any]
    models: list[dict[str, Any]]
    mcp_servers: list[dict[str, Any]]
    counts: dict[str, int]
    recent_failures: list[dict[str, Any]]
    usage: dict[str, float]
