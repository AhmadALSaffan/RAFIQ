"""Starting a design or a reel from a chat: the real session is made (as the pages make it),
its first turn is started, and the chat is told so it can show a card."""

import pytest

from rafiq_agent.core import studio
from rafiq_agent.core.designs import brief_message
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Design, DesignIdentity, LlmModel, MotionProject
from rafiq_agent.tools.studio import DesignStartTool, MotionStartTool


@pytest.fixture()
async def model_id():
    await init_db()
    async with SessionLocal() as session:
        model = LlmModel(name="test", provider="openai", model_id="gpt-test")
        session.add(model)
        await session.commit()
        return model.id


@pytest.fixture()
def started(monkeypatch):
    """The first turns that would have started, instead of calling a model."""
    calls: list[tuple[str, str, str]] = []

    async def fake(chat_id: str, message: str, model_id: str) -> None:
        calls.append((chat_id, message, model_id))

    monkeypatch.setattr(studio, "kick_off", fake)
    return calls


async def test_a_design_from_a_chat(model_id, started):
    cards = []

    async def on_created(*card):
        cards.append(card)

    tool = DesignStartTool(model_id, None, on_created)
    result = await tool.run({"title": "مشوار", "kind": "صفحة هبوط", "what": "توصيل طلاب", "who": "طلاب", "action": "حمّل التطبيق", "style": "bold"})
    assert result.ok and "«مشوار»" in result.output and "bold" in result.output
    kind, design_id, chat_id, title = cards[0]
    assert (kind, title) == ("design", "مشوار")
    async with SessionLocal() as session:
        design = await session.get(Design, design_id)
    assert design.chat_id == chat_id and design.identity["style"] == "bold"
    assert design.brief["direction"] == "عربي RTL"  # the default when the model doesn't say
    assert started == [(chat_id, brief_message(design.brief), model_id)]


async def test_a_saved_identity_is_found_by_name(model_id, started):
    async with SessionLocal() as session:
        session.add(DesignIdentity(name="Neon Ink", data={"style": "tech", "name": "Neon Ink"}))
        await session.commit()
    cards = []

    async def on_created(*card):
        cards.append(card)

    result = await DesignStartTool(model_id, None, on_created).run({"title": "x", "kind": "موقع", "what": "x", "who": "x", "action": "x", "identity": "neon ink"})
    assert "Neon Ink" in result.output
    async with SessionLocal() as session:
        design = await session.get(Design, cards[0][1])
    assert design.identity["style"] == "tech"


async def test_a_reel_from_a_chat(model_id, started):
    cards = []

    async def on_created(*card):
        cards.append(card)

    result = await MotionStartTool(model_id, None, on_created).run({"title": "ريل", "prompt": "ريل إطلاق", "aspect": "1:1", "duration": 999})
    assert result.ok
    kind, project_id, chat_id, _title = cards[0]
    async with SessionLocal() as session:
        project = await session.get(MotionProject, project_id)
    assert kind == "motion" and project.chat_id == chat_id
    assert project.scene["composition"]["duration"] == 180  # capped for a reel
    assert started == [(chat_id, "ريل إطلاق", model_id)]
    assert not (await MotionStartTool(model_id, None, on_created).run({"prompt": " "})).ok
