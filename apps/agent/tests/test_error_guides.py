"""Every provider failure is sorted into a kind the app opens a guide for."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.auth.base import AuthError
from rafiq_agent.auth.github_copilot import GitHubCopilotAdapter
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.llm import copilot
from rafiq_agent.llm.errors import classify, error_event, explain
from rafiq_agent.main import app

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}

# The error a user got right after signing in, with Copilot not turned on for the account.
COPILOT_403 = (
    'copilot._jsonrpc.JsonRpcError: JSON-RPC Error -32603: Request models.list failed with message: '
    'GenericFailure, {"kind":"http","status":403,"statusText":"Forbidden","body":"unauthorized: not '
    'authorized to use this Copilot feature\\n","hasRequestId":true}'
)

# What GitHub answered a fresh sign-in with, several attempts in a row (the installed app's log).
COPILOT_DENIED = (
    'copilot._jsonrpc.JsonRpcError: JSON-RPC Error -32603: Request models.list failed with message: '
    'GenericFailure, {"kind":"http","status":403,"statusText":"Forbidden","body":"forbidden: access denied\n"}'
)


class Fake(Exception):
    def __init__(self, text: str, status: int | None = None, provider: str | None = None):
        super().__init__(text)
        self.status_code = status
        self.llm_provider = provider


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (COPILOT_403, "copilot_not_enabled"),
        (COPILOT_DENIED, "copilot_not_enabled"),
        # A 403 from another provider isn't mistaken for Copilot's.
        (Fake("Error code: 403 - Forbidden", 403, "openai"), None),
        (Fake("Country, region, or territory not supported", 403, "openai"), "region_blocked"),
        (Fake('{"error":{"code":"unsupported_country_region_territory"}}', 403, "openai"), "region_blocked"),
        (Fake("User location is not supported for the API use.", 400, "gemini"), "region_blocked"),
        (Fake("Request not allowed", 403, "anthropic"), "region_blocked"),
        (Fake("You exceeded your current quota, please check your plan and billing details.", 429, "openai"), "no_credit"),
        (Fake("Your credit balance is too low to access the Anthropic API.", 400, "anthropic"), "no_credit"),
        (Fake("Incorrect API key provided: sk-****", 401, "openai"), "bad_key"),
        (Fake("Rate limit reached for requests", 429, "openai"), "rate_limited"),
        (Fake("Cannot connect to host localhost:11434 Connection refused", None, "ollama"), "local_server_down"),
        (Fake("ConnectError: getaddrinfo failed", None, "openai"), "cant_reach"),
        (Fake("The model `gpt-9` does not exist", 404, "openai"), "model_not_found"),
        (Fake("a brand new kind of failure"), None),
    ],
)
def test_failures_are_sorted_into_kinds(error, kind):
    assert classify(error) == kind


def test_the_message_names_the_provider_and_the_event_carries_the_kind():
    message, kind = explain(Fake("unsupported_country_region_territory", 403, "openai"))
    assert kind == "region_blocked" and "OpenAI" in message and "VPN" in message
    event = error_event(Fake("Incorrect API key provided", 401), model="deepseek/deepseek-chat")
    assert event["kind"] == "bad_key" and event["provider"] == "DeepSeek"


def test_copilot_turned_off_is_not_mistaken_for_a_stale_runtime():
    # A stale runtime gets restarted and retried; «Copilot is off» can't be fixed that way.
    assert copilot.copilot_off(COPILOT_403)
    assert not copilot._is_auth_failure(COPILOT_403)
    assert copilot._is_auth_failure('Request session.create failed: {"status":401} Unauthorized')


async def test_signing_in_without_copilot_keeps_the_account_and_asks_for_the_guide(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/login/device/code":
            return httpx.Response(200, json={"device_code": "dc", "user_code": "U", "interval": 0, "expires_in": 900})
        if request.url.path == "/login/oauth/access_token":
            return httpx.Response(200, json={"access_token": "gho_x"})
        return httpx.Response(200, json={"id": 1, "login": "octo"})

    adapter = GitHubCopilotAdapter("cid", transport=httpx.MockTransport(handler))

    async def copilot_is_off(token: str) -> None:
        raise AuthError("Copilot off", kind="copilot_not_enabled")

    monkeypatch.setattr(adapter, "check", copilot_is_off)
    start = await adapter.start()
    done = await adapter.poll(start.flow_id)
    assert done.status == "complete" and done.identity.label == "octo"
    assert done.kind == "copilot_not_enabled"


async def test_the_api_answers_a_failure_with_its_kind(monkeypatch):
    from rafiq_agent.api import models as api
    from rafiq_agent.llm.discovery import DiscoveryError

    async def blocked(provider, api_key, base_url, options=None):
        raise DiscoveryError("blocked", kind="region_blocked")

    monkeypatch.setattr(api, "discover_models", blocked)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/models/discover", json={"provider": "openai", "api_key": "sk-test"}, headers=AUTH)
    assert r.status_code == 400
    assert r.json() == {"detail": "blocked", "kind": "region_blocked", "provider": "OpenAI"}
