"""Resuming a failed task: the recap it carries, the endpoint, the run, and its git record."""

import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete, select

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import gitops, task_git
from rafiq_agent.core.manager import manager
from rafiq_agent.core.resume import RECAP_MAX, RESUMED, is_resume, recap, resume_message
from rafiq_agent.llm.base import StreamEvent
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel, Task, TaskEvent
from rafiq_agent.tools.base import ToolRegistry

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}

CALL = {"tool": "filesystem_write", "category": "write", "args": {"path": "a.txt", "content": "x"}}


def steps() -> list[tuple[str, dict[str, Any]]]:
    return [
        ("message", {"role": "agent", "text": "رح أكتب الملف"}),
        ("tool_call", {"call": CALL}),
        ("tool_result", {"tool": "filesystem_write", "ok": True, "output": "تمت الكتابة"}),
        ("tool_call", {"call": {**CALL, "tool": "shell_run", "args": {"command": "pytest"}}}),
        ("tool_result", {"tool": "shell_run", "ok": False, "output": "3 failed"}),
        ("error", {"message": "انقطع الاتصال بالنموذج"}),
    ]


# ── The recap ─────────────────────────────────────────────────────────────────────────


def test_the_recap_tells_what_finished_and_where_it_stopped():
    text = recap(steps())
    assert "filesystem_write" in text and "نجحت" in text and "تمت الكتابة" in text
    assert "shell_run" in text and "فشلت" in text and "3 failed" in text
    assert text.rstrip().endswith("انقطع الاتصال بالنموذج")


def test_a_call_that_never_got_a_result_says_so():
    text = recap([("tool_call", {"call": CALL})])
    assert "وقفت قبلها" in text


def test_nothing_to_tell_gives_an_empty_recap_and_a_graceful_message():
    assert recap([("plan", {"text": "خطة"}), ("status", {})]) == ""
    assert "ما انحفظ شي" in resume_message([])


def test_a_long_transcript_keeps_the_newest_steps():
    many = [("message", {"text": f"خطوة رقم {i} " + "ي" * 400}) for i in range(100)]
    text = recap(many)
    assert len(text) < RECAP_MAX + 1000
    assert "خطوة رقم 99" in text and "خطوة رقم 0 " not in text
    assert "انحذفت" in text


def test_huge_tool_output_is_clipped():
    text = recap([("tool_result", {"tool": "shell_run", "ok": True, "output": "z" * 50_000})])
    assert len(text) < 700


def test_only_a_trailing_marker_makes_a_run_a_resume():
    assert is_resume(steps() + [(RESUMED, {"from": "failed"})])
    assert not is_resume(steps())
    assert not is_resume([])


# ── The endpoint and the run ──────────────────────────────────────────────────────────


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def model_id():
    async with SessionLocal() as session:
        model = LlmModel(name="T", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        mid = model.id
    yield mid
    async with SessionLocal() as session:
        await session.execute(delete(LlmModel).where(LlmModel.id == mid))
        await session.commit()


@pytest.fixture()
async def made():
    """Tasks a test creates; the database is shared, so they (and their events) are removed after."""
    ids: list[str] = []
    yield ids
    async with SessionLocal() as session:
        await session.execute(delete(TaskEvent).where(TaskEvent.task_id.in_(ids)))
        await session.execute(delete(Task).where(Task.id.in_(ids)))
        await session.commit()
    for task_id in ids:
        manager.forget(task_id)


async def stopped_task(made: list[str], model_id: str, folder: Path, status: str = "failed") -> str:
    async with SessionLocal() as session:
        task = Task(title="اكتب ملف", prompt="اكتب a.txt وشغّل الاختبارات", model_id=model_id, working_dir=str(folder), status=status)
        session.add(task)
        await session.flush()
        start = datetime.now(UTC) - timedelta(minutes=1)  # a clear order, whatever the clock's grain
        for i, (kind, payload) in enumerate(steps()):
            session.add(TaskEvent(task_id=task.id, type=kind, payload=payload, created_at=start + timedelta(seconds=i)))
        await session.commit()
        made.append(task.id)
        return task.id


async def events_of(task_id: str) -> list[str]:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(TaskEvent.type).where(TaskEvent.task_id == task_id).order_by(TaskEvent.created_at)
        )
        return [r for (r,) in rows.all()]


@pytest.mark.parametrize("status", ["failed", "cancelled"])
async def test_a_stopped_task_goes_back_in_line_with_a_marker(client, model_id, made, tmp_path, status):
    task_id = await stopped_task(made, model_id, tmp_path, status)
    reply = await client.post(f"/tasks/{task_id}/resume", headers=AUTH)
    assert reply.status_code == 200 and reply.json()["status"] == "queued"
    assert (await events_of(task_id))[-1] == RESUMED
    assert manager._waiting.count(task_id) == 1


@pytest.mark.parametrize("status", ["queued", "running", "completed", "planned"])
async def test_only_failed_or_cancelled_tasks_can_be_resumed(client, model_id, made, tmp_path, status):
    task_id = await stopped_task(made, model_id, tmp_path, status)
    reply = await client.post(f"/tasks/{task_id}/resume", headers=AUTH)
    assert reply.status_code == 400
    assert RESUMED not in await events_of(task_id)


