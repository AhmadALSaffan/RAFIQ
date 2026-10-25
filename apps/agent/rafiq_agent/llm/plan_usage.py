"""What Rafiq knows about a ChatGPT plan's usage, per connected account.

OpenAI publishes no endpoint for a plan's remaining usage, and its docs say not to infer
a reset time from a limit error. So this keeps only what's actually seen:
- the usage figures a response carries in its headers, when it carries any (the
  `x-codex-*-used-percent` family, or the usual `x-ratelimit-*` pairs);
- Rafiq's own requests and tokens on the plan, by day;
- when OpenAI last said the limit was reached.

In practice the plan's responses carry no usage figures at all (checked against a live
plan: no `x-codex-*-used-percent`, no `x-ratelimit-*`, nothing in the stream). So the
percentage is usually an estimate: the tokens Rafiq spent in the last five hours (the
plan's short window), against what it had spent in the five hours before the limit was
last reached. It's labelled as an estimate wherever it's shown.
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
_WINDOW = 5 * 3600  # the plan's short usage window
_EVENTS_KEPT = 8 * 86400
_SAMPLES_KEPT = 5


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
    entry = data.setdefault(account_id, {"days": {}, "windows": [], "seen_at": None, "limit_at": None})
    entry.setdefault("events", [])
    entry.setdefault("capacity", [])
    return entry


def _in_window(entry: dict[str, Any], now: float) -> int:
    return int(sum(n for at, n in entry.get("events") or [] if now - at < _WINDOW))


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
        now = time.time()
        entry["events"] = [e for e in entry["events"] if now - e[0] < _EVENTS_KEPT]
        entry["events"].append([now, int(prompt_tokens) + int(completion_tokens)])
        for old in sorted(entry["days"])[:-_DAYS_KEPT]:
            entry["days"].pop(old, None)
        _save(data)


def limit_hit(account_id: str) -> None:
    """The plan said its limit is reached: what was spent in the window before it is one
    more measure of how much the plan holds."""
    with _lock:
        data = _load()
        entry = _account(data, account_id)
        now = time.time()
        spent = _in_window(entry, now)
        # one sample per limit: retries straight after it would only repeat the same window
        if spent > 0 and not (entry.get("limit_at") and now - entry["limit_at"] < _WINDOW and entry["capacity"]):
            entry["capacity"] = (entry["capacity"] + [spent])[-_SAMPLES_KEPT:]
        entry["limit_at"] = now
        _save(data)


def _capacity(data: dict[str, Any], account_id: str) -> int | None:
    """How many tokens the plan's window seems to hold: the largest window spent before a
    limit (a limit can come early, from the weekly window, never late), this account's
    own if it has any, else any account's; failing that, the whole day a limit came on
    (from before windows were tracked) — rough, and replaced by the first real sample."""
    own = (data.get(account_id) or {}).get("capacity") or []
    if own:
        return int(max(own))
    every = [n for e in data.values() if isinstance(e, dict) for n in e.get("capacity") or []]
    if every:
        return int(max(every))
    days = []
    for e in data.values():
        if isinstance(e, dict) and e.get("limit_at"):
            day = datetime.fromtimestamp(e["limit_at"], UTC).strftime("%Y-%m-%d")
            days.append((e.get("days") or {}).get(day, {}).get("tokens", 0))
    return int(max(days)) if days and max(days) > 0 else None


def summary(account_id: str) -> dict[str, Any]:
    """What the app shows: the reported percentage (or None), each window, Rafiq's own
    use today and over 7 days, and whether the limit was hit recently."""
    data = _load()
    entry = data.get(account_id) or {"days": {}, "windows": [], "seen_at": None, "limit_at": None}
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
    reported = max((w["used_percent"] for w in windows), default=None)
    in_window = _in_window(entry, now)
    capacity = _capacity(data, account_id)
    estimated = reported is None and not limited and capacity is not None
    if limited:
        percent: float | None = 100.0
    elif reported is not None:
        percent = reported
    elif capacity:
        # never shown full while replies still go through
        percent = round(min(99.0, 100 * in_window / capacity), 1)
    else:
        percent = None
    return {
        "used_percent": percent,
        "estimated": estimated,
        "window_tokens": in_window,
        "window_hours": _WINDOW // 3600,
        "capacity": capacity,
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
