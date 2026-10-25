"""Sign in with ChatGPT: the Responses requests a plan accepts, the streamed reply read
back as Rafiq's events, and the sign-in callback (once, and a refusal stays a refusal)."""

import asyncio
import json

import httpx
import pytest

from rafiq_agent.auth import chatgpt as auth
from rafiq_agent.llm.chatgpt import ChatGPTError, ChatGPTProvider, to_responses, to_tools


def test_a_conversation_becomes_responses_input():
    messages = [
        {"role": "system", "content": "كن مختصراً"},
        {"role": "user", "content": [{"type": "text", "text": "شو بالصورة؟"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}]},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "note_read", "arguments": '{"path":"a.md"}'}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "# ملاحظة"},
    ]
    instructions, items = to_responses(messages)
    assert instructions == "كن مختصراً"
    assert [i["type"] for i in items] == ["message", "function_call", "function_call_output"]
    assert items[0]["content"][1] == {"type": "input_image", "image_url": "data:image/png;base64,AA"}
    assert items[1]["call_id"] == "c1" and items[2]["output"] == "# ملاحظة"
    # no system items: OpenAI refuses them on this route
    assert all(i.get("role") != "system" for i in items)
    tools = to_tools([{"type": "function", "function": {"name": "x", "description": "d", "parameters": {"type": "object"}}}])
    assert tools == [{"type": "function", "name": "x", "description": "d", "parameters": {"type": "object"}, "strict": False}]


def _sse(*events: dict) -> bytes:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


async def test_the_stream_becomes_text_and_tool_calls_with_plan_rules():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers["authorization"]
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=_sse(
                {"type": "response.reasoning_summary_text.delta", "delta": "أفكر"},
                {"type": "response.output_text.delta", "delta": "مرح"},
                {"type": "response.output_text.delta", "delta": "با"},
                {"type": "response.output_item.done", "item": {"type": "function_call", "call_id": "c9", "name": "notes_list", "arguments": "{}"}},
                {"type": "response.completed", "response": {"usage": {"input_tokens": 10, "output_tokens": 3}}},
            ),
        )

    provider = ChatGPTProvider("acc", "tok", "gpt-5.5", transport=httpx.MockTransport(handler))
    events = [e async for e in provider.stream_chat([{"role": "system", "content": "s"}, {"role": "user", "content": "hi"}], [{"type": "function", "function": {"name": "notes_list", "parameters": {}}}])]
    text = "".join(e.text_delta or "" for e in events)
    assert text == "مرحبا" and events[0].reasoning_delta == "أفكر"
    assert events[-1].finish_reason == "tool_calls" and events[-1].tool_calls[0].name == "notes_list"
    body = seen["body"]
    assert body["store"] is False and body["stream"] is True and body["instructions"] == "s"
    assert not {"temperature", "max_output_tokens", "previous_response_id"} & set(body)
    assert seen["auth"] == "Bearer tok"


async def test_plan_errors_are_explained():
    def limit(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "limit"}})

    provider = ChatGPTProvider("acc", "tok", "gpt-5.5", transport=httpx.MockTransport(limit))
    with pytest.raises(ChatGPTError) as err:
        [e async for e in provider.stream_chat([{"role": "user", "content": "hi"}], [])]
    assert err.value.kind == "chatgpt_usage_limit"

    def cut(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse({"type": "response.output_text.delta", "delta": "نص"}))

    provider = ChatGPTProvider("acc", "tok", "gpt-5.5", transport=httpx.MockTransport(cut))
    with pytest.raises(ChatGPTError):
        [e async for e in provider.stream_chat([{"role": "user", "content": "hi"}], [])]


