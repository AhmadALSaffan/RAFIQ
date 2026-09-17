"""Sign-in layer: agents stay isolated, secrets never leave the keychain, device flow
handles every GitHub answer, and the Copilot bridge feeds tool calls through Rafiq's loop."""

import asyncio
import json

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.auth.base import AuthError, Credentials, redact
from rafiq_agent.auth.github_copilot import GitHubCopilotAdapter
from rafiq_agent.auth.resolve import credentials_for
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import AuthAccount, LlmModel

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture(autouse=True)
def memory_keyring(monkeypatch):
    """Keep the suite out of the real Windows Credential Manager."""
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


async def _account(provider: str, label: str, token: str) -> str:
    from rafiq_agent.storage.secrets import store_api_key

    async with SessionLocal() as session:
        account = AuthAccount(
            provider=provider, external_id=label, label=label, secret_ref=store_api_key(token)
        )
        session.add(account)
        await session.commit()
        return account.id


async def _agent(name: str, **fields) -> str:
    async with SessionLocal() as session:
        model = LlmModel(name=name, provider=fields.pop("provider", "github_copilot"), model_id="m", **fields)
        session.add(model)
        await session.commit()
        return model.id


async def _load(model_id: str) -> LlmModel:
    async with SessionLocal() as session:
        return await session.get(LlmModel, model_id)


# ── Redaction ────────────────────────────────────────────────────────────────────────


def test_redact_scrubs_provider_tokens():
    text = "failed with gho_abcdefghijklmnopqrstuv and Bearer sk-1234567890abcdefXYZ"
    out = redact(text)
    assert "gho_" not in out and "sk-1234" not in out
    assert out.count("<redacted>") == 2


def test_credentials_never_print_the_key():
    assert "super-secret" not in repr(Credentials(api_key="super-secret-token-value"))


# ── Isolation between agents ─────────────────────────────────────────────────────────


async def test_api_key_agents_resolve_exactly_as_before(client):
    from rafiq_agent.storage.secrets import store_api_key

    model_id = await _agent("Keyed", provider="openai", api_key_ref=store_api_key("sk-key-A"))
    assert credentials_for(await _load(model_id)).api_key == "sk-key-A"


async def test_each_agent_uses_its_own_account_and_disconnect_touches_only_it(client):
    acc_a = await _account("github_copilot", "alice", "gho_token_for_alice_000000")
    acc_b = await _account("github_copilot", "bob", "gho_token_for_bob_00000000")
    agent_a = await _agent("Agent A", auth_method="oauth", account_id=acc_a)
    agent_b = await _agent("Agent B", auth_method="oauth", account_id=acc_b)

    assert credentials_for(await _load(agent_a)).api_key == "gho_token_for_alice_000000"
    assert credentials_for(await _load(agent_b)).api_key == "gho_token_for_bob_00000000"

    assert (await client.delete(f"/accounts/{acc_a}", headers=AUTH)).status_code == 204

    with pytest.raises(AuthError):
        credentials_for(await _load(agent_a))  # never falls back to bob or a key
    assert credentials_for(await _load(agent_b)).api_key == "gho_token_for_bob_00000000"

    # Still bound, so the row stays (reconnecting alice revives Agent A) — without a token.
    accounts = {a["id"]: a for a in (await client.get("/accounts", headers=AUTH)).json()}
    assert accounts[acc_a]["status"] == "disconnected"
    assert accounts[acc_b]["status"] == "connected"


async def test_unused_account_is_removed_on_disconnect(client, memory_keyring):
    acc = await _account("github_copilot", "carol", "gho_token_for_carol_0000000")
    assert (await client.delete(f"/accounts/{acc}", headers=AUTH)).status_code == 204
    ids = [a["id"] for a in (await client.get("/accounts", headers=AUTH)).json()]
    assert acc not in ids
    assert "gho_token_for_carol_0000000" not in memory_keyring.values()


