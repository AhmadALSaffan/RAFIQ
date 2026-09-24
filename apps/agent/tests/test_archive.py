"""Archiving a chat: out of the list, still found by search, back as soon as it's used."""

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, ChatMessage, LlmModel

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def chat():
    """One chat with a message, removed after the test (the database is shared)."""
    async with SessionLocal() as session:
        row = Chat(title="قديمة", pinned=True)
        session.add(row)
        await session.flush()
        session.add(ChatMessage(chat_id=row.id, role="user", content="خلصنا من موضوع الفواتير"))
        await session.commit()
        chat_id = row.id
    yield chat_id
    async with SessionLocal() as session:
        await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == chat_id))
        await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()


async def _ids(client, **params) -> dict[str, dict]:
    r = await client.get("/chats", params=params, headers=AUTH)
    assert r.status_code == 200, r.text
    return {c["id"]: c for c in r.json()}


async def _archive(client, chat_id: str, archived: bool) -> dict:
    r = await client.patch(f"/chats/{chat_id}", json={"archived": archived}, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


async def test_an_archived_chat_leaves_the_list_and_comes_back(client, chat):
    assert chat in await _ids(client)

    out = await _archive(client, chat, True)
    assert out["archived_at"] is not None
    assert out["pinned"] is False  # a pinned chat nobody sees would be a contradiction

    assert chat not in await _ids(client)  # the list as the user sees it
    everything = await _ids(client, include_archived="true")  # what the app loads
    assert everything[chat]["archived_at"] is not None

    back = await _archive(client, chat, False)
    assert back["archived_at"] is None
    assert chat in await _ids(client)


async def test_search_still_finds_an_archived_chat_and_says_so(client, chat):
    await _archive(client, chat, True)
    r = await client.get("/chats/search", params={"q": "الفواتير"}, headers=AUTH)
    hit = next(x for x in r.json() if x["chat_id"] == chat)
    assert hit["archived"] is True and hit["snippet"]


async def test_active_chats_come_before_archived_ones_in_search(client, chat):
    async with SessionLocal() as session:
        other = Chat(title="جديدة")
        session.add(other)
        await session.flush()
        session.add(ChatMessage(chat_id=other.id, role="user", content="موضوع الفواتير لسا مفتوح"))
        await session.commit()
        other_id = other.id
    try:
        await _archive(client, chat, True)
        r = await client.get("/chats/search", params={"q": "الفواتير"}, headers=AUTH)
        ids = [x["chat_id"] for x in r.json()]
        assert ids.index(other_id) < ids.index(chat)
    finally:
        async with SessionLocal() as session:
            await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == other_id))
            await session.execute(delete(Chat).where(Chat.id == other_id))
            await session.commit()


async def test_writing_in_an_archived_chat_brings_it_back(client, chat):
    from rafiq_agent.core.chat_service import ChatTurn, stop_turn

    async with SessionLocal() as session:
        model = LlmModel(name="archive-test", provider="openai", model_id="gpt-x")
        session.add(model)
        await session.commit()
        model_id = model.id
    try:
        await _archive(client, chat, True)
        turn = ChatTurn(chat, "رجعت لهالموضوع", model_id, [])
        await turn.prepare()  # the message is stored: that's what brings the chat back
        stop_turn(chat)  # no reply needed — stopped before the model is ever called
        await turn.start()
        _ = [line async for line in turn.subscribe()]

        listed = await _ids(client)
        assert chat in listed and listed[chat]["archived_at"] is None
    finally:
        async with SessionLocal() as session:
            await session.execute(delete(LlmModel).where(LlmModel.id == model_id))
            await session.commit()


async def test_leaving_archived_out_is_the_default_for_other_clients(client, chat):
    await _archive(client, chat, True)
    plain = await client.get("/chats", headers=AUTH)
    assert chat not in {c["id"] for c in plain.json()}
