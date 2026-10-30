"""Rafiq notices what the user keeps doing by hand and offers to do it for them.

Off until the user turns it on. Everything happens on this machine with plain counting: no
model is called and nothing leaves it. It looks at two things:

- what they keep asking: the same request in chats or tasks on different days. On the same
  weekday, or on most days, it becomes an offer of a schedule at that time; at no particular
  time, an offer of a saved template.
- files they keep moving: the file index sees a file leave one folder and the same file land
  in another (core/file_index.py keeps these while this is on). The same kind of file going
  the same way a few times becomes an offer of a folder trigger.

An offer is only made once: accepted or turned down, it never comes back. Requests a schedule
already does aren't offered. Offers keep numbers, not sentences, so they read in whatever
language the app is in.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select

from rafiq_agent.core import file_index
from rafiq_agent.core.schedules import next_run, utc
from rafiq_agent.core.search import fold
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import ChatMessage, LlmModel, Schedule, Suggestion, Task, TaskTemplate

log = logging.getLogger(__name__)

WINDOW_DAYS = 45
RESCAN_SECONDS = 6 * 3600
SAME = 0.6  # how much two requests must share to count as one
MIN_WORDS = 3
MAX_WORDS = 60
MIN_WEEKS = 3
MIN_DAILY_DAYS = 5
DAILY_SPAN_DAYS = 14
MIN_TEMPLATE_TIMES = 4
MIN_MOVES = 3
HOUR_SPREAD = 3
# Words that say nothing about what was asked.
_STOP = frozenset(
    ["the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "it", "me", "my", "this", "that", "please", "can", "you", "من", "في", "على", "عن", "الى", "إلى", "و", "يا", "هذا", "هاد", "هاي", "لي", "الي", "اللي", "بدي", "ممكن", "لو", "سمحت"]
)


@dataclass
class Asked:
    text: str
    at: datetime


def words(text: str) -> frozenset[str]:
    return frozenset(w for w in fold(text)[0].split() if len(w) > 1 and w not in _STOP)


def similarity(a: frozenset[str], b: frozenset[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def group(asked: list[Asked]) -> list[list[Asked]]:
    """Requests that say much the same thing, each group compared to its first request."""
    groups: list[tuple[frozenset[str], list[Asked]]] = []
    for item in sorted(asked, key=lambda a: a.at):
        mine = words(item.text)
        if not MIN_WORDS <= len(mine) <= MAX_WORDS:
            continue
        for shape, members in groups:
            if similarity(mine, shape) >= SAME:
                members.append(item)
                break
        else:
            groups.append((mine, [item]))
    return [members for _, members in groups]


def _usual_hour(times: list[datetime]) -> tuple[int, bool]:
    """The hour it's usually asked, and whether the times really cluster around it."""
    hours = [t.hour for t in times]
    hour = Counter(hours).most_common(1)[0][0]
    return hour, sum(abs(h - hour) <= HOUR_SPREAD for h in hours) >= 0.7 * len(hours)


def rhythm(times: list[datetime], now: datetime) -> dict[str, Any] | None:
    """What these local times add up to: weekly, daily, just often, or nothing yet."""
    days = {t.date() for t in times}
    if len(days) < MIN_WEEKS:
        return None
    hour, clustered = _usual_hour(times)
    # the same weekday in different weeks
    by_weekday: dict[int, set[tuple[int, int]]] = {}
    for t in times:
        by_weekday.setdefault(t.weekday(), set()).add(tuple(t.isocalendar())[:2])
    weekday, weeks = max(by_weekday.items(), key=lambda kv: len(kv[1]))
    recent = {d for d in days if (now.date() - d).days <= DAILY_SPAN_DAYS}
    if len(recent) >= MIN_DAILY_DAYS and clustered:
        return {"kind": "daily", "hour": hour, "count": len(times)}
    if len(weeks) >= MIN_WEEKS and clustered and len(weeks) >= 0.6 * len({tuple(d.isocalendar())[:2] for d in days}):
        return {"kind": "weekly", "hour": hour, "weekday": weekday, "count": len(times)}
    if len(times) >= MIN_TEMPLATE_TIMES:
        return {"kind": "often", "count": len(times)}
    return None


