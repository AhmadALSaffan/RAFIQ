"""The council, the morning radio and pattern noticing, with fake models: no provider is
ever called."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete, select

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import council, file_index, patterns, radio
from rafiq_agent.main import app
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import (
    Chat,
    ChatMessage,
    LlmModel,
    RadioEpisode,
    Schedule,
    Suggestion,
    TaskTemplate,
)

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


class FakeLlm:
    def __init__(self, name, fail_on=()):
        self.name, self.fail_on, self.seen = name, fail_on, []

    async def stream_chat(self, messages, tools):
        system = messages[0]["content"]
        self.seen.append(messages)
        stage = "verdict" if "chair" in system else "critique" if "Critique" in system else "answer"
        if stage in self.fail_on:
            raise RuntimeError(f"{self.name} is down")
        for word in (f"{self.name}-{stage}", " done"):
            yield SimpleNamespace(text_delta=word)


def seats(*llms):
    return [council.Seat(id=f"m{i}", name=llm.name, llm=llm) for i, llm in enumerate(llms)]


async def collect(stream):
    return [event async for event in stream]


@pytest.fixture()
async def db():
    await init_db()
    yield
    async with SessionLocal() as session:
        for table in (RadioEpisode, Suggestion):
            await session.execute(delete(table))
        await session.execute(delete(Schedule).where(Schedule.title.like("ask%")))
        await session.execute(delete(Schedule).where(Schedule.title.like("*.%")))
        await session.execute(delete(TaskTemplate).where(TaskTemplate.name.like("ask%")))
        await session.execute(delete(LlmModel).where(LlmModel.name == "ambient-test"))
        await session.commit()


# ── The council ────────────────────────────────────────────────────────────────────────


async def test_the_council_answers_critiques_and_decides_then_saves_a_chat(db):
    a, b = FakeLlm("alpha"), FakeLlm("beta")
    events = await collect(council.run("شو أحسن قاعدة بيانات؟", seats(a, b)))
    assert [e["stage"] for e in events if e["type"] == "stage"] == ["answer", "critique", "verdict"]
    done = events[-1]
    assert done["type"] == "done"

    # a critique reads the other's answer under a neutral name, never the model's
    critique_prompt = a.seen[1][1]["content"]
    assert "beta-answer" in critique_prompt and "Advisor B" in critique_prompt and "beta " not in critique_prompt.replace("beta-answer", "")

    async with SessionLocal() as session:
        rows = (await session.execute(select(ChatMessage).where(ChatMessage.chat_id == done["chat_id"]).order_by(ChatMessage.created_at))).scalars().all()
        reply = next(m for m in rows if m.role == "assistant")
        assert reply.content == "alpha-verdict done"
        record = reply.parts[0]
        assert record["kind"] == "council" and [s["answer"] for s in record["seats"]] == ["alpha-answer done", "beta-answer done"]
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == done["chat_id"]))
        await session.execute(delete(Chat).where(Chat.id == done["chat_id"]))
        await session.commit()


async def test_one_model_failing_does_not_end_the_council_and_the_next_chairs(db):
    a, b = FakeLlm("alpha", fail_on=("verdict",)), FakeLlm("beta", fail_on=("critique",))
    events = await collect(council.run("question", seats(a, b)))
    assert any(e["type"] == "error" and e["stage"] == "critique" for e in events)
    assert [e["seat"] for e in events if e["type"] == "chair"] == ["m0", "m1"]
    assert events[-1]["type"] == "done"
    async with SessionLocal() as session:
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == events[-1]["chat_id"]))
        await session.execute(delete(Chat).where(Chat.id == events[-1]["chat_id"]))
        await session.commit()


async def test_nobody_answering_fails_cleanly(db):
    events = await collect(council.run("question", seats(FakeLlm("a", fail_on=("answer",)), FakeLlm("b", fail_on=("answer",)))))
    assert events[-1]["type"] == "failed"


async def test_the_council_needs_two_models(db):
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/council", headers=AUTH, json={"question": "q", "model_ids": ["nope", "nope"]})
    assert r.status_code == 400


# ── The radio ──────────────────────────────────────────────────────────────────────────


def test_the_show_is_written_only_from_real_facts():
    text = radio.facts_text({"date": "Friday", "tasks": [{"title": "report", "status": "failed"}], "today": [], "files": ["a.pdf"], "news": ""})
    assert "report (failed)" in text and "a.pdf" in text and "Scheduled today:\n- nothing" in text
    assert "News" not in text
    assert "Never invent" in radio.SCRIPT_SYSTEM


async def test_an_episode_is_made_once_a_day_at_its_time(db, monkeypatch):
    calls = []

    class Writes:
        async def complete(self, messages, max_tokens=None):
            calls.append(messages)
            return "صباح الخير"

    settings = AppSettings(radio_enabled=True, radio_time="08:00")

    async def loaded():
        return settings

    monkeypatch.setattr("rafiq_agent.core.agent_runtime.load_settings", loaded)
    monkeypatch.setattr("rafiq_agent.auth.resolve.llm_for", lambda model: Writes())
    async with SessionLocal() as session:
        session.add(LlmModel(name="ambient-test", provider="custom", model_id="t", base_url="http://127.0.0.1:1"))
        await session.commit()

    local = datetime.now().astimezone()
    early = local.replace(hour=7, minute=0).astimezone(UTC)
    late = local.replace(hour=9, minute=0).astimezone(UTC)
    assert await radio.tick(early) is None
    episode = await radio.tick(late)
    assert episode is not None and episode.script == "صباح الخير"
    assert await radio.tick(late) is None
    assert len(calls) == 1

    chat_id = await radio.episode_chat(episode)
    async with SessionLocal() as session:
        rows = (await session.execute(select(ChatMessage).where(ChatMessage.chat_id == chat_id))).scalars().all()
        assert [m.role for m in rows] == ["assistant"] and rows[0].content == "صباح الخير"
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()


async def test_a_switched_off_radio_stays_quiet(db, monkeypatch):
    async def loaded():
        return AppSettings(radio_enabled=False)

    monkeypatch.setattr("rafiq_agent.core.agent_runtime.load_settings", loaded)
    assert await radio.tick() is None


# ── Noticing ───────────────────────────────────────────────────────────────────────────


NOW = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)


def weeks_ago(n, weekday=6, hour=9):
    day = NOW - timedelta(days=(NOW.weekday() - weekday) % 7 + 7 * n)
    return day.replace(hour=hour)


def test_the_same_request_groups_however_it_is_written():
    asked = [
        patterns.Asked("لخّصلي تقرير المبيعات الأسبوعي", weeks_ago(1)),
        patterns.Asked("لخصلي تقرير المبيعات الاسبوعي!", weeks_ago(2)),
        patterns.Asked("شو الطقس بكرا في عمان", weeks_ago(3)),
    ]
    sizes = sorted(len(g) for g in patterns.group(asked))
    assert sizes == [1, 2]


def test_rhythm_tells_weekly_from_daily_from_just_often():
    weekly = patterns.rhythm([weeks_ago(n) for n in (1, 2, 3, 4)], NOW)
    assert weekly["kind"] == "weekly" and weekly["weekday"] == 6 and weekly["hour"] == 9
    daily = patterns.rhythm([(NOW - timedelta(days=d)).replace(hour=8) for d in range(1, 7)], NOW)
    assert daily["kind"] == "daily" and daily["hour"] == 8
    scattered = [NOW - timedelta(days=d, hours=d * 5) for d in (1, 9, 17, 29, 38)]
    assert patterns.rhythm(scattered, NOW)["kind"] == "often"
    assert patterns.rhythm([weeks_ago(1), weeks_ago(1)], NOW) is None


def test_moves_are_seen_and_offered_after_a_few_times(tmp_path: Path):
    gone = {r"C:\u\Downloads\a.pdf": 10, r"C:\u\Downloads\empty.txt": 0, r"C:\u\Downloads\b.pdf": 7}
    arrived = {r"C:\u\Docs\a.pdf": 10, r"C:\u\Docs\empty.txt": 0, r"C:\u\Docs\b.pdf": 8}
    found = file_index.find_moves(gone, arrived)
    assert len(found) == 1 and found[0][0] == ".pdf"

    move = {"ext": ".pdf", "from_dir": "D", "to_dir": "bills"}
    assert patterns.offer_for_moves([move, move]) == []
    offers = patterns.offer_for_moves([move, move, move])
    assert offers[0]["kind"] == "folder" and offers[0]["draft"]["watch_filter"] == "*.pdf" and offers[0]["title"] == "*.pdf → bills"


def test_the_index_records_a_move_only_when_asked(tmp_path: Path):
    file_index.clear()
    try:
        a, b = tmp_path / "a", tmp_path / "b"
        a.mkdir(), b.mkdir()
        (a / "bill.pdf").write_bytes(b"x" * 50)
        file_index.scan([str(tmp_path)], record_moves=True)
        os.replace(a / "bill.pdf", b / "bill.pdf")
        file_index.scan([str(tmp_path)], record_moves=True)
        assert file_index.moves(1) == [{"ext": ".pdf", "from_dir": str(a), "to_dir": str(b)}]
        os.replace(b / "bill.pdf", a / "bill.pdf")
        file_index.scan([str(tmp_path)], record_moves=False)
        assert len(file_index.moves(1)) == 1
    finally:
        file_index.clear()


async def test_an_offer_is_made_once_and_becomes_a_real_schedule(db, monkeypatch):
    asked = [patterns.Asked("ask لخّصلي تقرير المبيعات الأسبوعي", weeks_ago(n).astimezone()) for n in (1, 2, 3)]

    async def fake_asked(_since):
        return asked

    monkeypatch.setattr(patterns, "_asked", fake_asked)
    monkeypatch.setattr(file_index, "moves", lambda days: [])
    async with SessionLocal() as session:
        model = LlmModel(name="ambient-test", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        model_id = model.id

    assert await patterns.refresh(NOW) == 1
    assert await patterns.refresh(NOW) == 0  # never twice
    async with SessionLocal() as session:
        offer = (await session.execute(select(Suggestion))).scalars().one()
    assert offer.kind == "schedule" and offer.draft["kind"] == "weekly"

    made = await patterns.accept(offer.id, model_id)
    async with SessionLocal() as session:
        schedule = await session.get(Schedule, made["id"])
        assert schedule.kind == "weekly" and schedule.weekdays == [offer.draft["weekday"]] and schedule.next_run_at is not None
        assert (await session.get(Suggestion, offer.id)).status == "accepted"
    # what a schedule already does isn't offered again, even under a fresh look
    async with SessionLocal() as session:
        await session.execute(delete(Suggestion))
        await session.commit()
    assert await patterns.refresh(NOW) == 0


async def test_noticing_is_off_by_default_and_shows_nothing(db):
    assert AppSettings().notice_patterns is False and AppSettings().radio_enabled is False
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/suggestions", headers=AUTH)).json() == []
        assert (await client.post("/suggestions/refresh", headers=AUTH)).json() == {"added": 0}
