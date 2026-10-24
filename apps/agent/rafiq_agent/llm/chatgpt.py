"""A ChatGPT plan as Rafiq's model: the public Responses API with the access token from
"Sign in with ChatGPT" (auth/chatgpt.py), under the rules OpenAI sets for plan usage
(https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference):

* every request is `store: false, stream: true`, and carries the whole conversation in
  `input` (no `previous_response_id`);
* the system prompt goes in `instructions` (system items are refused);
* `temperature`, `max_output_tokens` and the like are not accepted, so they're never sent;
* function tools work; the reply streams as Responses events.

The rest of Rafiq speaks Chat Completions, so this provider translates both ways, and has
the same surface as `LlmProvider`: `model`, `stream_chat`, `complete`, `aclose`.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from rafiq_agent.auth.chatgpt import MANAGE_USAGE_URL, RESOURCE
from rafiq_agent.i18n import tr
from rafiq_agent.llm import plan_usage
from rafiq_agent.llm.base import StreamEvent, ToolCallDelta

RESPONSES_URL = f"{RESOURCE}/responses"
log = logging.getLogger(__name__)


class ChatGPTError(Exception):
    """A ChatGPT plan refusal, in words; `kind` opens the matching guide in the app."""

    def __init__(self, message: str, kind: str | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code


def _fields(data: Any) -> tuple[str | None, str]:
    """An error's code and message wherever the event keeps them: at its top, under
    `error`, or under `response.error` (the stream nests them differently by event)."""
    places = [data]
    if isinstance(data, dict):
        places += [data.get("error"), (data.get("response") or {}).get("error") if isinstance(data.get("response"), dict) else None]
    code: str | None = None
    message = ""
    for place in places:
        if not isinstance(place, dict):
            continue
        code = code or (place.get("code") if isinstance(place.get("code"), str) else None) or (place.get("type") if place.get("type") not in (None, "error", "response.failed") else None)
        message = message or (place.get("message") if isinstance(place.get("message"), str) else "")
    return code, message


_LIMIT_WORDS = ("usage limit", "usage_limit", "rate limit", "rate_limit", "quota", "limit exceeded", "too many requests")


def _error(code: str | None, status: int | None, detail: str = "") -> ChatGPTError:
    """OpenAI's plan-usage error codes, as the docs ask each one to be handled."""
    said = f"{code or ''} {detail}".lower()
    if code == "subscription_sharing_usage_limit_exceeded" or status == 429 or any(w in said for w in _LIMIT_WORDS):
        return ChatGPTError(
            tr(
                "OpenAI وقّفت طلبات رفيق على خطة ChatGPT لهلق (حد الخطة أو الحد اللي حاطّه لرفيق). التفاصيل بإعدادات ChatGPT ← الاستخدام."
            ),
            "chatgpt_usage_limit",
            code,
        )
    if code == "subscription_sharing_user_not_eligible":
        return ChatGPTError(
            tr("حساب ChatGPT هاد ما بيقدر يستخدم خطته بتطبيقات تانية (الخطة أو المنطقة)."),
            "chatgpt_not_eligible",
            code,
        )
    if (
        code in ("subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable")
        or status == 503
    ):
        return ChatGPTError(tr("خدمة ChatGPT مش متاحة هلق — جرّب كمان شوي."), "cant_reach", code)
    if code == "subscription_sharing_unsupported_capability":
        return ChatGPTError(tr("خطة ChatGPT ما بتدعم شي بهالطلب: {0}", detail or code), None, code)
    if code == "subscription_sharing_invalid_user" or status == 401:
        return ChatGPTError(
            tr("تسجيل الدخول بـ ChatGPT انتهى — سجّل دخول من جديد من الإعدادات ← الحسابات المتصلة."),
            "chatgpt_signed_out",
            code,
        )
    if status == 403:
        return ChatGPTError(
            tr("ChatGPT رفض الطلب: {0}", detail or code or "403"), "chatgpt_not_eligible", code
        )
    reason = detail or code or (f"HTTP {status}" if status else "")
    if not reason:
        return ChatGPTError(tr("ChatGPT وقّف الرد بدون ما يقول السبب — جرّب مرة تانية، أو كمّل بموديل تاني."), "cant_reach", code)
    return ChatGPTError(tr("ChatGPT رجّع خطأ: {0}", reason), None, code)


# ── Chat Completions → Responses ──────────────────────────────────────────────────────


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""


