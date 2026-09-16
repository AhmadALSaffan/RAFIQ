"""Counting what calls cost, stopping at the budget, forking a chat, and the report that
must not carry secrets."""

import pytest
from httpx import ASGITransport, AsyncClient

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.llm import usage
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, ChatMessage, LlmModel


@pytest.fixture(autouse=True)
def _clean_budget():
    usage.set_budgets(0, 0)
    usage._today_usd = usage._month_usd = 0.0  # noqa: SLF001 - the totals are module state
    yield
    usage.set_budgets(0, 0)


@pytest.fixture()
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", headers={"Authorization": f"Bearer {AUTH_TOKEN}"}) as c:
        yield c


def test_a_call_is_priced_from_its_tokens():
    counted = usage.measure("gpt-4o-mini", {"prompt_tokens": 1000, "completion_tokens": 500})
    assert counted.prompt_tokens == 1000 and counted.completion_tokens == 500
    assert counted.cost_usd > 0

    # A model with no published price still has its tokens counted.
    unknown = usage.measure("some-local/model-x", {"prompt_tokens": 10, "completion_tokens": 2})
    assert unknown.prompt_tokens == 10 and unknown.cost_usd == 0

    assert not usage.measure("gpt-4o-mini", None)  # nothing reported = nothing counted


def test_cached_prompt_tokens_are_read_from_the_details():
    counted = usage.measure(
        "gpt-4o-mini",
        {"prompt_tokens": 900, "completion_tokens": 10, "prompt_tokens_details": {"cached_tokens": 800}},
    )
    assert counted.cached_tokens == 800


def test_the_budget_stops_calls_once_it_is_spent():
    usage.set_budgets(1.0, 0)
    usage.check_budget()  # nothing spent yet
    usage._add(0.99)  # noqa: SLF001
    usage.check_budget()  # still under
    usage._add(0.02)  # noqa: SLF001
    with pytest.raises(usage.BudgetExceeded):
        usage.check_budget()

    usage.set_budgets(0, 0)  # 0 = no limit, whatever was spent
    usage.check_budget()


async def test_usage_adds_up_per_agent(client):
    async with SessionLocal() as session:
        model = LlmModel(name="my fast one", provider="groq", model_id="llama", verify_ok=True)
        session.add(model)
        await session.commit()
        model_id = model.id

    with usage.scope("chat", "c1", model_id):
        usage.record("groq/llama", {"prompt_tokens": 100, "completion_tokens": 20})
        usage.record("groq/llama", {"prompt_tokens": 40, "completion_tokens": 5})

    await usage.drain()
    summary = (await client.get("/usage")).json()
    mine = next(m for m in summary["by_model"] if m["model_ref"] == model_id)
    assert mine["calls"] == 2 and mine["prompt_tokens"] == 140
    assert mine["name"] == "my fast one"  # the user's own name for it, not the litellm string


async def test_the_report_carries_no_keys(client):
    async with SessionLocal() as session:
        session.add(
            LlmModel(
                name="secret one",
                provider="bedrock",
                model_id="claude",
                api_key_ref="rafiq:model:abc",
                options={"region": "us-east-1"},
            )
        )
        await session.commit()

    report = (await client.get("/diagnostics")).json()
    text = str(report)
    assert "rafiq:model:abc" not in text  # not even the keyring reference
    assert "api_key_ref" not in text and "secret" not in text.lower()
    entry = next(m for m in report["models"] if m["provider"] == "bedrock")
    assert entry["has_key"] is True and entry["options"] == ["region"]
    assert report["version"] and report["counts"]["models"] >= 1


async def test_forking_a_chat_leaves_the_original_alone(client):
    async with SessionLocal() as session:
        chat = Chat(title="the original", model_id=None)
        session.add(chat)
        await session.flush()
        for role, content in (("user", "one"), ("assistant", "two"), ("user", "three")):
            session.add(ChatMessage(chat_id=chat.id, role=role, content=content))
        await session.commit()
        chat_id = chat.id
        second = (await client.get(f"/chats/{chat_id}")).json()["messages"][1]["id"]

    fork = (await client.post(f"/chats/{chat_id}/fork", json={"until_message_id": second})).json()
    assert [m["content"] for m in fork["messages"]] == ["one", "two"]
    assert fork["id"] != chat_id

    original = (await client.get(f"/chats/{chat_id}")).json()
    assert len(original["messages"]) == 3  # untouched


async def test_editing_a_question_rewinds_the_chat(client):
    async with SessionLocal() as session:
        chat = Chat(title="to rewind", model_id=None)
        session.add(chat)
        await session.flush()
        for role, content in (("user", "first"), ("assistant", "reply"), ("user", "second"), ("assistant", "reply 2")):
            session.add(ChatMessage(chat_id=chat.id, role=role, content=content))
        await session.commit()
        chat_id = chat.id

    messages = (await client.get(f"/chats/{chat_id}")).json()["messages"]
    third = messages[2]["id"]
    left = (await client.post(f"/chats/{chat_id}/messages/{third}/truncate")).json()
    assert [m["content"] for m in left["messages"]] == ["first", "reply"]
