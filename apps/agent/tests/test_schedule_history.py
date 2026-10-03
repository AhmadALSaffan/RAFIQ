"""Schedule history: every run of a scheduled task — the ones it started on time, the ones
the user started by hand, and the ones that couldn't start — with how each one went."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete, select

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.schedules import tick
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel, Schedule, ScheduleRun, Task, TaskEvent, UsageRecord

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def schedule():
    """An hourly schedule on a throwaway model, due now. Everything it made goes after."""
    async with SessionLocal() as session:
        model = LlmModel(name="T", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.flush()
        row = Schedule(
            title="تقرير الصبح", prompt="لخّص", model_id=model.id, kind="interval", every_minutes=60,
            enabled=True, next_run_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        session.add(row)
        await session.commit()
        ids = {"schedule": row.id, "model": model.id}
    yield ids
    async with SessionLocal() as session:
        tasks = (
            await session.execute(select(Task.id).where(Task.origin["schedule_id"].as_string() == ids["schedule"]))
        ).scalars().all()
        for task_id in tasks:
            await session.execute(delete(TaskEvent).where(TaskEvent.task_id == task_id))
            await session.execute(delete(UsageRecord).where(UsageRecord.scope_id == task_id))
            await session.execute(delete(Task).where(Task.id == task_id))
        await session.execute(delete(ScheduleRun).where(ScheduleRun.schedule_id == ids["schedule"]))
        await session.execute(delete(Schedule).where(Schedule.id == ids["schedule"]))
        await session.execute(delete(LlmModel).where(LlmModel.id == ids["model"]))
        await session.commit()


async def _runs(client, schedule_id: str) -> list[dict]:
    r = await client.get(f"/schedules/{schedule_id}/runs", headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


async def _finish(task_id: str, status: str, *, report: str | None = None, error: str | None = None, cost: float = 0.0):
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        task.status = status
        task.updated_at = task.created_at + timedelta(seconds=42)
        if report:
            session.add(TaskEvent(task_id=task_id, type="message", payload={"role": "agent", "text": report}))
        if error:
            session.add(TaskEvent(task_id=task_id, type="error", payload={"message": error}))
        if cost:
            session.add(UsageRecord(model_name="t", scope="task", scope_id=task_id, cost_usd=cost))
        await session.commit()


async def test_each_run_is_listed_newest_first_with_how_it_went(client, schedule):
    (scheduled,) = [t for t in await tick() if t]  # the due one starts on its own
    manual = (await client.post(f"/schedules/{schedule['schedule']}/run", headers=AUTH)).json()["task_id"]

    await _finish(scheduled, "completed", report="لقيت 3 مهام جديدة   ورتّبتهن.", cost=0.0125)
    await _finish(manual, "failed", error="انتهت مهلة الاتصال بالنموذج")

    runs = await _runs(client, schedule["schedule"])
    assert [r["task_id"] for r in runs] == [manual, scheduled]
    failed, done = runs
    assert failed["trigger"] == "manual" and failed["status"] == "failed"
    assert failed["error"] == "انتهت مهلة الاتصال بالنموذج"
    assert done["trigger"] == "schedule" and done["status"] == "completed"
    assert done["summary"] == "لقيت 3 مهام جديدة ورتّبتهن."
    assert done["duration_seconds"] == 42 and done["cost_usd"] == pytest.approx(0.0125)

    listed = {s["id"]: s for s in (await client.get("/schedules", headers=AUTH)).json()}
    assert listed[schedule["schedule"]]["recent"] == ["failed", "completed"]


async def test_a_run_that_could_not_start_is_still_in_the_history(client, schedule):
    async with SessionLocal() as session:
        await session.execute(delete(LlmModel).where(LlmModel.id == schedule["model"]))
        await session.commit()

    assert await tick() == []
    (run,) = await _runs(client, schedule["schedule"])
    assert run["status"] == "not_started" and run["task_id"] is None and run["error"]

    # Started by hand, the same failure is recorded — and still reported to the caller.
    assert (await client.post(f"/schedules/{schedule['schedule']}/run", headers=AUTH)).status_code == 400
    runs = await _runs(client, schedule["schedule"])
    assert [(r["trigger"], r["status"]) for r in runs] == [("manual", "not_started"), ("schedule", "not_started")]


async def test_runs_from_before_the_history_existed_are_found_by_their_origin(client, schedule):
    async with SessionLocal() as session:
        old = Task(title="قديمة", prompt="p", model_id=schedule["model"], status="completed",
                   origin={"schedule_id": schedule["schedule"]})
        session.add(old)
        await session.commit()
        old_id = old.id
    (run,) = await _runs(client, schedule["schedule"])
    assert run["task_id"] == old_id and run["status"] == "completed"


async def test_a_deleted_schedule_takes_its_history_and_unknown_ones_are_404(client, schedule):
    await tick()
    await client.delete(f"/schedules/{schedule['schedule']}", headers=AUTH)
    async with SessionLocal() as session:
        left = (await session.execute(select(ScheduleRun).where(ScheduleRun.schedule_id == schedule["schedule"]))).all()
    assert left == []
    assert (await client.get("/schedules/nope/runs", headers=AUTH)).status_code == 404
