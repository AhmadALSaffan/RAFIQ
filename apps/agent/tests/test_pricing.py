"""What a model costs, shown before it's picked."""

import json
import time

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.llm import pricing
from rafiq_agent.main import app

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def test_prices_per_million_tokens_by_kind():
    claude = pricing.price_for("anthropic", "claude-sonnet-4-5")
    assert claude.kind == "paid" and claude.input == 3.0 and claude.output == 15.0
    assert pricing.price_for("ollama", "llama3").kind == "free"
    assert pricing.price_for("lm_studio", "anything").kind == "free"
    assert pricing.price_for("github_copilot", "gpt-5").kind == "subscription"
    assert pricing.price_for("custom", "my-own-model").kind == "unknown"


def test_openrouter_prices_come_from_its_own_list():
    paid = pricing.from_openrouter({"prompt": "0.000003", "completion": "0.000015"})
    assert paid.kind == "paid" and paid.input == 3.0 and paid.output == 15.0
    assert pricing.from_openrouter({"prompt": "0", "completion": "0"}).kind == "free"
    assert pricing.from_openrouter(None) is None


def test_a_fetched_table_is_kept_and_used_after_a_restart(monkeypatch):
    import litellm

    table = {"rafiq-test/brand-new-model": {"input_cost_per_token": 0.000002, "output_cost_per_token": 0.000008, "litellm_provider": "openai", "mode": "chat"}}
    pricing._cache_path().write_text(json.dumps({"fetched_at": time.time(), "table": table}), encoding="utf-8")
    monkeypatch.setattr(litellm, "model_cost", dict(litellm.model_cost))
    assert pricing.load_cached() == 1
    assert pricing.updated_at() is not None
    new = pricing.price_for("custom", "rafiq-test/brand-new-model")
    assert new.kind == "paid" and new.input == 2.0 and new.output == 8.0


async def test_refresh_waits_a_day_and_keeps_the_old_table_when_offline(monkeypatch):
    pricing._cache_path().write_text(json.dumps({"fetched_at": time.time(), "table": {}}), encoding="utf-8")
    assert await pricing.refresh() is False  # fetched today already

    class Offline:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            raise httpx.ConnectError("offline")

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(httpx, "AsyncClient", Offline)
    assert await pricing.refresh(force=True) is False


async def test_discovered_models_carry_their_price(client, monkeypatch):
    from rafiq_agent.api import models as api
    from rafiq_agent.llm.discovery import DiscoveredModel

    async def fake_discover(provider, api_key, base_url, options=None):
        return [DiscoveredModel(id="claude-sonnet-4-5", display_name="Claude Sonnet 4.5"), DiscoveredModel(id="mystery", display_name="Mystery")]

    monkeypatch.setattr(api, "discover_models", fake_discover)
    r = await client.post("/models/discover", json={"provider": "anthropic", "api_key": "sk-test"}, headers=AUTH)
    assert r.status_code == 200, r.text
    by_id = {m["id"]: m["price"] for m in r.json()}
    assert by_id["claude-sonnet-4-5"]["kind"] == "paid" and by_id["claude-sonnet-4-5"]["output"] == 15.0
    assert by_id["mystery"]["kind"] == "unknown"
    status = await client.get("/models/pricing", headers=AUTH)
    assert status.status_code == 200 and "updated_at" in status.json()
