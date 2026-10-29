"""Replies read out loud: Windows' own voices play in the app, so the agent only speaks
for a provider — and says why when it can't."""

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


def test_windows_voices_and_the_file_index_are_the_defaults():
    s = AppSettings()
    assert s.speak_provider == "system" and s.file_search_enabled and s.file_search_dirs == []
    assert s.screen_ask_shortcut == "Ctrl+Alt+S"


async def test_speak_explains_instead_of_failing(client, monkeypatch):
    from rafiq_agent.motion import media

    monkeypatch.setattr(media, "secret", lambda name: None)  # never the real keychain
    original = (await client.get("/settings", headers=AUTH)).json()
    try:
        r = await client.post("/speak", headers=AUTH, json={"text": "مرحبا"})
        assert r.status_code == 400  # system voices are played by the app
        await client.put("/settings", headers=AUTH, json={**original, "speak_provider": "elevenlabs"})
        r = await client.post("/speak", headers=AUTH, json={"text": "مرحبا"})
        assert r.status_code == 502 and "ElevenLabs" in r.json()["detail"]
        assert (await client.post("/speak", headers=AUTH, json={"text": ""})).status_code == 422
    finally:
        await client.put("/settings", headers=AUTH, json=original)


async def test_file_search_status_lists_its_folders(client):
    r = await client.get("/settings/file-search", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert {"files", "scanning", "folders"} <= set(body)
