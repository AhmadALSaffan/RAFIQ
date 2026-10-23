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
