"""The quick-ask shortcut is a setting like the others: on by default, and switchable off."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.storage.db import init_db

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def test_the_shortcut_is_on_by_default_and_settings_saved_before_it_existed_still_load():
    assert AppSettings().quick_ask_shortcut == "Ctrl+Shift+Space"
    assert AppSettings.model_validate({"run_in_background": True}).quick_ask_shortcut == "Ctrl+Shift+Space"


def test_the_selected_text_comes_along_by_default_and_there_are_no_own_actions_yet():
    settings = AppSettings.model_validate({"run_in_background": True})
    assert settings.quick_ask_selection is True
    assert settings.quick_actions == []


async def test_own_actions_are_saved_and_bad_ones_refused(client):
    current = (await client.get("/settings", headers=AUTH)).json()
    action = {"id": "a1", "label": "تغريدة", "prompt": "اكتب النص كتغريدة قصيرة."}
    try:
        saved = await client.put("/settings", json={**current, "quick_actions": [action], "quick_ask_selection": False}, headers=AUTH)
        assert saved.status_code == 200
        assert saved.json()["quick_actions"] == [action]
        assert saved.json()["quick_ask_selection"] is False
        empty = await client.put("/settings", json={**current, "quick_actions": [{**action, "prompt": ""}]}, headers=AUTH)
        assert empty.status_code == 422
        too_many = [{**action, "id": f"a{i}"} for i in range(21)]
        assert (await client.put("/settings", json={**current, "quick_actions": too_many}, headers=AUTH)).status_code == 422
    finally:
        await client.put("/settings", json=current, headers=AUTH)


async def test_the_shortcut_can_be_changed_and_switched_off(client):
    current = (await client.get("/settings", headers=AUTH)).json()
    try:
        changed = await client.put("/settings", json={**current, "quick_ask_shortcut": "Ctrl+Alt+Space"}, headers=AUTH)
        assert changed.json()["quick_ask_shortcut"] == "Ctrl+Alt+Space"
        off = await client.put("/settings", json={**current, "quick_ask_shortcut": None}, headers=AUTH)
        assert off.json()["quick_ask_shortcut"] is None
        assert (await client.get("/settings", headers=AUTH)).json()["quick_ask_shortcut"] is None
    finally:
        await client.put("/settings", json=current, headers=AUTH)