def _user_parts(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    parts: list[dict[str, Any]] = []
    for part in content or []:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            parts.append({"type": "input_text", "text": part.get("text", "")})
        elif part.get("type") == "image_url":
            image = part.get("image_url")
            url = image.get("url") if isinstance(image, dict) else image
            if url:
                parts.append({"type": "input_image", "image_url": url})
    return parts or [{"type": "input_text", "text": ""}]


def to_responses(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """(instructions, input items) for a Chat Completions conversation."""
    instructions: list[str] = []
    items: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        if role in ("system", "developer"):
            text = _text(m.get("content"))
            if text:
                instructions.append(text)
        elif role == "user":
            items.append({"type": "message", "role": "user", "content": _user_parts(m.get("content"))})
        elif role == "assistant":
            text = _text(m.get("content"))
            if text:
                items.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": text}],
                    }
                )
            for call in m.get("tool_calls") or []:
                fn = call.get("function") or {}
                items.append(
                    {
                        "type": "function_call",
                        "call_id": call.get("id") or "",
                        "name": fn.get("name") or "",
                        "arguments": fn.get("arguments") or "{}",
                    }
                )
        elif role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": m.get("tool_call_id") or "",
                    "output": _text(m.get("content")),
                }
            )
    return "\n\n".join(instructions), items


