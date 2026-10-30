"""Speech to text: the request goes to the provider whose key it carries (a Groq key never
reaches OpenAI), and ElevenLabs listens when it's chosen or the only one there."""

import httpx
import pytest
from httpx import ASGITransport
from sqlalchemy import delete

from rafiq_agent.api import voice
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
AUDIO = {"audio": ("speech.webm", b"\x1a\x45\xdf\xa3" + b"0" * 2000, "audio/webm")}


def test_the_model_name_names_its_provider():
    assert voice.speech_model("whisper-1", "openai") == "whisper-1"
    assert voice.speech_model("whisper-1", "groq") == "groq/whisper-large-v3"
    assert voice.speech_model("", "groq") == "groq/whisper-large-v3"
    assert voice.speech_model("whisper-large-v3-turbo", "groq") == "groq/whisper-large-v3-turbo"
    assert voice.speech_model("my-whisper", "azure") == "azure/my-whisper"
    assert voice.speech_model("groq/distil", "openai") == "groq/distil"


@pytest.fixture()
async def client(monkeypatch):
    from rafiq_agent.motion import media

    await init_db()
    monkeypatch.setattr(media, "secret", lambda name: None)  # never the real keychain
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        original = (await c.get("/settings", headers=AUTH)).json()
        yield c
        await c.put("/settings", headers=AUTH, json=original)
    async with SessionLocal() as session:
        await session.execute(delete(LlmModel).where(LlmModel.name == "listen-test"))
        await session.commit()


async def _groq_model():
    async with SessionLocal() as session:
        session.add(LlmModel(name="listen-test", provider="groq", model_id="llama", base_url=None))
        await session.commit()


async def test_a_groq_model_transcribes_with_groq(client, monkeypatch):
    await _groq_model()
    settings = (await client.get("/settings", headers=AUTH)).json()
    await client.put("/settings", headers=AUTH, json={**settings, "listen_provider": "groq"})
    seen = {}

    async def fake(**kwargs):
        seen.update(kwargs)
        return type("R", (), {"text": " مرحبا "})()

    monkeypatch.setattr(voice.litellm, "atranscription", fake)
    monkeypatch.setattr(voice, "credentials_for", lambda agent: type("C", (), {"api_key": "gsk-test", "base_url": None})())
    r = await client.post("/transcribe", headers=AUTH, files=AUDIO)
    assert r.status_code == 200 and r.json()["text"] == "مرحبا"
    assert seen["model"] == "groq/whisper-large-v3"


async def test_elevenlabs_listens_when_chosen(client, monkeypatch):
    from rafiq_agent.motion import media

    await _groq_model()
    settings = (await client.get("/settings", headers=AUTH)).json()
    await client.put("/settings", headers=AUTH, json={**settings, "listen_provider": "elevenlabs"})
    r = await client.post("/transcribe", headers=AUTH, files=AUDIO)
    assert r.status_code == 400 and "ElevenLabs" in r.json()["detail"]

    monkeypatch.setattr(media, "secret", lambda name: "el-test" if name == "elevenlabs" else None)
    calls = []

    async def fake(data, filename, key):
        calls.append(key)
        return "كيفك"

    monkeypatch.setattr(voice, "elevenlabs_transcribe", fake)
    r = await client.post("/transcribe", headers=AUTH, files=AUDIO)
    assert r.status_code == 200 and r.json()["text"] == "كيفك" and calls == ["el-test"]


async def test_a_chosen_provider_without_a_model_says_so(client):
    settings = (await client.get("/settings", headers=AUTH)).json()
    await client.put("/settings", headers=AUTH, json={**settings, "listen_provider": "azure"})
    r = await client.post("/transcribe", headers=AUTH, files=AUDIO)
    assert r.status_code == 400 and "Azure" in r.json()["detail"]
