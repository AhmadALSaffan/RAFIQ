"""The knowledge folder, the smart route, the spending cap and comparing models. No real
model is ever called."""

import os
import zipfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport
from pypdf import PdfWriter
from sqlalchemy import delete

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import compare, council, knowledge
from rafiq_agent.core.agent_runtime import allow_always, policy_decision
from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
from rafiq_agent.llm import usage
from rafiq_agent.llm.router import is_simple, used_tools
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import UsageRecord
from rafiq_agent.tools.base import ToolRegistry
from rafiq_agent.tools.knowledge import KnowledgeSearchTool

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


# ── The knowledge folder ───────────────────────────────────────────────────────────────


@pytest.fixture()
def docs(tmp_path: Path):
    knowledge.clear()
    folder = tmp_path / "kb"
    folder.mkdir()
    (folder / "lease.txt").write_text("عقد الإيجار لمدة سنتين، والأجرة الشهرية 400 دينار.\n\nThe tenant pays the electricity bill.", encoding="utf-8")
    with zipfile.ZipFile(folder / "deck.pptx", "w") as z:
        z.writestr("ppt/slides/slide1.xml", "<p:sld><a:t>Welcome</a:t></p:sld>")
        z.writestr("ppt/slides/slide2.xml", "<p:sld><a:t>Revenue grew forty percent</a:t></p:sld>")
    writer = PdfWriter()
    writer.add_blank_page(100, 100)
    with (folder / "scan.pdf").open("wb") as handle:
        writer.write(handle)
    (folder / "photo.jpg").write_bytes(b"\xff\xd8")
    (folder / "node_modules").mkdir()
    (folder / "node_modules" / "skip.txt").write_text("الإيجار", encoding="utf-8")
    yield folder
    knowledge.clear()


def test_passages_come_back_with_their_file_and_page(docs: Path):
    done = knowledge.scan([str(docs)])
    assert done["added"] == 3  # no picture, no node_modules
    hit = knowledge.search(["الايجار"])[0]
    assert hit.path.endswith("lease.txt") and hit.page is None and "400" in hit.text
    slide = knowledge.search(["revenue"])[0]
    assert slide.path.endswith("deck.pptx") and slide.page == 2
    assert knowledge.describe([slide]).startswith(f"[1] deck.pptx · p.2 · {docs / 'deck.pptx'}\n")


def test_a_scanned_pdf_is_reported_as_unread_not_lost(docs: Path):
    knowledge.scan([str(docs)])
    state = knowledge.status()
    assert state["unread"] == ["scan.pdf"]
    assert state["files"] == 3


def test_only_what_changed_is_read_and_a_removed_folder_is_forgotten(docs: Path):
    knowledge.scan([str(docs)])
    assert knowledge.scan([str(docs)])["updated"] == 0
    note = docs / "lease.txt"
    note.write_text("Now about a car.", encoding="utf-8")
    os.utime(note, (note.stat().st_atime, note.stat().st_mtime + 5))
    assert knowledge.scan([str(docs)])["updated"] == 1
    assert not knowledge.search(["electricity"])
    assert knowledge.search(["car"])
    assert knowledge.scan([])["removed"] == 3
    assert knowledge.status()["files"] == 0


def test_long_text_is_cut_into_passages_that_overlap():
    pieces = knowledge.chunks("word " * 1000)
    assert len(pieces) > 3 and all(len(p) <= knowledge.CHUNK_CHARS for p in pieces)
    assert pieces[0][-knowledge.OVERLAP:] == pieces[1][: knowledge.OVERLAP]
    assert knowledge.chunks("a\n\nb") == ["a\n\nb"]


async def test_the_tool_tells_the_model_to_cite_and_not_to_guess(docs: Path):
    tool = KnowledgeSearchTool()
    assert "nothing indexed" in (await tool.run({"words": ["x"]})).output
    knowledge.scan([str(docs)])
    found = await tool.run({"words": ["revenue"]})
    assert found.ok and "[1] deck.pptx · p.2" in found.output and "cite each fact" in found.output
    assert "Nothing matched" in (await tool.run({"words": ["zebra"]})).output
    assert not (await tool.run({"words": []})).ok


# ── The smart route ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("text", ["شو عاصمة تركيا؟", "what is the capital of Turkey?", "كم يوم بالسنة الكبيسة"])
def test_a_plain_question_is_simple(text):
    assert is_simple(text)


@pytest.mark.parametrize(
    "text",
    ["اعملي موقع", "صلّح هاد الخطأ", "كمّل", "تمام", "fix the login bug", "شو بهاد الملف report.pdf", "@file شو هاد", "https://x.y لخصها", "```py\nx\n```", "س" * 300],
)
def test_work_and_follow_ups_stay_with_the_strong_model(text):
    assert not is_simple(text)


