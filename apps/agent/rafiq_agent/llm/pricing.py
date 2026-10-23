"""What a model costs, per million tokens, before anyone picks it.

The prices are litellm's public price table (the same one the usage page counts dollars
with). It's fetched again once a day and kept on disk, so a new model or a changed price
shows up without an app update, and an offline start still has the last prices it saw.
Providers that publish their own prices with the model list (OpenRouter) are taken at their
word. A local model costs nothing; a Copilot model is part of the subscription.
"""

from __future__ import annotations

import contextlib
import json
import time
from dataclasses import dataclass
from typing import Any

PRICES_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
REFRESH_EVERY = 24 * 3600
LOCAL_PROVIDERS = {"ollama", "lm_studio"}
SUBSCRIPTION_PROVIDERS = {"github_copilot", "chatgpt"}


@dataclass
class Price:
    # "paid": per-token prices below. "free": runs on this machine. "subscription": part of
    # a plan the user already pays for. "unknown": the price table doesn't know it.
    kind: str
    input: float | None = None  # USD per million input tokens
    output: float | None = None  # USD per million output tokens
    cached_input: float | None = None  # USD per million cached input tokens, when cheaper

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "input": self.input,
            "output": self.output,
            "cached_input": self.cached_input,
        }


def _per_million(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number * 1_000_000, 4) if number >= 0 else None


def price_for(provider: str, model_id: str) -> Price:
    if provider in LOCAL_PROVIDERS:
        return Price("free", 0.0, 0.0)
    if provider in SUBSCRIPTION_PROVIDERS:
        return Price("subscription")
    import litellm

    from rafiq_agent.llm.base import litellm_model_string

    for name in (litellm_model_string(provider, model_id), model_id):
        try:
            info = litellm.get_model_info(model=name)
        except Exception:  # noqa: BLE001 - not in the table
            continue
        cost_in = _per_million(info.get("input_cost_per_token"))
        cost_out = _per_million(info.get("output_cost_per_token"))
        if cost_in is None and cost_out is None:
            continue
        if not cost_in and not cost_out:
            # The table writes 0 where it has no price; only a model that says so is free.
            if model_id.endswith(":free"):
                return Price("free", 0.0, 0.0)
            continue
        cached = _per_million(info.get("cache_read_input_token_cost"))
        return Price("paid", cost_in, cost_out, cached if cached is not None and cached != cost_in else None)
    return Price("unknown")


def from_openrouter(pricing: dict[str, Any] | None) -> Price | None:
    """OpenRouter lists its price per token next to each model."""
    if not pricing:
        return None
    cost_in, cost_out = _per_million(pricing.get("prompt")), _per_million(pricing.get("completion"))
    if cost_in is None and cost_out is None:
        return None
    if cost_in == 0 and cost_out == 0:
        return Price("free", 0.0, 0.0)
    cached = _per_million(pricing.get("input_cache_read"))
    return Price("paid", cost_in, cost_out, cached if cached else None)


# ── Keeping the table fresh ────────────────────────────────────────────────────────────


def _cache_path():  # noqa: ANN202
    from rafiq_agent.config import DATA_DIR

    return DATA_DIR / "prices.json"


def updated_at() -> float | None:
    """When the prices were last fetched (epoch seconds), or None if only the built-in table."""
    path = _cache_path()
    with contextlib.suppress(OSError, ValueError, KeyError):
        return float(json.loads(path.read_text(encoding="utf-8"))["fetched_at"])
    return None


def _apply(table: dict[str, Any]) -> int:
    import litellm

    entries = {k: v for k, v in table.items() if isinstance(v, dict) and k != "sample_spec"}
    litellm.model_cost.update(entries)
    return len(entries)


def load_cached() -> int:
    """At start-up: the last fetched table, if there is one."""
    path = _cache_path()
    with contextlib.suppress(OSError, ValueError, KeyError):
        return _apply(json.loads(path.read_text(encoding="utf-8"))["table"])
    return 0


async def refresh(force: bool = False) -> bool:
    """Fetches the table again when it's a day old (or when asked). Quietly keeps the last
    one if the network says no."""
    last = updated_at()
    if not force and last and time.time() - last < REFRESH_EVERY:
        return False
    import httpx

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(PRICES_URL)
            resp.raise_for_status()
            table = resp.json()
    except Exception:  # noqa: BLE001 - offline, blocked, or a bad answer: keep what we have
        return False
    if not isinstance(table, dict) or len(table) < 100:
        return False
    _apply(table)
    path = _cache_path()
    with contextlib.suppress(OSError):
        path.write_text(json.dumps({"fetched_at": time.time(), "table": table}), encoding="utf-8")
    return True
