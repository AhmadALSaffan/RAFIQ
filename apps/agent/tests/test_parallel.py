"""Tasks run side by side unless they'd edit the same files, chat-made tasks can be waited
on, and a chat reply keeps going when the page that asked for it goes away."""

import asyncio
import os

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.manager import Claim, TaskManager
from rafiq_agent.llm.base import StreamEvent
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel, Task, TaskEvent

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
ROOT = os.path.abspath("proj")


# ── Claims ────────────────────────────────────────────────────────────────────────────


def test_different_folders_never_overlap():
    assert not Claim.of(os.path.join(ROOT, "a")).overlaps(Claim.of(os.path.join(ROOT, "b")))


def test_a_whole_folder_overlaps_anything_inside_it():
    assert Claim.of(ROOT).overlaps(Claim.of(ROOT, ["src/api"]))
    assert Claim.of(ROOT).overlaps(Claim.of(os.path.join(ROOT, "src")))


def test_separate_paths_in_one_folder_run_together():
    assert not Claim.of(ROOT, ["src/api"]).overlaps(Claim.of(ROOT, ["src/ui", "README.md"]))
    assert Claim.of(ROOT, ["src"]).overlaps(Claim.of(ROOT, ["src/ui/button.tsx"]))
    assert not Claim.of(ROOT, ["src/api"]).overlaps(Claim.of(ROOT, ["src/api-docs"]))  # not a prefix match


def test_a_path_outside_the_folder_claims_the_whole_folder():
    assert Claim.of(ROOT, ["../elsewhere"]) == Claim.of(ROOT)


# ── Scheduling ────────────────────────────────────────────────────────────────────────