async def test_a_limit_inside_the_stream_is_read_wherever_it_is_and_never_says_none():
    events = [
        {"type": "error", "error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "You've hit your usage limit."}},
        {"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}},
        {"type": "error", "error": {"type": "usage_limit_reached", "message": "The usage limit has been reached"}},
        {"type": "error"},
    ]
    kinds = []
    for event in events:
        def stream(_request: httpx.Request, event=event) -> httpx.Response:
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(event))

        provider = ChatGPTProvider("acc", "tok", "gpt-5.5", transport=httpx.MockTransport(stream))
        with pytest.raises(ChatGPTError) as err:
            [e async for e in provider.stream_chat([{"role": "user", "content": "hi"}], [])]
        assert "None" not in str(err.value)
        kinds.append(err.value.kind)
    assert kinds == ["chatgpt_usage_limit", "chatgpt_usage_limit", "chatgpt_usage_limit", "cant_reach"]


async def _get(url: str) -> int:
    async with httpx.AsyncClient() as http:
        return (await http.get(url)).status_code


async def test_the_sign_in_listens_once_and_a_refusal_is_a_refusal(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "DATA_DIR", tmp_path)
    discovery = {
        "issuer": auth.ISSUER,
        "authorization_endpoint": f"{auth.ISSUER}/api/accounts/authorize",
        "token_endpoint": f"{auth.ISSUER}/api/accounts/oauth/token",
        "jwks_uri": f"{auth.ISSUER}/.well-known/jwks.json",
    }
    adapter = auth.ChatGPTAdapter(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=discovery)))
    started = await adapter.start("")
    query = httpx.URL(started.verification_uri).params
    assert query["client_id"] == "dynamic_agent_client" and query["agent_name_hint"] == "Rafiq"
    assert query["scope"] == auth.SCOPES and query["resource"] == auth.RESOURCE
    assert query["code_challenge_method"] == "S256" and query["ext_agent_host_id"].startswith("urn:uuid:")
    redirect = query["redirect_uri"]
    assert redirect.startswith("http://127.0.0.1:") and redirect.endswith("/auth/callback")

    # A request with the wrong state doesn't touch the sign-in that's waiting.
    assert await _get(f"{redirect}?state=wrong&code=x") == 400
    assert (await adapter.poll(started.flow_id)).status == "pending"

    state = query["state"]
    assert await _get(f"{redirect}?state={state}&error=access_denied") == 200
    for _ in range(50):
        outcome = await adapter.poll(started.flow_id)
        if outcome.status != "pending":
            break
        await asyncio.sleep(0.02)
    assert outcome.status == "denied"
    # The listener has given its one answer.
    with pytest.raises(httpx.HTTPError):
        await _get(f"{redirect}?state={state}&code=again")


# ── Adding an agent on a ChatGPT plan ────────────────────────────────────────────────


def test_every_provider_the_app_offers_is_accepted_by_the_api():
    """The desktop's providers, and every sign-in adapter, pass the API's schema — one
    missing (as "chatgpt" was) turns fetching models and saving into a 422."""
    import re
    import typing
    from pathlib import Path

    from rafiq_agent.auth.registry import ADAPTERS
    from rafiq_agent.schemas.models import Provider

    accepted = set(typing.get_args(Provider))
    assert set(ADAPTERS) <= accepted
    types = Path(__file__).resolve().parents[2] / "desktop" / "src" / "lib" / "types.ts"
    union = re.search(r"export type Provider =(.*?);", types.read_text(encoding="utf-8"), re.S)
    assert union is not None
    assert set(re.findall(r'"([a-z_]+)"', union.group(1))) == accepted


@pytest.fixture()
def keychain(monkeypatch):
    vault: dict[tuple[str, str], str] = {}
    monkeypatch.setattr("keyring.set_password", lambda s, k, v: vault.__setitem__((s, k), v))
    monkeypatch.setattr("keyring.get_password", lambda s, k: vault.get((s, k)))
    monkeypatch.setattr("keyring.delete_password", lambda s, k: vault.pop((s, k), None))
    return vault