def to_tools(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    out = []
    for tool in tools or []:
        fn = tool.get("function") if tool.get("type") == "function" else None
        if not fn:
            continue
        out.append(
            {
                "type": "function",
                "name": fn.get("name"),
                "description": fn.get("description") or "",
                "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
                "strict": False,
            }
        )
    return out


# ── The provider ──────────────────────────────────────────────────────────────────────


class ChatGPTProvider:
    """Same surface as `LlmProvider`: `model`, `complete`, `stream_chat`, `aclose`."""

    def __init__(
        self,
        account_id: str,
        token: str,
        model_id: str,
        reasoning_effort: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        from rafiq_agent.core.context import window_for

        # Not "chatgpt/…": litellm has a provider of that name, and asking it about such a model
        # (a price, a capability) starts its own blocking sign-in.
        self.model = f"chatgpt-plan/{model_id}"
        self._model_id = model_id
        self._account_id = account_id
        self._token = token
        self._effort = reasoning_effort
        self._transport = transport
        self.context_window = window_for("openai", model_id, None)
        self.max_tokens = None

    def __repr__(self) -> str:
        return f"ChatGPTProvider(model={self._model_id!r}, account_id={self._account_id!r})"

    def _noted(self, error: ChatGPTError) -> ChatGPTError:
        """A limit error is remembered for the account (the usage ring shows it)."""
        if error.kind == "chatgpt_usage_limit":
            plan_usage.limit_hit(self._account_id)
        return error

    def _body(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None) -> dict[str, Any]:
        instructions, items = to_responses(messages)
        body: dict[str, Any] = {
            "model": self._model_id,
            "input": items,
            "store": False,
            "stream": True,
        }
        if instructions:
            body["instructions"] = instructions
        converted = to_tools(tools)
        if converted:
            body["tools"] = converted
            body["tool_choice"] = "auto"
            body["parallel_tool_calls"] = True
        reasoning: dict[str, Any] = {"summary": "auto"}
        if self._effort and self._effort != "none":
            reasoning["effort"] = self._effort
        body["reasoning"] = reasoning
        return body

    async def _renewed_token(self) -> str | None:
        from rafiq_agent.auth.refresh import fresh_token

        token = await fresh_token(self._account_id, force=True)
        if token:
            self._token = token
        return token

    async def _events(self, body: dict[str, Any]) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """The response's server-sent events, as (type, data). A refused token is renewed
        once; a field the plan doesn't support is dropped and the request sent again."""
        renewed = False
        dropped: set[str] = set()
        while True:
            headers = {
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            }
            async with (
                httpx.AsyncClient(timeout=httpx.Timeout(30, read=300), transport=self._transport) as http,
                http.stream("POST", RESPONSES_URL, json=body, headers=headers) as resp,
            ):
                if resp.status_code >= 400:
                    raw = await resp.aread()
                    try:
                        data = json.loads(raw)
                    except ValueError:
                        data = {}
                    error = data.get("error") if isinstance(data, dict) else None
                    code = error.get("code") if isinstance(error, dict) else None
                    param = error.get("param") if isinstance(error, dict) else None
                    detail = (
                        (error.get("message") if isinstance(error, dict) else None)
                        or (data.get("detail") if isinstance(data, dict) else "")
                        or ""
                    )
                    if resp.status_code == 401 and not renewed and await self._renewed_token():
                        renewed = True
                        continue
                    top = str(param or "").split(".")[0].split("[")[0]
                    if (
                        code == "subscription_sharing_unsupported_capability"
                        and top in body
                        and top not in ("model", "input")
                        and top not in dropped
                    ):
                        dropped.add(top)
                        body = {k: v for k, v in body.items() if k != top}
                        if top == "tools":
                            body.pop("tool_choice", None)
                            body.pop("parallel_tool_calls", None)
                        continue
                    plan_usage.observe(self._account_id, dict(resp.headers))
                    raise self._noted(_error(code, resp.status_code, str(detail)[:300]))
                plan_usage.observe(self._account_id, dict(resp.headers))
                kind = ""
                async for line in resp.aiter_lines():
                    if line.startswith("event:"):
                        kind = line[6:].strip()
                    elif line.startswith("data:"):
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            data = json.loads(payload)
                        except ValueError:
                            continue
                        yield (data.get("type") or kind), data
                return

    async def stream_chat(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> AsyncIterator[StreamEvent]:
        from rafiq_agent.llm import usage

        calls: list[ToolCallDelta] = []
        produced: list[str] = []
        finished = False
        truncated = False
        async for kind, data in self._events(self._body(messages, tools)):
            if kind == "response.output_text.delta":
                delta = data.get("delta") or ""
                produced.append(delta)
                yield StreamEvent(text_delta=delta)
            elif kind in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
                if self._effort != "none":
                    yield StreamEvent(reasoning_delta=data.get("delta") or "")
            elif kind == "response.reasoning_summary_part.done":
                yield StreamEvent(reasoning_delta="\n\n")
            elif kind == "response.output_item.done":
                item = data.get("item") or {}
                if item.get("type") == "function_call":
                    calls.append(
                        ToolCallDelta(
                            id=item.get("call_id") or item.get("id") or f"call_{len(calls)}",
                            name=item.get("name") or "",
                            arguments_json=item.get("arguments") or "{}",
                        )
                    )
            elif kind == "response.completed":
                finished = True
                usage.record(self.model, _usage(data))
                spent = _usage(data) or {}
                plan_usage.record(self._account_id, spent.get("prompt_tokens", 0), spent.get("completion_tokens", 0))
                plan_usage.ok(self._account_id)
            elif kind == "response.incomplete":
                finished = True
                truncated = (
                    ((data.get("response") or {}).get("incomplete_details") or {}).get("reason")
                ) == "max_output_tokens"
                usage.record(self.model, _usage(data))
            elif kind in ("response.failed", "error"):
                code, message = _fields(data)
                if not code and not message:
                    log.warning("ChatGPT stream error without a code: %s", json.dumps(data)[:400])
                raise self._noted(_error(code, None, message))
        if not finished:
            # The stream ended without its terminal event: not a complete answer.
            raise ChatGPTError(tr("انقطع رد ChatGPT قبل ما يخلص — جرّب مرة تانية."), "cant_reach")
        if calls:
            yield StreamEvent(tool_calls=calls, finish_reason="tool_calls", truncated=truncated)
        else:
            yield StreamEvent(finish_reason="length" if truncated else "stop", truncated=truncated)

    async def complete(self, messages: list[dict[str, Any]], max_tokens: int | None = None) -> str:  # noqa: ARG002 - not accepted on this route
        out: list[str] = []
        async for event in self.stream_chat(messages, []):
            if event.text_delta:
                out.append(event.text_delta)
        return "".join(out).strip()

    async def aclose(self) -> None:
        """Nothing held between requests."""


def _usage(data: dict[str, Any]) -> dict[str, int] | None:
    raw = (data.get("response") or {}).get("usage")
    if not isinstance(raw, dict):
        return None
    out = {
        "prompt_tokens": int(raw.get("input_tokens") or 0),
        "completion_tokens": int(raw.get("output_tokens") or 0),
    }
    cached = (raw.get("input_tokens_details") or {}).get("cached_tokens")
    if cached:
        out["prompt_tokens_details"] = {"cached_tokens": int(cached)}  # type: ignore[assignment]
    return out


__all__ = ["MANAGE_USAGE_URL", "ChatGPTError", "ChatGPTProvider", "to_responses", "to_tools"]