def test_context_keeps_a_question_with_the_strong_model():
    assert not is_simple("شو عاصمة تركيا؟", attachments=1)
    assert not is_simple("شو عاصمة تركيا؟", used_tools_last=True)
    assert not is_simple("شو عاصمة تركيا؟", has_folder=True)
    assert not is_simple("شو عاصمة تركيا؟", mode="design")
    assert used_tools(SimpleNamespace(parts=[{"kind": "tool"}]))
    assert not used_tools(SimpleNamespace(parts=[{"kind": "routed"}]))
    assert not used_tools(SimpleNamespace(parts=None))


# ── The spending cap ───────────────────────────────────────────────────────────────────


def running(cost: float):
    return SimpleNamespace(total=lambda: usage.Usage(prompt_tokens=1, cost_usd=cost))


async def test_the_cap_asks_at_the_limit_and_going_on_moves_it_up():
    asked = []

    async def yes(tool, category, args):
        asked.append((tool, args))
        return True

    cap = usage.SpendCap(1.0, 0.25, running(0.5))
    assert await cap.gate(yes) and not asked  # under it: nothing to ask
    cap.running = running(0.8)
    assert await cap.gate(yes)
    assert asked == [(usage.CAP_TOOL, {"spent_usd": 1.05, "limit_usd": 1.0})]
    assert cap.limit == pytest.approx(2.05)
    assert await cap.gate(yes) and len(asked) == 1


async def test_no_cap_means_never_asking_and_no_means_stop():
    async def no(*_):
        return False

    assert await usage.SpendCap(0, 99.0, running(99.0)).gate(no)
    assert await usage.SpendCap(None, 99.0, running(99.0)).gate(no)
    assert not await usage.SpendCap(1.0, 2.0, running(0.0)).gate(no)


def test_the_cap_always_asks_and_cant_be_always_allowed():
    assert policy_decision(usage.CAP_TOOL, "exec", {"shell": "auto"}) == "ask"


async def test_always_allow_ignores_the_cap():
    assert await allow_always(usage.CAP_TOOL) is None


async def test_the_loop_stops_before_the_next_model_call_when_refused():
    calls = []

    class Llm:
        async def stream_chat(self, messages, tools):
            calls.append(1)
            yield SimpleNamespace(text_delta="hello", reasoning_delta=None, tool_calls=[], truncated=False)

    async def permit(*_):
        return True

    async def refuse():
        return False

    result = await run_agent_loop(Llm(), [{"role": "user", "content": "x"}], ToolRegistry(), LoopCallbacks(permit=permit, spend_gate=refuse), max_iterations=3)
    assert result.status == "capped" and not calls


async def test_what_was_spent_is_read_back_by_scope():
    await init_db()
    async with SessionLocal() as session:
        session.add(UsageRecord(scope="chat", scope_id="cap-test", cost_usd=0.5, model_name="m"))
        session.add(UsageRecord(scope="chat", scope_id="cap-test", cost_usd=0.25, model_name="m"))
        session.add(UsageRecord(scope="task", scope_id="cap-test", cost_usd=9.0, model_name="m"))
        await session.commit()
    assert await usage.spent_on("chat", "cap-test") == pytest.approx(0.75)
    async with SessionLocal() as session:
        await session.execute(delete(UsageRecord).where(UsageRecord.scope_id == "cap-test"))
        await session.commit()


# ── Comparing two models ───────────────────────────────────────────────────────────────


class Speaks:
    def __init__(self, name, fail=False):
        self.name, self.fail = name, fail

    async def stream_chat(self, messages, tools):
        if self.fail:
            raise RuntimeError("down")
        yield SimpleNamespace(text_delta=f"{self.name} says")


async def test_both_answer_and_each_gets_its_numbers():
    seats = [council.Seat(id="a", name="A", llm=Speaks("A")), council.Seat(id="b", name="B", llm=Speaks("B", fail=True))]
    events = [e async for e in compare.run("q", seats)]
    assert events[0]["type"] == "start" and events[-1]["type"] == "done"
    done = [e for e in events if e["type"] == "finished"]
    assert len(done) == 1 and done[0]["seat"] == "a" and done[0]["first_ms"] is not None and done[0]["total_ms"] >= 0
    assert any(e["type"] == "error" and e["seat"] == "b" for e in events)
    assert any(e["type"] == "delta" and e["text"] == "A says" for e in events)


async def test_comparing_needs_two_working_models():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/compare", headers=AUTH, json={"question": "q", "model_ids": ["gone", "too"]})
    assert r.status_code == 400
