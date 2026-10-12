"""The first-run welcome: shown until it's finished or skipped, and remembered after."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_the_welcome_is_remembered_once_done(client):
    settings = (await client.get("/settings", headers=AUTH)).json()
    assert settings["onboarded"] is False  # a fresh install
    settings["onboarded"] = True
    saved = await client.put("/settings", json=settings, headers=AUTH)
    assert saved.status_code == 200 and saved.json()["onboarded"] is True
    assert (await client.get("/settings", headers=AUTH)).json()["onboarded"] is True
    # saving any other setting later keeps it
    again = (await client.get("/settings", headers=AUTH)).json()
    again["max_parallel_tasks"] = 3
    assert (await client.put("/settings", json=again, headers=AUTH)).json()["onboarded"] is True