async def _model_id() -> str:
    async with SessionLocal() as session:
        model = LlmModel(name="Test", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        return model.id


async def _task(model_id: str, working_dir: str) -> str:
    async with SessionLocal() as session:
        task = Task(title="t", prompt="p", model_id=model_id, working_dir=working_dir, status="queued")
        session.add(task)
        await session.commit()
        return task.id


class Harness:
    """A manager whose runner holds each task open until the test releases it."""

    def __init__(self, limit: int = 100) -> None:
        self.manager = TaskManager()
        self.gates: dict[str, asyncio.Event] = {}
        self.outcome: dict[str, str] = {}
        self.started: list[str] = []

        async def runner(task_id: str) -> None:
            self.started.append(task_id)
            await self.manager.set_status(task_id, "running")
            await self.gates.setdefault(task_id, asyncio.Event()).wait()
            await self.manager.set_status(task_id, self.outcome.get(task_id, "completed"))

        async def cap() -> int:
            return limit

        self.manager.start(runner, limit=cap)

    def running(self) -> set[str]:
        return set(self.manager._running)

    async def finish(self, task_id: str, status: str = "completed") -> None:
        self.outcome[task_id] = status
        self.gates.setdefault(task_id, asyncio.Event()).set()
        await settle()


async def settle() -> None:
    for _ in range(20):
        await asyncio.sleep(0.01)


@pytest.fixture()
async def db():
    await init_db()


async def test_unrelated_tasks_run_at_the_same_time(db, tmp_path):
    h, model = Harness(), await _model_id()
    ids = [await _task(model, str(tmp_path / f"t{i}")) for i in range(5)]
    for i, task_id in enumerate(ids):
        h.manager.enqueue(task_id, str(tmp_path / f"t{i}"))
    await settle()
    assert h.running() == set(ids)
    for task_id in ids:
        await h.finish(task_id)


async def test_tasks_on_one_folder_take_turns_in_order(db, tmp_path):
    h, model = Harness(), await _model_id()
    first, second = await _task(model, str(tmp_path)), await _task(model, str(tmp_path))
    h.manager.enqueue(first, str(tmp_path))
    h.manager.enqueue(second, str(tmp_path))
    await settle()
    assert h.running() == {first}
    await h.finish(first)
    assert h.running() == {second}
    await h.finish(second)


async def test_declared_paths_let_one_folder_run_in_parallel(db, tmp_path):
    h, model = Harness(), await _model_id()
    api, ui = await _task(model, str(tmp_path)), await _task(model, str(tmp_path))
    h.manager.enqueue(api, str(tmp_path), ["src/api"])
    h.manager.enqueue(ui, str(tmp_path), ["src/ui"])
    await settle()
    assert h.running() == {api, ui}
    await h.finish(api)
    await h.finish(ui)


async def test_worktree_tasks_on_one_folder_run_together(db, tmp_path):
    h, model = Harness(), await _model_id()
    first, second = await _task(model, str(tmp_path)), await _task(model, str(tmp_path))
    h.manager.enqueue(first, str(tmp_path), isolated=True)
    h.manager.enqueue(second, str(tmp_path), isolated=True)
    await settle()
    assert h.running() == {first, second}
    await h.finish(first)
    await h.finish(second)


async def test_a_later_task_doesnt_jump_ahead_of_an_earlier_overlapping_one(db, tmp_path):
    h, model = Harness(), await _model_id()
    a, b, c = [await _task(model, str(tmp_path)) for _ in range(3)]
    h.manager.enqueue(a, str(tmp_path), ["src"])
    h.manager.enqueue(b, str(tmp_path))  # whole folder: waits for a
    h.manager.enqueue(c, str(tmp_path), ["docs"])  # free of a, but b (earlier) wants docs too
    await settle()
    assert h.running() == {a}
    await h.finish(a)
    assert h.running() == {b}
    await h.finish(b)
    assert h.running() == {c}
    await h.finish(c)


async def test_depends_on_waits_and_a_failed_dependency_fails_the_task(db, tmp_path):
    h, model = Harness(), await _model_id()
    base = await _task(model, str(tmp_path / "base"))
    after = await _task(model, str(tmp_path / "after"))
    h.manager.enqueue(base, str(tmp_path / "base"))
    h.manager.enqueue(after, str(tmp_path / "after"), depends_on=[base])
    await settle()
    assert h.running() == {base}
    await h.finish(base, "failed")
    assert after not in h.started
    async with SessionLocal() as session:
        assert (await session.get(Task, after)).status == "failed"


async def test_the_parallel_limit_is_respected(db, tmp_path):
    h, model = Harness(limit=2), await _model_id()
    ids = [await _task(model, str(tmp_path / f"t{i}")) for i in range(4)]
    for i, task_id in enumerate(ids):
        h.manager.enqueue(task_id, str(tmp_path / f"t{i}"))
    await settle()
    assert h.running() == set(ids[:2])
    await h.finish(ids[0])
    assert h.running() == {ids[1], ids[2]}
    for task_id in ids[1:]:
        await h.finish(task_id)


async def test_cancelling_a_waiting_task_takes_it_out_of_line(db, tmp_path):
    h, model = Harness(), await _model_id()
    first, second = await _task(model, str(tmp_path)), await _task(model, str(tmp_path))
    h.manager.enqueue(first, str(tmp_path))
    h.manager.enqueue(second, str(tmp_path))
    await settle()
    assert await h.manager.cancel(second)
    await h.finish(first)
    assert second not in h.started


# ── Waiting on tasks ──────────────────────────────────────────────────────────────────


async def test_wait_for_tasks_returns_each_result(db, tmp_path):
    from rafiq_agent.tools.tasks import WaitForTasksTool

    model = await _model_id()
    done, slow = await _task(model, str(tmp_path / "a")), await _task(model, str(tmp_path / "b"))
    async with SessionLocal() as session:
        (await session.get(Task, done)).status = "completed"
        session.add(TaskEvent(task_id=done, type="message", payload={"role": "agent", "text": "كتبت الملف"}))
        await session.commit()

    async def finish_later() -> None:
        await asyncio.sleep(0.1)
        async with SessionLocal() as session:
            (await session.get(Task, slow)).status = "failed"
            session.add(TaskEvent(task_id=slow, type="error", payload={"message": "انقطع الاتصال"}))
            await session.commit()

    background = asyncio.create_task(finish_later())
    tool = WaitForTasksTool(lambda: [done, slow], poll_seconds=0.02)
    result = await tool.run({})
    await background
    assert result.ok
    assert "completed" in result.output and "كتبت الملف" in result.output
    assert "failed" in result.output and "انقطع الاتصال" in result.output


# ── A reply outlives its page ─────────────────────────────────────────────────────────


@pytest.fixture()
def slow_llm(monkeypatch):
    async def fake_stream(self, messages, tools):  # noqa: ANN001
        for word in ("واحد ", "اتنين ", "تلاتة"):
            await asyncio.sleep(0.05)
            yield StreamEvent(text_delta=word)
        yield StreamEvent(finish_reason="stop")

    monkeypatch.setattr("rafiq_agent.llm.base.LlmProvider.stream_chat", fake_stream)


async def _chat(model_id: str) -> str:
    from rafiq_agent.storage.models import Chat

    async with SessionLocal() as session:
        chat = Chat(title="t", model_id=model_id)
        session.add(chat)
        await session.commit()
        return chat.id


async def test_a_reply_keeps_going_after_its_stream_closes_and_can_be_rejoined(db, slow_llm):
    from rafiq_agent.core.chat_service import ChatTurn, active_turn

    model = await _model_id()
    chat_id = await _chat(model)
    turn = ChatTurn(chat_id, "مرحبا", model, [])
    await turn.prepare()
    await turn.start()

    first = turn.subscribe()
    assert '"type": "start"' in await first.__anext__()
    await first.aclose()  # the page navigated away
    assert active_turn(chat_id) is turn

    rejoined = "".join([line async for line in active_turn(chat_id).subscribe()])
    assert '"type": "start"' in rejoined  # caught up from the beginning
    assert "واحد" in rejoined and "تلاتة" in rejoined and '"type": "done"' in rejoined
    assert active_turn(chat_id) is None


async def test_stopping_a_reply_keeps_what_it_wrote(db, slow_llm):
    from rafiq_agent.core.chat_service import ChatTurn, active_turn, stop_turn

    model = await _model_id()
    chat_id = await _chat(model)
    turn = ChatTurn(chat_id, "مرحبا", model, [])
    await turn.prepare()
    await turn.start()
    await asyncio.sleep(0.08)  # "واحد" is out
    assert stop_turn(chat_id)
    events = "".join([line async for line in turn.subscribe()])
    assert '"type": "done"' in events and "واحد" in events
    assert active_turn(chat_id) is None


async def test_one_reply_at_a_time_per_chat(db, slow_llm):
    from rafiq_agent.core.chat_service import ChatError, ChatTurn, stop_turn

    model = await _model_id()
    chat_id = await _chat(model)
    turn = ChatTurn(chat_id, "مرحبا", model, [])
    await turn.prepare()
    await turn.start()
    with pytest.raises(ChatError) as caught:
        await ChatTurn(chat_id, "كمان", model, []).prepare()
    assert caught.value.status == 409
    stop_turn(chat_id)
    _ = [line async for line in turn.subscribe()]


async def test_the_stream_and_stop_routes_answer_when_nothing_is_running(db):
    model = await _model_id()
    chat_id = await _chat(model)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(f"/chats/{chat_id}/stream", headers=AUTH)).status_code == 204
        assert (await client.post(f"/chats/{chat_id}/stop", headers=AUTH)).json() == {"stopped": False}
        assert (await client.get(f"/chats/{chat_id}", headers=AUTH)).json()["streaming"] is False