async def test_no_response_ever_contains_a_token(client):
    acc = await _account("github_copilot", "dana", "gho_token_for_dana_00000000")
    await _agent("Agent D", auth_method="oauth", account_id=acc)
    for path in ("/accounts", "/models", "/accounts/providers"):
        body = (await client.get(path, headers=AUTH)).text
        assert "gho_token_for_dana" not in body
    models = (await client.get("/models", headers=AUTH)).json()
    agent = next(m for m in models if m["name"] == "Agent D")
    assert agent["account_label"] == "dana" and agent["auth_method"] == "oauth"


# ── GitHub device flow ───────────────────────────────────────────────────────────────


def _github(responses: dict[str, list[dict]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        queue = responses[request.url.path]
        return httpx.Response(200, json=queue.pop(0) if len(queue) > 1 else queue[0])

    return httpx.MockTransport(handler)


async def test_device_flow_disabled_is_explained():
    adapter = GitHubCopilotAdapter(
        "cid", transport=_github({"/login/device/code": [{"error": "device_flow_disabled"}]})
    )
    with pytest.raises(AuthError, match="Device Flow"):
        await adapter.start()


async def test_device_flow_pending_slow_down_then_complete(monkeypatch):
    transport = _github(
        {
            "/login/device/code": [
                {
                    "device_code": "dc",
                    "user_code": "ABCD-1234",
                    "verification_uri": "https://github.com/login/device",
                    "interval": 0,
                    "expires_in": 900,
                }
            ],
            "/login/oauth/access_token": [
                {"error": "authorization_pending"},
                {"error": "slow_down", "interval": 0},
                {"access_token": "gho_issued_token_1234567890", "token_type": "bearer"},
            ],
            "/user": [{"id": 42, "login": "octo"}],
        }
    )
    adapter = GitHubCopilotAdapter("cid", transport=transport)

    async def fine(token: str) -> None:
        return None

    monkeypatch.setattr(adapter, "check", fine)

    start = await adapter.start()
    assert start.user_code == "ABCD-1234"
    assert (await adapter.poll(start.flow_id)).status == "pending"
    assert (await adapter.poll(start.flow_id)).status == "pending"
    done = await adapter.poll(start.flow_id)
    assert done.status == "complete"
    assert done.identity.label == "octo" and done.identity.external_id == "42"
    assert (await adapter.poll(start.flow_id)).status == "expired"  # one-shot


async def test_device_flow_denied():
    transport = _github(
        {
            "/login/device/code": [{"device_code": "dc", "user_code": "X", "interval": 0, "expires_in": 900}],
            "/login/oauth/access_token": [{"error": "access_denied"}],
        }
    )
    adapter = GitHubCopilotAdapter("cid", transport=transport)
    start = await adapter.start()
    assert (await adapter.poll(start.flow_id)).status == "denied"


# ── Copilot bridge ───────────────────────────────────────────────────────────────────


async def test_copilot_tool_calls_run_through_rafiqs_loop(monkeypatch):
    pytest.importorskip("copilot")
    from copilot.session_events import AssistantMessageDeltaData, SessionIdleData

    from rafiq_agent.core.loop import LoopCallbacks, run_agent_loop
    from rafiq_agent.llm import copilot as bridge
    from rafiq_agent.tools.base import Tool, ToolRegistry, ToolResult

    class Event:
        def __init__(self, data):
            self.data = data

    class FakeSession:
        def __init__(self, options):
            self.options = options
            self.sent: list[str] = []
            self.disconnected = False

        def emit(self, data):
            self.options["on_event"](Event(data))

        async def send(self, prompt: str) -> str:
            self.sent.append(prompt)

            async def run():
                self.emit(AssistantMessageDeltaData.from_dict({"deltaContent": "بشوف… ", "messageId": "m1"}))
                tool = self.options["tools"][0]

                class Invocation:
                    tool_call_id = "call_1"
                    arguments = {"path": "."}

                result = await tool.handler(Invocation())
                self.emit(
                    AssistantMessageDeltaData.from_dict(
                        {"deltaContent": f"النتيجة: {result.text_result_for_llm}", "messageId": "m2"}
                    )
                )
                self.emit(SessionIdleData.from_dict({}))

            asyncio.get_running_loop().create_task(run())
            return "msg"

        async def disconnect(self):
            self.disconnected = True

    sessions: list[FakeSession] = []

    class FakeClient:
        async def create_session(self, **options):
            sessions.append(FakeSession(options))
            return sessions[-1]

    async def fake_client_for(account_id, token):
        return FakeClient()

    monkeypatch.setattr(bridge, "client_for", fake_client_for)

    class ListTool(Tool):
        name = "filesystem_list"
        category = "read_only"
        description = "list"
        parameters = {"type": "object", "properties": {"path": {"type": "string"}}}

        async def run(self, args):
            return ToolResult(ok=True, output="a.txt")

    registry = ToolRegistry()
    registry.register(ListTool())
    asked: list[str] = []

    async def permit(name, category, args, preview=None):
        asked.append(name)
        return True

    provider = bridge.CopilotProvider(account_id="acc", token="gho_x", model_id="gpt-5")
    messages = [{"role": "system", "content": "sys"}, {"role": "user", "content": "شو في؟"}]
    result = await run_agent_loop(provider, messages, registry, LoopCallbacks(permit=permit))

    session = sessions[0]
    assert asked == ["filesystem_list"]  # Rafiq's permission gate ran
    # Copilot's shell, file and editing tools are never offered — only Rafiq's, plus the
    # built-ins Rafiq deliberately leaves to Copilot (checked below).
    assert "custom:filesystem_list" in session.options["available_tools"].to_list()
    # Each session authenticates itself; the client's own token isn't enough for the
    # runtime to resolve the model.
    assert session.options["github_token"] == "gho_x"
    assert session.options["system_message"] == {"mode": "replace", "content": "sys"}
    assert "النتيجة: a.txt" in result.text
    assert session.disconnected  # released when the loop ended
    assert json.loads(messages[2]["tool_calls"][0]["function"]["arguments"]) == {"path": "."}
    # Copilot brings its own web_fetch, so Rafiq leaves that one to it (and stops the SDK
    # refusing the session over the duplicate name) while keeping its own tools custom.
    entries = session.options["available_tools"].to_list()
    assert entries == ["custom:filesystem_list", "builtin:web_fetch", "builtin:web_search"]


async def test_copilots_own_web_fetch_still_asks_rafiqs_permission():
    pytest.importorskip("copilot")
    from copilot.generated.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject

    from rafiq_agent.llm.copilot import CopilotProvider

    asked: list[tuple[str, dict]] = []

    async def permit(name, category, args, preview=None):
        asked.append((name, args))
        return args["url"].startswith("https://")

    provider = CopilotProvider(account_id="acc", token="gho_x", model_id="gpt-5")

    class UrlRequest:
        kind = "url"
        url = "https://example.com/docs"

    # Without the loop's gate nothing Copilot runs on its own is approved.
    assert isinstance(await provider._on_permission(UrlRequest(), {}), PermissionDecisionReject)

    provider.set_permission_hook(permit)
    assert isinstance(await provider._on_permission(UrlRequest(), {}), PermissionDecisionApproveOnce)
    assert asked == [("web_fetch", {"url": "https://example.com/docs"})]

    class Blocked(UrlRequest):
        url = "http://insecure.example"

    assert isinstance(await provider._on_permission(Blocked(), {}), PermissionDecisionReject)

    # Copilot's other built-ins were never offered, and stay refused whatever it asks.
    class ShellRequest:
        kind = "shell"

    assert isinstance(await provider._on_permission(ShellRequest(), {}), PermissionDecisionReject)


async def test_a_model_with_its_own_tool_is_not_given_rafiqs():
    from rafiq_agent.core.agent_runtime import build_registry
    from rafiq_agent.llm.presets import native_tools
    from rafiq_agent.schemas.settings import AppSettings

    settings = AppSettings()
    plain = await build_registry(None, settings, native_tools("openai", "gpt-5"))
    copilot_side = await build_registry(None, settings, native_tools("github_copilot", "gpt-5"))
    try:
        assert "web_fetch" in [s["function"]["name"] for s in plain.schemas()]
        assert "web_fetch" not in [s["function"]["name"] for s in copilot_side.schemas()]
    finally:
        await plain.aclose()
        await copilot_side.aclose()


# ── OpenRouter PKCE ──────────────────────────────────────────────────────────────────


def _openrouter(seen: dict) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/auth/keys":
            seen["exchange"] = json.loads(request.content)
            if seen["exchange"].get("code") != "good-code":
                return httpx.Response(403, json={"error": "invalid code"})
            return httpx.Response(200, json={"key": "sk-or-v1-issued-key-abcd1234"})
        if request.url.path == "/api/v1/key":
            return httpx.Response(200, json={"data": {"label": "Rafiq"}})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_openrouter_pkce_challenge_matches_the_verifier_it_keeps():
    import base64
    import hashlib
    from urllib.parse import parse_qs, urlparse

    from rafiq_agent.auth.openrouter import OpenRouterAdapter

    seen: dict = {}
    adapter = OpenRouterAdapter(transport=_openrouter(seen))
    start = await adapter.start("http://127.0.0.1:9999/accounts/callback/openrouter")
    query = parse_qs(urlparse(start.verification_uri).query)
    assert start.kind == "browser" and not start.user_code
    assert query["callback_url"] == [f"http://127.0.0.1:9999/accounts/callback/openrouter/{start.flow_id}"]
    assert query["code_challenge_method"] == ["S256"]

    assert await adapter.receive(start.flow_id, "good-code")
    verifier = seen["exchange"]["code_verifier"]
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert query["code_challenge"] == [expected]  # the verifier never left the process until exchange

    done = await adapter.poll(start.flow_id)
    assert done.status == "complete" and done.identity.label == "OpenRouter …1234"
    assert not await adapter.receive(start.flow_id, "good-code")  # single use


async def test_openrouter_rejected_code_is_reported():
    from rafiq_agent.auth.openrouter import OpenRouterAdapter

    adapter = OpenRouterAdapter(transport=_openrouter({}))
    start = await adapter.start("http://127.0.0.1:9999/accounts/callback/openrouter")
    assert await adapter.receive(start.flow_id, "bad-code")
    assert (await adapter.poll(start.flow_id)).status == "error"


async def test_openrouter_connect_through_the_api_and_use_it_for_an_agent(
    client, monkeypatch, memory_keyring
):
    from rafiq_agent.auth import registry
    from rafiq_agent.auth.openrouter import OpenRouterAdapter
    from rafiq_agent.llm.discovery import VerifyResult

    monkeypatch.setitem(registry.ADAPTERS, "openrouter", OpenRouterAdapter(transport=_openrouter({})))

    start = (await client.post("/accounts/openrouter/connect", headers=AUTH)).json()
    assert start["kind"] == "browser"

    # The browser has no bearer token — the callback must still work, but only for this flow.
    assert (await client.get("/accounts/callback/openrouter/not-a-flow?code=good-code")).status_code == 400
    page = await client.get(f"/accounts/callback/openrouter/{start['flow_id']}?code=good-code")
    assert page.status_code == 200 and "sk-or" not in page.text

    polled = (await client.post(f"/accounts/connect/{start['flow_id']}/poll", headers=AUTH)).json()
    assert polled["status"] == "complete"
    assert "sk-or-v1-issued-key-abcd1234" not in json.dumps(polled)
    assert "sk-or-v1-issued-key-abcd1234" in memory_keyring.values()

    async def fake_verify(provider, model_id, api_key, base_url):
        assert (provider, api_key) == ("openrouter", "sk-or-v1-issued-key-abcd1234")
        return VerifyResult(True, 5, True, None)

    monkeypatch.setattr("rafiq_agent.api.models.verify_model", fake_verify)
    created = await client.post(
        "/models",
        headers=AUTH,
        json={
            "name": "OR agent",
            "provider": "openrouter",
            "model_id": "openai/gpt-5",
            "auth_method": "oauth",
            "account_id": polled["account"]["id"],
        },
    )
    assert created.status_code == 201, created.text
    agent = created.json()
    assert agent["auth_method"] == "oauth" and agent["account_label"] == "OpenRouter …1234"
    assert credentials_for(await _load(agent["id"])).api_key == "sk-or-v1-issued-key-abcd1234"
