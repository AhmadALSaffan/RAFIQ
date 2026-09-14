"""AuthAI stays optional and isolated: off by default, secrets never echoed, the documented
relay API only, and Rafiq keeps working if the module is missing."""

import importlib
import json
import sys

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
JWT = "eyJhbGciOiJIUzI1NiJ9.eyJwcm92Ijoib3BlbmFpIn0.sig-for-tests-000000"


@pytest.fixture(autouse=True)
def memory_keyring(monkeypatch):
    vault: dict[tuple[str, str], str] = {}
    monkeypatch.setattr("keyring.set_password", lambda s, k, v: vault.__setitem__((s, k), v))
    monkeypatch.setattr("keyring.get_password", lambda s, k: vault.get((s, k)))
    monkeypatch.setattr("keyring.delete_password", lambda s, k: vault.pop((s, k), None))
    return vault


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    # Leave AuthAI off for the rest of the suite.
    from rafiq_agent.auth.experimental.authai import AuthAIConfig, save_config

    await save_config(AuthAIConfig())


def _relay(seen: list) -> httpx.MockTransport:
    polls = iter([{"status": "pending"}, {"status": "complete", "jwt": JWT}])

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, dict(request.headers), request.content))
        path = request.url.path
        if path == "/auth/start":
            return httpx.Response(
                200,
                json={
                    "sessionId": "sess-1",
                    "provider": "openai",
                    "userCode": "WXYZ-1234",
                    "verificationUrl": "https://auth.openai.com/codex/device",
                    "expiresInMs": 900000,
                    "pollIntervalMs": 5000,
                },
            )
        if path == "/auth/poll/sess-1":
            return httpx.Response(200, json=next(polls))
        if path == "/auth/whoami":
            return httpx.Response(
                200, json={"user": {"id": "u_abcdef123", "provider": "openai"}, "session": {}}
            )
        if path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "gpt-5-codex"}]})
        if path == "/auth/revoke":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_off_by_default_and_refuses_to_start(client):
    providers = {p["id"]: p for p in (await client.get("/accounts/providers", headers=AUTH)).json()}
    assert providers["authai"]["available"] is False and providers["authai"]["experimental"] is True
    assert (await client.post("/accounts/authai/connect?target=openai", headers=AUTH)).status_code == 400


async def test_config_keeps_the_secret_write_only(client, memory_keyring):
    saved = await client.put(
        "/accounts/authai/config",
        headers=AUTH,
        json={"enabled": True, "relay_url": "https://relay.example.test", "secret": "app-secret-123456"},
    )
    assert saved.status_code == 200
    assert "app-secret-123456" not in saved.text and saved.json()["has_secret"] is True
    assert "app-secret-123456" not in (await client.get("/accounts/authai/config", headers=AUTH)).text
    assert "app-secret-123456" in memory_keyring.values()

    bad = await client.put(
        "/accounts/authai/config", headers=AUTH, json={"enabled": True, "relay_url": "http://evil.test"}
    )
    assert bad.status_code == 400  # plain http only for a local relay


async def test_sign_in_use_with_an_agent_and_revoke(client, monkeypatch, memory_keyring):
    from rafiq_agent.auth import registry
    from rafiq_agent.auth.experimental.authai import AuthAIAdapter
    from rafiq_agent.auth.resolve import llm_for

    seen: list = []
    monkeypatch.setitem(registry.ADAPTERS, "authai", AuthAIAdapter(transport=_relay(seen)))
    await client.put(
        "/accounts/authai/config",
        headers=AUTH,
        json={"enabled": True, "relay_url": "https://relay.example.test", "secret": "app-secret-123456"},
    )

    start = (await client.post("/accounts/authai/connect?target=openai", headers=AUTH)).json()
    assert start["user_code"] == "WXYZ-1234" and start["kind"] == "device"
    method, path, headers, body = seen[0]
    assert (method, path) == ("POST", "/auth/start")
    assert json.loads(body) == {"provider": "openai"} and headers["x-authai-secret"] == "app-secret-123456"

    poll = f"/accounts/connect/{start['flow_id']}/poll"
    assert (await client.post(poll, headers=AUTH)).json()["status"] == "pending"
    done = (await client.post(poll, headers=AUTH)).json()
    assert done["status"] == "complete" and done["account"]["label"] == "ChatGPT · u_abcd"
    assert JWT not in json.dumps(done) and JWT in memory_keyring.values()

    account_id = done["account"]["id"]
    models = (
        await client.post(
            "/models/discover", headers=AUTH, json={"provider": "authai", "account_id": account_id}
        )
    ).json()
    assert models == [{"id": "gpt-5-codex", "display_name": "gpt-5-codex"}]

    created = await client.post(
        "/models",
        headers=AUTH,
        json={
            "name": "Codex via AuthAI",
            "provider": "authai",
            "model_id": "gpt-5-codex",
            "auth_method": "oauth",
            "account_id": account_id,
        },
    )
    assert created.status_code == 201, created.text

    async with SessionLocal() as session:
        model = await session.get(LlmModel, created.json()["id"])
    llm = llm_for(model)
    assert llm.model == "openai/gpt-5-codex"
    assert llm.base_url == "https://relay.example.test/v1"
    assert llm.api_key == JWT and llm.extra_headers == {"x-authai-secret": "app-secret-123456"}

    assert (await client.delete(f"/accounts/{account_id}", headers=AUTH)).status_code == 204
    assert any(p == "/auth/revoke" for _, p, _, _ in seen)
    assert JWT not in memory_keyring.values()


def test_rafiq_runs_without_the_experimental_module(monkeypatch):
    from rafiq_agent.auth import registry

    monkeypatch.setitem(sys.modules, "rafiq_agent.auth.experimental.authai", None)  # import now fails
    reloaded = importlib.reload(registry)
    try:
        assert "authai" not in reloaded.ADAPTERS
        assert {"github_copilot", "openrouter"} <= set(reloaded.ADAPTERS)
    finally:
        monkeypatch.delitem(sys.modules, "rafiq_agent.auth.experimental.authai")
        importlib.reload(registry)
