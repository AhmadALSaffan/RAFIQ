"""Every model call as a CSV, narrowed by day, model and chat."""

import csv
import io
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, LlmModel, UsageRecord

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture()
async def calls():
    """Two chats, two models, calls today and ten days ago."""
    await init_db()
    now = datetime.now(UTC)
    async with SessionLocal() as session:
        chat = Chat(title="=تقرير المبيعات")
        other = Chat(title="other chat")
        model = LlmModel(name="My Claude", provider="anthropic", model_id="claude-sonnet-4-5")
        session.add_all([chat, other, model])
        await session.flush()
        rows = [
            UsageRecord(created_at=now, model_ref=model.id, model_name="anthropic/claude-sonnet-4-5", scope="chat", scope_id=chat.id, prompt_tokens=1000, cached_tokens=200, completion_tokens=50, cost_usd=0.0042),
            UsageRecord(created_at=now, model_ref=None, model_name="deepseek/deepseek-v4-pro", scope="chat", scope_id=other.id, prompt_tokens=10, completion_tokens=5, cost_usd=0.0001),
            UsageRecord(created_at=now - timedelta(days=10), model_ref=model.id, model_name="anthropic/claude-sonnet-4-5", scope="chat", scope_id=chat.id, prompt_tokens=7, completion_tokens=7, cost_usd=0.5),
        ]
        session.add_all(rows)
        await session.commit()
        yield {"chat": chat.id, "other": other.id, "model": model.id}
        for r in rows:
            await session.delete(r)
        await session.delete(chat)
        await session.delete(other)
        await session.delete(model)
        await session.commit()


def _rows(text: str) -> list[list[str]]:
    assert text.startswith("﻿")  # Excel reads it as UTF-8
    return list(csv.reader(io.StringIO(text[1:])))


async def test_every_call_of_a_chat_in_a_day_range(client, calls):
    today = datetime.now().date().isoformat()
    r = await client.get(f"/usage/export?since={today}&until={today}&source={calls['chat']}", headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    header, *rows = _rows(r.text)
    assert len(header) == 9 and len(rows) == 1
    row = rows[0]
    assert row[1] == "My Claude" and row[2] == "anthropic/claude-sonnet-4-5"
    # A title that would run as a formula in a spreadsheet is written as text.
    assert row[4] == "'=تقرير المبيعات"
    assert row[5:9] == ["1000", "200", "50", "0.004200"]


async def test_filtered_by_model_and_over_all_time(client, calls):
    r = await client.get(f"/usage/export?model_ref={calls['model']}", headers=AUTH)
    _, *rows = _rows(r.text)
    assert len(rows) == 2 and all(row[1] == "My Claude" for row in rows)
    assert rows[0][0] < rows[1][0]  # oldest first


async def test_sources_lists_the_chats_with_calls(client, calls):
    today = datetime.now().date().isoformat()
    r = await client.get(f"/usage/sources?since={today}", headers=AUTH)
    assert r.status_code == 200
    by_id = {s["id"]: s for s in r.json()}
    assert by_id[calls["chat"]]["calls"] == 1 and by_id[calls["chat"]]["kind"] == "chat"
    assert calls["other"] in by_id


async def test_a_bad_date_is_a_clear_error(client):
    r = await client.get("/usage/export?since=yesterday", headers=AUTH)
    assert r.status_code == 400 and "YYYY-MM-DD" in r.json()["detail"]
