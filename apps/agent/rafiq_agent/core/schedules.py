"""Scheduled tasks: every N minutes, daily at a time, or on chosen weekdays (local time).

A background loop checks every half minute and starts the ones that are due as ordinary
tasks (their origin says which schedule made them). A run that came due while the app was
closed happens once when it starts again — not once per missed slot.
"""

import asyncio
import contextlib
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import select

from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Schedule

TICK_SECONDS = 30
MIN_INTERVAL = 5


def utc(value: datetime | None) -> datetime | None:
    """SQLite hands datetimes back without a zone; everything stored here is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def parse_time(raw: str | None) -> tuple[int, int] | None:
    try:
        hour, minute = (int(x) for x in (raw or "").split(":"))
    except ValueError:
        return None
    return (hour, minute) if 0 <= hour < 24 and 0 <= minute < 60 else None


def next_run(schedule: Any, after: datetime) -> datetime | None:
    after = utc(after) or datetime.now(UTC)
    if schedule.kind == "interval":
        return after + timedelta(minutes=max(MIN_INTERVAL, int(schedule.every_minutes or 60)))
    at = parse_time(schedule.at_time)
    if at is None:
        return None
    local = after.astimezone()
    days = set(schedule.weekdays or []) if schedule.kind == "weekly" else set(range(7))
    if not days:
        return None
    for offset in range(8):
        day = (local + timedelta(days=offset)).date()
        if day.weekday() not in days:
            continue
        candidate = datetime.combine(day, time(*at), tzinfo=local.tzinfo)
        if candidate > local:
            return candidate.astimezone(UTC)
    return None


async def start_now(schedule_id: str) -> str | None:
    """Starts the schedule's task right away. Returns the task id."""
    from rafiq_agent.core.tasks_service import create_task

    async with SessionLocal() as session:
        schedule = await session.get(Schedule, schedule_id)
        if schedule is None:
            return None
        task = await create_task(
            title=schedule.title,
            prompt=schedule.prompt,
            model_id=schedule.model_id,
            working_dir=schedule.working_dir,
            origin={"schedule_id": schedule.id},
        )
        now = datetime.now(UTC)
        schedule.last_run_at = now
        schedule.last_task_id = task.id
        await session.commit()
        return task.id


async def tick(now: datetime | None = None) -> list[str]:
    """Starts every schedule that's due. Returns the ids of the tasks it created."""
    from rafiq_agent.core.tasks_service import TaskCreateError, create_task

    now = now or datetime.now(UTC)
    started: list[str] = []
    async with SessionLocal() as session:
        rows = (await session.execute(select(Schedule).where(Schedule.enabled.is_(True)))).scalars().all()
        for schedule in rows:
            due = utc(schedule.next_run_at)
            if due is None:
                schedule.next_run_at = next_run(schedule, now)
                continue
            if due > now:
                continue
            with contextlib.suppress(TaskCreateError):
                task = await create_task(
                    title=schedule.title,
                    prompt=schedule.prompt,
                    model_id=schedule.model_id,
                    working_dir=schedule.working_dir,
                    origin={"schedule_id": schedule.id},
                )
                schedule.last_task_id = task.id
                started.append(task.id)
            schedule.last_run_at = now
            schedule.next_run_at = next_run(schedule, now)
        await session.commit()
    return started


async def run_forever() -> None:
    while True:
        with contextlib.suppress(Exception):
            await tick()
        await asyncio.sleep(TICK_SECONDS)
