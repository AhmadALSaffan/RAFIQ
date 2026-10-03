"""Scheduled tasks: every N minutes, daily at a time, or on chosen weekdays (local time).

A background loop checks every half minute and starts the ones that are due as ordinary
tasks (their origin says which schedule made them). A run that came due while the app was
closed happens once when it starts again — not once per missed slot.

Every run is recorded (ScheduleRun), the ones that couldn't start too, so a schedule's
history shows what happened each time instead of only the latest task.
"""

import asyncio
import contextlib
import re
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Schedule, ScheduleRun, Task, TaskEvent, UsageRecord

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
    from rafiq_agent.core.tasks_service import TaskCreateError, create_task

    async with SessionLocal() as session:
        schedule = await session.get(Schedule, schedule_id)
        if schedule is None:
            return None
        try:
            task = await create_task(
                title=schedule.title,
                prompt=schedule.prompt,
                model_id=schedule.model_id,
                working_dir=schedule.working_dir,
                origin={"schedule_id": schedule.id},
            )
        except TaskCreateError as exc:
            session.add(ScheduleRun(schedule_id=schedule.id, trigger="manual", error=str(exc)))
            await session.commit()
            raise
        now = datetime.now(UTC)
        schedule.last_run_at = now
        schedule.last_task_id = task.id
        session.add(ScheduleRun(schedule_id=schedule.id, task_id=task.id, trigger="manual", created_at=now))
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
            try:
                task = await create_task(
                    title=schedule.title,
                    prompt=schedule.prompt,
                    model_id=schedule.model_id,
                    working_dir=schedule.working_dir,
                    origin={"schedule_id": schedule.id},
                )
            except TaskCreateError as exc:
                # Not a reason to stop trying next time — but the history says why it didn't run.
                session.add(ScheduleRun(schedule_id=schedule.id, error=str(exc), created_at=now))
            else:
                schedule.last_task_id = task.id
                started.append(task.id)
                session.add(ScheduleRun(schedule_id=schedule.id, task_id=task.id, created_at=now))
            schedule.last_run_at = now
            schedule.next_run_at = next_run(schedule, now)
        await session.commit()
    return started


# ── History ───────────────────────────────────────────────────────────────────────────

FINISHED = frozenset({"completed", "failed", "cancelled"})
_SPACES = re.compile(r"\s+")


def _clip(text: str, limit: int = 220) -> str:
    text = _SPACES.sub(" ", text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


async def _runs_of(session: AsyncSession, schedule_id: str, limit: int) -> list[tuple[ScheduleRun, Task | None]]:
    """Recorded runs, plus the tasks a schedule made before runs were recorded (their
    origin still names it), newest first."""
    rows = (
        await session.execute(
            select(ScheduleRun).where(ScheduleRun.schedule_id == schedule_id)
            .order_by(ScheduleRun.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    ids = [r.task_id for r in rows if r.task_id]
    tasks = {
        t.id: t for t in (await session.execute(select(Task).where(Task.id.in_(ids)))).scalars().all()
    } if ids else {}
    runs = [(r, tasks.get(r.task_id) if r.task_id else None) for r in rows]

    known = {r.task_id for r in rows if r.task_id}
    older = (
        await session.execute(
            select(Task)
            .where(func.json_extract(Task.origin, "$.schedule_id") == schedule_id)
            .order_by(Task.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    for task in older:
        if task.id not in known and not await session.scalar(
            select(func.count()).select_from(ScheduleRun).where(ScheduleRun.task_id == task.id)
        ):
            runs.append((ScheduleRun(schedule_id=schedule_id, task_id=task.id, created_at=task.created_at), task))
    runs.sort(key=lambda pair: utc(pair[0].created_at), reverse=True)
    return runs[:limit]


def _status(run: ScheduleRun, task: Task | None) -> str:
    if run.error and not run.task_id:
        return "not_started"
    return task.status if task else "deleted"


async def recent(session: AsyncSession, schedule_id: str, limit: int = 7) -> list[str]:
    """How the latest runs ended, newest first."""
    return [_status(run, task) for run, task in await _runs_of(session, schedule_id, limit)]


async def history(session: AsyncSession, schedule_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Every run (newest first) with what it led to: status, timing, cost, and the gist of
    its report or its error."""
    out: list[dict[str, Any]] = []
    for run, task in await _runs_of(session, schedule_id, limit):
        status = _status(run, task)
        item: dict[str, Any] = {
            "id": run.id or (task.id if task else ""),
            "trigger": run.trigger or "schedule",
            "started_at": utc(run.created_at),
            "task_id": run.task_id,
            "status": status,
            "error": run.error,
        }
        if task is not None:
            if status in FINISHED:
                item["finished_at"] = utc(task.updated_at)
                item["duration_seconds"] = max(0.0, (utc(task.updated_at) - utc(task.created_at)).total_seconds())
            events = (
                await session.execute(
                    select(TaskEvent).where(TaskEvent.task_id == task.id, TaskEvent.type.in_(("message", "error")))
                    .order_by(TaskEvent.created_at.desc()).limit(20)
                )
            ).scalars().all()
            last_error = next((e for e in events if e.type == "error"), None)
            last_message = next((e for e in events if e.type == "message" and e.payload.get("role") == "agent"), None)
            if status == "failed" and last_error:
                item["error"] = _clip(str(last_error.payload.get("message", "")))
            if last_message and status == "completed":
                item["summary"] = _clip(str(last_message.payload.get("text", "")))
            item["cost_usd"] = float(
                await session.scalar(
                    select(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0)).where(
                        UsageRecord.scope == "task", UsageRecord.scope_id == task.id
                    )
                )
                or 0.0
            )
        out.append(item)
    return out


async def forget(session: AsyncSession, schedule_id: str) -> None:
    """A deleted schedule takes its history with it (its tasks stay in the task list)."""
    for run in (await session.execute(select(ScheduleRun).where(ScheduleRun.schedule_id == schedule_id))).scalars():
        await session.delete(run)


async def run_forever() -> None:
    while True:
        with contextlib.suppress(Exception):
            await tick()
        await asyncio.sleep(TICK_SECONDS)
