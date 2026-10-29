"""Tasks that start when something happens: a new file in a folder, copied text, a program
opening. The first look only takes note; a file being written is waited for; every start
is recorded and limited."""

from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete, select

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import schedules, triggers
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel, Schedule, ScheduleRun, Task

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def model_id():
    await init_db()
    async with SessionLocal() as session:
        model = LlmModel(name="T", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        mid = model.id
    yield mid
    async with SessionLocal() as session:
        ids = (await session.execute(select(Schedule.id).where(Schedule.model_id == mid))).scalars().all()
        for sid in ids:
            await session.execute(delete(ScheduleRun).where(ScheduleRun.schedule_id == sid))
            triggers.forget(sid)
        await session.execute(delete(Task).where(Task.model_id == mid))
        await session.execute(delete(Schedule).where(Schedule.model_id == mid))
        await session.execute(delete(LlmModel).where(LlmModel.id == mid))
        await session.commit()


def test_new_files_skip_what_was_there_and_wait_for_downloads(tmp_path: Path):
    (tmp_path / "old.pdf").write_bytes(b"x")
    seen = triggers._Seen()
    assert triggers.new_files(seen, str(tmp_path), "*.pdf") == []  # first look: note only
    (tmp_path / "invoice.pdf").write_bytes(b"pdf")
    (tmp_path / "photo.jpg").write_bytes(b"jpg")
    (tmp_path / "big.pdf.crdownload").write_bytes(b"...")
    assert triggers.new_files(seen, str(tmp_path), "*.pdf") == []  # still might be growing
    assert triggers.new_files(seen, str(tmp_path), "*.pdf") == ["invoice.pdf"]
    assert triggers.new_files(seen, str(tmp_path), "*.pdf") == []  # never twice


def test_patterns_and_copied_text_kinds():
    assert triggers.patterns("*.pdf, *.JPG") == ["*.pdf", "*.JPG"]
    assert triggers.patterns("") == ["*"]
    assert triggers.wanted_file("Scan.JPG", "*.pdf, *.jpg")
    assert not triggers.wanted_file("~$report.docx", "")
    assert triggers.clip_matches("Hello there, how are you?", "latin")
    assert not triggers.clip_matches("مرحبا كيفك", "latin")
    assert triggers.clip_matches("مرحبا كيفك", "arabic")
    assert triggers.clip_matches("https://example.com/a", "link")
    assert not triggers.clip_matches("https://example.com/a", "latin")
    assert not triggers.clip_matches("ok", "any")


def test_programs_match_by_name():
    assert triggers.program_matches({"excel", "chrome"}, "Excel")
    assert triggers.program_matches({"code"}, "code.exe")
    assert not triggers.program_matches({"chrome"}, "")


def test_starts_are_spaced_and_capped():
    seen = triggers._Seen()
    assert triggers._may_start(seen, "folder", 0)
    seen.starts.append(0)
    assert not triggers._may_start(seen, "folder", 5)
    assert triggers._may_start(seen, "folder", 11)
    seen.starts = [float(i * 20) for i in range(triggers.MAX_PER_HOUR)]
    assert not triggers._may_start(seen, "folder", seen.starts[-1] + 60)


async def test_a_folder_trigger_starts_one_task_per_batch_and_records_it(client, model_id, tmp_path: Path):
    r = await client.post(
        "/schedules",
        headers=AUTH,
        json={"title": "رتّب", "prompt": "رتّب الملفات", "model_id": model_id, "kind": "folder", "watch": str(tmp_path), "watch_filter": "*.pdf"},
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["next_run_at"] is None and r.json()["watch"] == str(tmp_path)

    await triggers.tick()  # notes what's there
    (tmp_path / "a.pdf").write_bytes(b"1")
    (tmp_path / "b.pdf").write_bytes(b"2")
    await triggers.tick()  # waits for the files to settle
    assert await triggers.tick() == 1
    # the clock never starts an event trigger
    assert sid not in str(await schedules.tick())

    async with SessionLocal() as session:
        runs = (await session.execute(select(ScheduleRun).where(ScheduleRun.schedule_id == sid))).scalars().all()
        task = await session.get(Task, runs[0].task_id)
    assert len(runs) == 1 and runs[0].trigger == "folder"
    assert "a.pdf" in task.prompt and "b.pdf" in task.prompt and task.prompt.startswith("رتّب الملفات")

    history = (await client.get(f"/schedules/{sid}/runs", headers=AUTH)).json()
    assert history[0]["trigger"] == "folder"


async def test_triggers_are_checked_when_saved(client, model_id, tmp_path: Path):
    base = {"title": "x", "prompt": "y", "model_id": model_id}
    r = await client.post("/schedules", headers=AUTH, json={**base, "kind": "folder", "watch": str(tmp_path / "missing")})
    assert r.status_code == 400
    r = await client.post("/schedules", headers=AUTH, json={**base, "kind": "app", "watch": "  "})
    assert r.status_code == 400
    r = await client.post("/schedules", headers=AUTH, json={**base, "kind": "clipboard", "watch_filter": "emoji"})
    assert r.status_code == 400
    r = await client.post("/schedules", headers=AUTH, json={**base, "kind": "clipboard"})
    assert r.status_code == 201 and r.json()["watch_filter"] == "any"
