"""What Rafiq knows about a ChatGPT plan's usage, per connected account.

OpenAI publishes no endpoint for a plan's remaining usage, and its docs say not to infer
a reset time from a limit error. So this keeps only what's actually seen:
- the usage figures a response carries in its headers, when it carries any (the
  `x-codex-*-used-percent` family, or the usual `x-ratelimit-*` pairs);
- Rafiq's own requests and tokens on the plan, by day;
- when OpenAI last said the limit was reached.
Nothing here is a secret (no tokens): it sits in the data folder as plain JSON."""

from __future__ import annotations

import json
import re
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rafiq_agent.config import DATA_DIR

_FILE = "chatgpt-usage.json"
_lock = threading.Lock()
_DAYS_KEPT = 31


def _path() -> Path:
    return Path(DATA_DIR) / _FILE


def _load() -> dict[str, Any]:
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data: dict[str, Any]) -> None:
    try:
        _path().parent.mkdir(parents=True, exist_ok=True)
        _path().write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _num(value: str | None) -> float | None:
    if value is None:
        return None
    match = re.match(r"^\s*(-?\d+(?:\.\d+)?)", value)
    return float(match.group(1)) if match else None


def _duration(value: str | None) -> float | None:
    """"30s", "1m20s", "450ms", "3600" → seconds."""
    if not value:
        return None
    total = 0.0
    found = False
    for amount, unit in re.findall(r"(\d+(?:\.\d+)?)(ms|s|m|h|d)?", value):
        found = True
        total += float(amount) * {"ms": 0.001, "s": 1, "m": 60, "h": 3600, "d": 86400}.get(unit or "s", 1)
    return total if found else None


def windows_from(headers: dict[str, str]) -> list[dict[str, Any]]:
    """The usage windows a response reports, as [{name, used_percent, window_minutes,
    resets_in_seconds}], from whichever header family it uses."""
    h = {k.lower(): v for k, v in headers.items()}
    out: list[dict[str, Any]] = []
    for name in ("primary", "secondary"):
        used = _num(h.get(f"x-codex-{name}-used-percent"))
        if used is None:
            continue
        resets = _num(h.get(f"x-codex-{name}-reset-after-seconds"))
        if resets is None and (at := _num(h.get(f"x-codex-{name}-reset-at"))) is not None:
            resets = max(0.0, at - time.time())
        out.append({
            "name": name,
            "used_percent": max(0.0, min(100.0, used)),
            "window_minutes": _num(h.get(f"x-codex-{name}-window-minutes")),
            "resets_in_seconds": resets,
        })
    if out:
        return out
    for name in ("requests", "tokens"):
        limit = _num(h.get(f"x-ratelimit-limit-{name}"))
        remaining = _num(h.get(f"x-ratelimit-remaining-{name}"))
        if not limit or remaining is None:
            continue
        out.append({
            "name": name,
            "used_percent": max(0.0, min(100.0, 100 * (1 - remaining / limit))),
            "window_minutes": None,
            "resets_in_seconds": _duration(h.get(f"x-ratelimit-reset-{name}")),
        })
    return out


def _account(data: dict[str, Any], account_id: str) -> dict[str, Any]:
    return data.setdefault(account_id, {"days": {}, "windows": [], "seen_at": None, "limit_at": None})


def observe(account_id: str, headers: dict[str, str]) -> None:
    """A response's headers: keeps the usage windows they report, if any."""
    found = windows_from(headers)
    if not found:
        return
    now = time.time()
    with _lock:
        data = _load()
        entry = _account(data, account_id)
        entry["windows"] = [{**w, "resets_at": now + w["resets_in_seconds"] if w["resets_in_seconds"] is not None else None} for w in found]
        entry["seen_at"] = now
        _save(data)


def record(account_id: str, prompt_tokens: int, completion_tokens: int) -> None:
    """One finished request on the plan, counted under today's date."""
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    with _lock:
        data = _load()
        entry = _account(data, account_id)
        today = entry["days"].setdefault(day, {"requests": 0, "tokens": 0})
        today["requests"] += 1
        today["tokens"] += int(prompt_tokens) + int(completion_tokens)
        for old in sorted(entry["days"])[:-_DAYS_KEPT]:
            entry["days"].pop(old, None)
        _save(data)


def limit_hit(account_id: str) -> None:
    with _lock:
        data = _load()
        _account(data, account_id)["limit_at"] = time.time()
        _save(data)


def summary(account_id: str) -> dict[str, Any]:
    """What the app shows: the reported percentage (or None), each window, Rafiq's own
    use today and over 7 days, and whether the limit was hit recently."""
    entry = _load().get(account_id) or {"days": {}, "windows": [], "seen_at": None, "limit_at": None}
    now = time.time()
    windows = []
    for w in entry.get("windows") or []:
        resets_at = w.get("resets_at")
        if resets_at is not None and resets_at < now:
            continue  # that window has rolled over: its figure is stale
        windows.append({**w, "resets_in_seconds": max(0.0, resets_at - now) if resets_at else None})
    days = entry.get("days") or {}
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    week = sorted(days)[-7:]
    limit_at = entry.get("limit_at")
    # a limit error is "current" for a while; a later successful reply clears it
    last_ok = entry.get("ok_at") or 0
    limited = bool(limit_at and limit_at > last_ok and now - limit_at < 6 * 3600)
    return {
        "used_percent": max((w["used_percent"] for w in windows), default=None),
        "windows": windows,
        "limited": limited,
        "limit_at": limit_at,
        "today": days.get(today, {"requests": 0, "tokens": 0}),
        "week": {
            "requests": sum(days[d]["requests"] for d in week),
            "tokens": sum(days[d]["tokens"] for d in week),
        },
    }


def ok(account_id: str) -> None:
    """A reply finished: any earlier limit error no longer stands."""
    with _lock:
        data = _load()
        _account(data, account_id)["ok_at"] = time.time()
        _save(data)
