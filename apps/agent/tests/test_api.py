"""End-to-end HTTP checks against the real app, with the model provider stubbed out."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.llm.base import StreamEvent
from rafiq_agent.main import app
from rafiq_agent.storage.db import init_db

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture()
def stub_llm(monkeypatch):
    """Every model answers with one short reply — no network, no keys."""

    async def fake_stream(self, messages, tools):  # noqa: ANN001
        yield StreamEvent(text_delta="جواب تجريبي")
        yield StreamEvent(finish_reason="stop")

    async def fake_complete(self, messages, max_tokens=None):  # noqa: ANN001
        return "ملخص تجريبي"

    monkeypatch.setattr("rafiq_agent.llm.base.LlmProvider.stream_chat", fake_stream)
    monkeypatch.setattr("rafiq_agent.llm.base.LlmProvider.complete", fake_complete)


async def make_model(client) -> str:
    """Registers a model, skipping the verify call the endpoint would normally make."""
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    async with SessionLocal() as session:
        model = LlmModel(name="Test", provider="custom", model_id="test-model", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        await session.refresh(model)
        return model.id


async def test_health_needs_no_token(client):
    assert (await client.get("/health")).json() == {"ok": True}


async def test_every_other_route_needs_the_token(client):
    assert (await client.get("/models")).status_code == 401
    assert (await client.get("/chats")).status_code == 401
    assert (await client.get("/designs")).status_code == 401


async def test_settings_round_trip(client):
    current = (await client.get("/settings", headers=AUTH)).json()
    current["permissions"]["shell"] = "deny"
    saved = (await client.put("/settings", headers=AUTH, json=current)).json()
    assert saved["permissions"]["shell"] == "deny"
    assert (await client.get("/settings", headers=AUTH)).json()["permissions"]["shell"] == "deny"


async def test_chat_send_streams_and_stores_the_reply(client, stub_llm):
    model_id = await make_model(client)
    chat = (await client.post("/chats", headers=AUTH, json={"model_id": model_id})).json()

    async with client.stream(
        "POST",
        f"/chats/{chat['id']}/messages",
        headers=AUTH,
        json={"content": "مرحبا", "model_id": model_id},
    ) as response:
        assert response.status_code == 200
        body = "".join([chunk async for chunk in response.aiter_text()])

    assert '"type": "start"' in body
    assert "جواب تجريبي" in body
    assert '"type": "done"' in body

    detail = (await client.get(f"/chats/{chat['id']}", headers=AUTH)).json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["title"] == "مرحبا"  # the first message names the chat


async def test_design_chats_stay_out_of_the_chat_list(client, stub_llm):
    model_id = await make_model(client)
    design = (
        await client.post("/designs", headers=AUTH, json={"model_id": model_id, "brief": {"what": "تجربة"}})
    ).json()

    chat_ids = [c["id"] for c in (await client.get("/chats", headers=AUTH)).json()]
    assert design["chat_id"] not in chat_ids
    # …but it is still reachable directly, which is how the workspace opens it
    assert (await client.get(f"/chats/{design['chat_id']}", headers=AUTH)).status_code == 200


async def test_a_design_gets_a_folder_even_when_none_was_picked(client, stub_llm):
    model_id = await make_model(client)
    design = (await client.post("/designs", headers=AUTH, json={"model_id": model_id, "brief": {}})).json()
    assert design["working_dir"]
    assert design["kickoff"]


async def test_skills_are_listed_and_readable(client):
    skills = (await client.get("/skills", headers=AUTH)).json()
    assert any(s["name"] == "impeccable" for s in skills)
    body = (await client.get("/skills/impeccable", headers=AUTH)).json()
    assert body["file"] == "SKILL.md"
    assert (await client.get("/skills/does-not-exist", headers=AUTH)).status_code == 404
