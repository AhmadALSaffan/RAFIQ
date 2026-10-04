"""A daily budget per workspace: its chats and tasks stop calling models once it's spent,
while the rest of the app carries on."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.llm import usage
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import Chat, UsageRecord, Workspace


@pytest.fixture(autouse=True)
def _clean():
    usage.set_budgets(0, 0)
    usage._workspace_today.clear()  # noqa: SLF001 - the totals are module state
    usage._workspace_budgets.clear()  # noqa: SLF001
    yield
    usage._workspace_today.clear()  # noqa: SLF001
    usage._workspace_budgets.clear()  # noqa: SLF001


@pytest.fixture()
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", headers={"Authorization": f"Bearer {AUTH_TOKEN}"}) as c:
        yield c


@pytest.fixture()
async def workspace(client):
    made = (await client.post("/workspaces", json={"name": "عميل أ", "daily_budget_usd": 1.0})).json()
    yield made
    await client.delete(f"/workspaces/{made['id']}")
    async with SessionLocal() as session:
        await session.execute(delete(UsageRecord).where(UsageRecord.workspace_id == made["id"]))
        await session.commit()


def test_a_workspace_stops_at_its_own_limit_and_no_other():
    usage.set_workspace_budget("ws1", "عميل أ", 1.0)
    with usage.scope("chat", "c1", None, "ws1"):
        usage.check_budget()
        usage._add(0.6, "ws1")  # noqa: SLF001
        usage.check_budget()
        usage._add(0.5, "ws1")  # noqa: SLF001
        with pytest.raises(usage.BudgetExceeded, match="1"):
            usage.check_budget()
    # Another workspace, and work outside any workspace, are not held back by it.
    with usage.scope("chat", "c2", None, "ws2"):
        usage.check_budget()
    with usage.scope("chat", "c3"):
        usage.check_budget()

    usage.set_workspace_budget("ws1", "عميل أ", None)  # no limit any more
    with usage.scope("chat", "c1", None, "ws1"):
        usage.check_budget()


async def test_the_budget_is_saved_reported_and_followed(client, workspace):
    assert workspace["daily_budget_usd"] == 1.0 and workspace["today_usd"] == 0

    with usage.scope("chat", "c1", None, workspace["id"]):
        usage.record("gpt-4o-mini", {"prompt_tokens": 1000, "completion_tokens": 500})
    await usage.drain()

    listed = {w["id"]: w for w in (await client.get("/workspaces")).json()}
    assert listed[workspace["id"]]["today_usd"] > 0
    summary = (await client.get("/usage")).json()
    mine = next(w for w in summary["by_workspace"] if w["id"] == workspace["id"])
    assert mine["daily_budget_usd"] == 1.0 and mine["today_usd"] > 0

    # Lowering the limit below today's spending stops the next call.
    body = {"name": "عميل أ", "daily_budget_usd": 0.000001}
    assert (await client.put(f"/workspaces/{workspace['id']}", json=body)).status_code == 200
    with usage.scope("chat", "c1", None, workspace["id"]), pytest.raises(usage.BudgetExceeded):
        usage.check_budget()

    assert (await client.put(f"/workspaces/{workspace['id']}", json={"name": "x", "daily_budget_usd": -1})).status_code == 422


async def test_spending_comes_back_after_a_restart_even_for_rows_without_a_workspace(client, workspace):
    async with SessionLocal() as session:
        chat = Chat(title="t", workspace_id=workspace["id"])
        session.add(chat)
        await session.flush()
        # One row written before rows carried their workspace, one after.
        session.add(UsageRecord(model_name="m", scope="chat", scope_id=chat.id, cost_usd=0.25))
        session.add(UsageRecord(model_name="m", scope="chat", scope_id=chat.id, workspace_id=workspace["id"], cost_usd=0.5))
        await session.commit()
        chat_id = chat.id
    try:
        usage._workspace_today.clear()  # noqa: SLF001 - as after a restart
        await usage.load_totals()
        assert usage.workspace_today(workspace["id"]) == pytest.approx(0.75)
        with usage.scope("chat", chat_id, None, workspace["id"]):
            usage.check_budget()  # 0.75 of 1.00
    finally:
        async with SessionLocal() as session:
            await session.execute(delete(UsageRecord).where(UsageRecord.scope_id == chat_id))
            await session.execute(delete(Chat).where(Chat.id == chat_id))
            await session.commit()


async def test_a_deleted_workspace_takes_its_limit_with_it(client):
    made = (await client.post("/workspaces", json={"name": "مؤقتة", "daily_budget_usd": 0.5})).json()
    usage._add(1.0, made["id"])  # noqa: SLF001
    await client.delete(f"/workspaces/{made['id']}")
    async with SessionLocal() as session:
        assert await session.get(Workspace, made["id"]) is None
    with usage.scope("chat", "c", None, made["id"]):
        usage.check_budget()