async def test_a_chatgpt_account_lists_its_models_and_saves_an_agent(monkeypatch, keychain):
    from httpx import ASGITransport

    from rafiq_agent.auth import registry
    from rafiq_agent.config import AUTH_TOKEN
    from rafiq_agent.main import app
    from rafiq_agent.storage.db import SessionLocal, init_db
    from rafiq_agent.storage.models import AuthAccount
    from rafiq_agent.storage.secrets import store_api_key

    def models(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        assert request.headers["authorization"] == "Bearer plan-token"
        return httpx.Response(200, json={"models": [
            {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list"},
            {"slug": "internal-only", "display_name": "Hidden", "visibility": "hide"},
        ]})

    monkeypatch.setitem(registry.ADAPTERS, "chatgpt", auth.ChatGPTAdapter(transport=httpx.MockTransport(models)))
    await init_db()
    async with SessionLocal() as session:
        account = AuthAccount(provider="chatgpt", external_id="user-1", label="me@example.com", secret_ref=store_api_key("plan-token"))
        session.add(account)
        await session.commit()
        account_id = account.id

    headers = {"authorization": f"Bearer {AUTH_TOKEN}"}
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        found = await client.post("/models/discover", headers=headers, json={"provider": "chatgpt", "account_id": account_id})
        assert found.status_code == 200, found.text
        assert [(m["id"], m["display_name"]) for m in found.json()] == [("gpt-6.1-sol", "GPT-6.1 Sol")]

        body = {"name": "Sol", "provider": "chatgpt", "model_id": "gpt-6.1-sol", "auth_method": "oauth", "account_id": account_id}
        created = await client.post("/models", headers=headers, json=body)
        assert created.status_code == 201, created.text
        assert created.json()["provider"] == "chatgpt" and created.json()["auth_method"] == "oauth"

        refused = await client.post("/models", headers=headers, json={**body, "model_id": "internal-only"})
        assert refused.status_code == 400 and isinstance(refused.json()["detail"], str)


def test_plan_usage_keeps_only_what_it_sees(tmp_path, monkeypatch):
    from rafiq_agent.llm import plan_usage

    monkeypatch.setattr(plan_usage, "DATA_DIR", tmp_path)
    # nothing seen yet: no figure invented
    assert plan_usage.summary("acc")["used_percent"] is None
    # the codex header family
    windows = plan_usage.windows_from({"X-Codex-Primary-Used-Percent": "37.5", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "1200"})
    assert windows == [{"name": "primary", "used_percent": 37.5, "window_minutes": 300.0, "resets_in_seconds": 1200.0}]
    # the usual rate-limit pair
    pair = plan_usage.windows_from({"x-ratelimit-limit-requests": "100", "x-ratelimit-remaining-requests": "25", "x-ratelimit-reset-requests": "1m30s"})
    assert pair[0]["used_percent"] == 75 and pair[0]["resets_in_seconds"] == 90
    assert plan_usage.windows_from({"content-type": "text/event-stream"}) == []

    plan_usage.observe("acc", {"x-codex-primary-used-percent": "62"})
    plan_usage.record("acc", 1000, 200)
    plan_usage.record("acc", 10, 5)
    s = plan_usage.summary("acc")
    assert s["used_percent"] == 62 and s["today"] == {"requests": 2, "tokens": 1215} and s["week"]["requests"] == 2
    plan_usage.limit_hit("acc")
    assert plan_usage.summary("acc")["limited"] is True
    plan_usage.ok("acc")
    assert plan_usage.summary("acc")["limited"] is False


def test_plan_usage_estimates_when_the_plan_reports_nothing(tmp_path, monkeypatch):
    from rafiq_agent.llm import plan_usage

    monkeypatch.setattr(plan_usage, "DATA_DIR", tmp_path)
    clock = [1_000_000.0]
    monkeypatch.setattr(plan_usage.time, "time", lambda: clock[0])
    plan_usage.record("acc", 600, 200)
    # no limit seen yet: nothing to measure against, but the window's tokens are known
    s = plan_usage.summary("acc")
    assert s["used_percent"] is None and s["window_tokens"] == 800 and s["estimated"] is False
    plan_usage.record("acc", 150, 50)
    plan_usage.limit_hit("acc")  # 1000 tokens filled the window
    assert plan_usage.summary("acc")["used_percent"] == 100
    plan_usage.limit_hit("acc")  # a retry right after: not a second sample
    plan_usage.ok("acc")
    clock[0] += 6 * 3600  # the window has rolled over
    plan_usage.record("acc", 200, 50)
    s = plan_usage.summary("acc")
    assert s["estimated"] is True and s["capacity"] == 1000 and s["used_percent"] == 25
    plan_usage.record("acc", 2000, 0)  # past the measure, but replies still come
    assert plan_usage.summary("acc")["used_percent"] == 99
    # another account on the same plan type borrows the measure until it has its own
    assert plan_usage.summary("other")["capacity"] == 1000