def key_of(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


def offer_for_requests(members: list[Asked], now: datetime) -> dict[str, Any] | None:
    found = rhythm([m.at for m in members], now)
    if found is None:
        return None
    text = members[-1].text.strip()
    draft: dict[str, Any] = {"prompt": text, **found}
    return {
        "key": key_of("ask", " ".join(sorted(words(members[0].text)))),
        "kind": "template" if found["kind"] == "often" else "schedule",
        "title": text[:80],
        "draft": draft,
    }


def offer_for_moves(moves: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = Counter((m["ext"], m["from_dir"], m["to_dir"]) for m in moves if m["ext"])
    offers = []
    for (ext, from_dir, to_dir), count in counts.items():
        if count < MIN_MOVES:
            continue
        name = Path(to_dir).name or to_dir
        offers.append(
            {
                "key": key_of("move", ext, from_dir, to_dir),
                "kind": "folder",
                "title": f"*{ext} → {name}",
                "draft": {
                    "watch": from_dir,
                    "watch_filter": f"*{ext}",
                    "to_dir": to_dir,
                    "count": count,
                    "prompt": f"Move each new file listed below into the folder {to_dir}. Don't delete or rename anything. Report what you moved in one short line.",
                },
            }
        )
    return offers


async def _asked(since: datetime) -> list[Asked]:
    """What the user wrote themselves: chat messages, and tasks no schedule or trigger started."""
    async with SessionLocal() as session:
        messages = (
            await session.execute(select(ChatMessage).where(ChatMessage.role == "user", ChatMessage.created_at >= since))
        ).scalars().all()
        tasks = (await session.execute(select(Task).where(Task.created_at >= since))).scalars().all()
    out = [Asked(m.content, utc(m.created_at).astimezone()) for m in messages if m.content]
    for task in tasks:
        origin = task.origin or {}
        if not origin.get("schedule_id") and not origin.get("chat_id"):
            out.append(Asked(task.prompt, utc(task.created_at).astimezone()))
    return out


async def refresh(now: datetime | None = None) -> int:
    """Looks again and records any new offers. Returns how many."""
    now = now or datetime.now(UTC)
    since = now - timedelta(days=WINDOW_DAYS)
    offers = [o for members in group(await _asked(since)) if (o := offer_for_requests(members, now.astimezone()))]
    offers += offer_for_moves(await asyncio.to_thread(file_index.moves, WINDOW_DAYS))

    added = 0
    async with SessionLocal() as session:
        known = set((await session.execute(select(Suggestion.key))).scalars().all())
        done = [words(p) for p in (await session.execute(select(Schedule.prompt))).scalars().all()]
        done += [words(p) for p in (await session.execute(select(TaskTemplate.prompt))).scalars().all()]
        watched = {(s.watch, s.watch_filter) for s in (await session.execute(select(Schedule))).scalars().all()}
        for offer in offers:
            if offer["key"] in known:
                continue
            draft = offer["draft"]
            if offer["kind"] == "folder":
                if (draft["watch"], draft["watch_filter"]) in watched:
                    continue
            elif any(similarity(words(draft["prompt"]), other) >= SAME for other in done):
                continue
            session.add(Suggestion(key=offer["key"], kind=offer["kind"], title=offer["title"], draft=draft, created_at=now))
            known.add(offer["key"])
            added += 1
        await session.commit()
    return added


async def _default_model(session: Any, settings: Any) -> LlmModel | None:
    for wanted in (settings.task_model_id, settings.helper_model_id):
        if wanted and (model := await session.get(LlmModel, wanted)) and model.verify_ok is not False:
            return model
    rows = (await session.execute(select(LlmModel))).scalars().all()
    return next((m for m in rows if m.verify_ok is not False), None)


async def accept(suggestion_id: str, model_id: str | None = None) -> dict[str, str] | None:
    """Makes it real: a schedule, a folder trigger or a template. None when it's gone or no
    model can do it."""
    from rafiq_agent.core.agent_runtime import load_settings

    settings = await load_settings()
    async with SessionLocal() as session:
        row = await session.get(Suggestion, suggestion_id)
        if row is None:
            return None
        model = await session.get(LlmModel, model_id) if model_id else await _default_model(session, settings)
        if model is None:
            return None
        draft = row.draft or {}
        made: dict[str, str]
        if row.kind == "template":
            template = TaskTemplate(name=row.title[:60], prompt=draft["prompt"], model_id=model.id)
            session.add(template)
            await session.flush()
            made = {"kind": "template", "id": template.id}
        else:
            schedule = Schedule(title=row.title[:120], prompt=draft["prompt"], model_id=model.id, enabled=True)
            if row.kind == "folder":
                schedule.kind, schedule.watch, schedule.watch_filter = "folder", draft["watch"], draft["watch_filter"]
            else:
                schedule.kind = draft["kind"]
                schedule.at_time = f"{int(draft.get('hour', 9)):02d}:00"
                schedule.weekdays = [int(draft["weekday"])] if draft["kind"] == "weekly" else None
                schedule.next_run_at = next_run(schedule, datetime.now(UTC))
            session.add(schedule)
            await session.flush()
            made = {"kind": "schedule", "id": schedule.id}
        row.status = "accepted"
        await session.commit()
        return made


async def dismiss(suggestion_id: str) -> None:
    async with SessionLocal() as session:
        row = await session.get(Suggestion, suggestion_id)
        if row is not None:
            row.status = "dismissed"
            await session.commit()


async def run_forever() -> None:
    from rafiq_agent.core.agent_runtime import load_settings

    await asyncio.sleep(120)
    while True:
        try:
            if (await load_settings()).notice_patterns:
                await refresh()
        except Exception:  # noqa: BLE001 - the next look tries again
            log.info("pattern look failed", exc_info=True)
        await asyncio.sleep(RESCAN_SECONDS)
