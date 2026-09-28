"""Bookmarks: star a message, find it again from the chat or from anywhere."""

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete, select

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, ChatMessage

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def chat():
    """A chat with a question, a reply that is all tool calls, and a plain reply. The
    database is shared, so the chat (and any fork of it) goes away after the test."""
    async with SessionLocal() as session:
        row = Chat(title="مشروع الفواتير")
        session.add(row)
        await session.flush()
        question = ChatMessage(chat_id=row.id, role="user", content="كيف بنظّم   الفواتير؟")
        tools = ChatMessage(
            chat_id=row.id,
            role="assistant",
            content="",
            parts=[{"kind": "tool", "tool": "list_dir"}, {"kind": "text", "text": "لقيت 12\nفاتورة."}],
        )
        reply = ChatMessage(chat_id=row.id, role="assistant", content="رتّبها حسب الشهر. " * 20)
        session.add_all([question, tools, reply])
        await session.commit()
        ids = {"chat": row.id, "question": question.id, "tools": tools.id, "reply": reply.id}
    yield ids
    async with SessionLocal() as session:
        forks = (await session.execute(select(Chat.id).where(Chat.title.contains("مشروع الفواتير")))).scalars().all()
        for chat_id in forks:
            await session.execute(delete(ChatMessage).where(ChatMessage.chat_id == chat_id))
            await session.execute(delete(Chat).where(Chat.id == chat_id))
        await session.commit()


async def _star(client, chat_id: str, message_id: str, on: bool = True) -> httpx.Response:
    return await client.put(
        f"/chats/{chat_id}/messages/{message_id}/bookmark", json={"bookmarked": on}, headers=AUTH
    )


async def _mine(client, chat_id: str) -> list[dict]:
    listed = (await client.get("/chats/bookmarks", headers=AUTH)).json()
    return [b for b in listed if b["chat_id"] == chat_id]


async def test_a_starred_message_is_listed_with_its_chat_and_a_short_excerpt(client, chat):
    r = await _star(client, chat["chat"], chat["reply"])
    assert r.status_code == 200 and r.json()["bookmarked_at"]
    await _star(client, chat["chat"], chat["question"])

    marks = await _mine(client, chat["chat"])
    # Newest star first.
    assert [b["message_id"] for b in marks] == [chat["question"], chat["reply"]]
    assert marks[0]["chat_title"] == "مشروع الفواتير" and marks[0]["role"] == "user"
    assert marks[0]["excerpt"] == "كيف بنظّم الفواتير؟"
    assert len(marks[1]["excerpt"]) == 160 and marks[1]["excerpt"].endswith("…")

    detail = (await client.get(f"/chats/{chat['chat']}", headers=AUTH)).json()
    starred = {m["id"] for m in detail["messages"] if m["bookmarked_at"]}
    assert starred == {chat["question"], chat["reply"]}


async def test_a_reply_made_of_tool_calls_is_named_by_its_text(client, chat):
    await _star(client, chat["chat"], chat["tools"])
    (mark,) = await _mine(client, chat["chat"])
    assert mark["excerpt"] == "لقيت 12 فاتورة."


async def test_starring_twice_keeps_the_first_time_and_unstarring_removes_it(client, chat):
    first = (await _star(client, chat["chat"], chat["reply"])).json()["bookmarked_at"]
    again = (await _star(client, chat["chat"], chat["reply"])).json()["bookmarked_at"]
    assert again == first

    off = await _star(client, chat["chat"], chat["reply"], on=False)
    assert off.status_code == 200 and off.json()["bookmarked_at"] is None
    assert await _mine(client, chat["chat"]) == []


async def test_archived_chats_keep_their_bookmarks_and_forks_copy_them(client, chat):
    await _star(client, chat["chat"], chat["question"])
    await client.patch(f"/chats/{chat['chat']}", json={"archived": True}, headers=AUTH)
    (mark,) = await _mine(client, chat["chat"])
    assert mark["archived"] is True

    fork = (await client.post(f"/chats/{chat['chat']}/fork", json={}, headers=AUTH)).json()
    assert [m["content"] for m in fork["messages"] if m["bookmarked_at"]] == ["كيف بنظّم   الفواتير؟"]


async def test_a_message_from_another_chat_is_not_found(client, chat):
    assert (await _star(client, "nope", chat["reply"])).status_code == 404
    assert (await _star(client, chat["chat"], "nope")).status_code == 404