async def test_resuming_a_missing_task_is_a_404(client):
    assert (await client.post("/tasks/nope/resume", headers=AUTH)).status_code == 404


class Recording:
    """Stands in for the model: records what it was sent, answers with one reply."""

    def __init__(self) -> None:
        self.seen: list[list[dict[str, Any]]] = []
        self.model = "t"

    async def stream_chat(self, messages, tools):  # noqa: ANN001 - mirrors LlmProvider
        self.seen.append([dict(m) for m in messages])
        yield StreamEvent(text_delta="كملت وخلصت")
        yield StreamEvent(finish_reason="stop")


@pytest.fixture()
def fake_model(monkeypatch):
    llm = Recording()

    async def no_tools(*_args, **_kw):  # noqa: ANN002, ANN003
        return ToolRegistry()

    monkeypatch.setattr("rafiq_agent.core.agent_runtime.llm_for", lambda *_a, **_k: llm)
    monkeypatch.setattr("rafiq_agent.core.agent_runtime.build_registry", no_tools)
    return llm


async def test_a_resumed_run_is_told_what_already_happened(client, model_id, made, tmp_path, fake_model):
    from rafiq_agent.core.agent_runtime import run_task

    task_id = await stopped_task(made, model_id, tmp_path)
    await client.post(f"/tasks/{task_id}/resume", headers=AUTH)
    await run_task(task_id)

    sent = fake_model.seen[0]
    assert sent[1]["content"] == "اكتب a.txt وشغّل الاختبارات"  # the original request, unchanged
    note = sent[-1]
    assert note["role"] == "user"
    assert "filesystem_write" in note["content"] and "3 failed" in note["content"]
    assert "لا تعيد الخطوات اللي خلصت" in note["content"]
    async with SessionLocal() as session:
        assert (await session.get(Task, task_id)).status == "completed"  # type: ignore[union-attr]


async def test_running_it_again_from_the_top_carries_no_recap(client, model_id, made, tmp_path, fake_model):
    from rafiq_agent.core.agent_runtime import run_task

    task_id = await stopped_task(made, model_id, tmp_path, status="queued")  # a plain queued run
    await run_task(task_id)
    assert len(fake_model.seen[0]) == 2  # system + the request, nothing else


# ── Git ───────────────────────────────────────────────────────────────────────────────


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture()
def repo(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "t@t")
    _git(root, "config", "user.name", "t")
    (root / "a.txt").write_text("one\n", encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


needs_git = pytest.mark.skipif(not gitops.available(), reason="git not installed")


@needs_git
async def test_a_resumed_worktree_starts_from_the_first_runs_work(client, model_id, made, repo):
    task_id = await stopped_task(made, model_id, repo)
    folder, info = await task_git.prepare(task_id, "edit", repo, [], {"planned": "worktree"})
    (folder / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
    info = await task_git.settle(task_id, "edit", info, completed=False)
    assert info["state"] == "pending" and (repo / "a.txt").read_text(encoding="utf-8") == "one\n"
    first_base = info["base"]

    folder, again = await task_git.prepare(task_id, "edit", repo, [], info, resume=True)
    assert folder != repo and (folder / "a.txt").read_text(encoding="utf-8") == "one\ntwo\n"  # kept
    assert again["base"] == first_base and again["state"] == "running"

    (folder / "b.txt").write_text("more\n", encoding="utf-8")
    again = await task_git.settle(task_id, "edit", again, completed=True)
    assert again["state"] == "applied"
    review = await task_git.review(again)
    assert {f["path"] for f in review["files"]} == {"a.txt", "b.txt"}  # both runs, one review
    assert (repo / "a.txt").read_text(encoding="utf-8") == "one\ntwo\n" and (repo / "b.txt").exists()
    await task_git.discard(task_id, again)


@needs_git
async def test_a_resumed_in_place_task_keeps_its_original_base(client, model_id, made, repo):
    task_id = await stopped_task(made, model_id, repo)
    folder, info = await task_git.prepare(task_id, "edit", repo, [], None)
    (repo / "a.txt").write_text("half\n", encoding="utf-8")
    info = await task_git.settle(task_id, "edit", info, completed=False)
    first_base = info["base"]

    folder, again = await task_git.prepare(task_id, "edit", repo, [], info, resume=True)
    assert folder == repo and again["base"] == first_base and again["mode"] == "inplace"
    (repo / "b.txt").write_text("rest\n", encoding="utf-8")
    again = await task_git.settle(task_id, "edit", again, completed=True)
    review = await task_git.review(again)
    assert {f["path"] for f in review["files"]} == {"a.txt", "b.txt"}
    await task_git.discard(task_id, again)


async def test_a_record_without_a_repo_cannot_be_continued():
    assert not task_git.continues(None)
    assert not task_git.continues({"mode": "none", "state": "error"})
    assert task_git.continues({"repo": "/r", "base": "abc"})
