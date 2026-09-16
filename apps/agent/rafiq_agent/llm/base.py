from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import litellm

litellm.suppress_debug_info = True
# Providers differ in which tuning knobs they accept (reasoning_effort especially).
# Dropping the unsupported ones beats failing the whole request.
litellm.drop_params = True


@dataclass
class ToolCallDelta:
    id: str
    name: str
    arguments_json: str


@dataclass
class StreamEvent:
    text_delta: str | None = None
    reasoning_delta: str | None = None
    tool_calls: list[ToolCallDelta] = field(default_factory=list)
    finish_reason: str | None = None


def litellm_model_string(provider: str, model_id: str) -> str:
    """litellm expects a '<provider>/<model>' string for most non-OpenAI providers."""
    if provider == "openai":
        return model_id
    if provider in ("custom", "authai"):
        # OpenAI-compatible endpoints (a local server, or an experimental relay).
        return f"openai/{model_id}"
    if provider == "ollama":
        # ollama_chat uses /api/chat, which supports tool calling; plain ollama/ does not.
        return f"ollama_chat/{model_id}"
    return f"{provider}/{model_id}"


class LlmProvider:
    """Thin wrapper around litellm so the rest of the app never imports it directly."""

    def __init__(
        self,
        provider: str,
        model_id: str,
        api_key: str | None,
        base_url: str | None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
        extra_headers: dict[str, str] | None = None,
        options: dict[str, Any] | None = None,
    ) -> None:
        from rafiq_agent.llm.presets import call_kwargs

        self.model = litellm_model_string(provider, model_id)
        self.extra_headers = extra_headers or None
        # Endpoint and credentials, in the shape this provider takes them (see llm/presets.py).
        self.connection = call_kwargs(provider, api_key, base_url, options)
        self.temperature = temperature
        self.max_tokens = max_tokens
        # "none" asks models that can turn thinking off to do so; providers that don't
        # understand the parameter simply have it dropped.
        self.reasoning_effort = reasoning_effort

    def _tuning(self) -> dict[str, Any]:
        """Only send knobs the user actually set — some providers reject nulls."""
        out: dict[str, Any] = {}
        if self.temperature is not None:
            out["temperature"] = self.temperature
        if self.max_tokens is not None:
            out["max_tokens"] = self.max_tokens
        if self.reasoning_effort is not None:
            out["reasoning_effort"] = self.reasoning_effort
        return out

    @property
    def api_key(self) -> str | None:
        return self.connection.get("api_key")

    @property
    def base_url(self) -> str | None:
        return self.connection.get("api_base")

    def _prepared(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        from rafiq_agent.llm.presets import caches_prompts, with_cache_marks

        return with_cache_marks(messages) if caches_prompts(self.model) else messages

    async def aclose(self) -> None:
        """Nothing to release — litellm calls are stateless. Copilot's provider overrides this."""

    async def complete(self, messages: list[dict[str, Any]], max_tokens: int | None = None) -> str:
        """One-shot, no tools, no streaming — used for summarising a chat."""
        from rafiq_agent.llm import usage

        response = await litellm.acompletion(
            model=self.model,
            messages=self._prepared(messages),
            max_tokens=max_tokens,
            extra_headers=self.extra_headers,
            **self.connection,
        )
        usage.record(self.model, getattr(response, "usage", None))
        return (response.choices[0].message.content or "").strip()

    async def stream_chat(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> AsyncIterator[StreamEvent]:
        from rafiq_agent.llm import usage

        response = await litellm.acompletion(
            model=self.model,
            messages=self._prepared(messages),
            tools=tools or None,
            extra_headers=self.extra_headers,
            stream=True,
            # Providers that can't report usage mid-stream have this dropped; litellm then
            # counts the tokens itself.
            stream_options={"include_usage": True},
            **self.connection,
            **self._tuning(),
        )

        # Accumulate partial tool-call argument strings by index; emit them once the stream ends,
        # since some providers finish a tool-call turn with "stop" rather than "tool_calls".
        pending_tool_calls: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None
        counted: Any = None
        produced: list[str] = []  # what came back, in case the provider reports no usage

        async for chunk in response:
            # The usage block arrives on its own chunk at the very end (or on the last one).
            counted = getattr(chunk, "usage", None) or counted
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta

            text = getattr(delta, "content", None)
            reasoning = None if self.reasoning_effort == "none" else getattr(delta, "reasoning_content", None)

            for tc in getattr(delta, "tool_calls", None) or []:
                index = tc.index if tc.index is not None else len(pending_tool_calls)
                slot = pending_tool_calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments

            if choice.finish_reason:
                finish_reason = choice.finish_reason

            if text or reasoning:
                produced.append(text or reasoning or "")
                yield StreamEvent(text_delta=text, reasoning_delta=reasoning)

        usage.record(
            self.model,
            counted
            or usage.estimate(
                self.model,
                messages,
                "".join(produced) + "".join(v["arguments"] for v in pending_tool_calls.values()),
            ),
        )

        if pending_tool_calls:
            yield StreamEvent(
                tool_calls=[
                    ToolCallDelta(id=v["id"] or f"call_{i}", name=v["name"], arguments_json=v["arguments"])
                    for i, v in sorted(pending_tool_calls.items())
                ],
                finish_reason="tool_calls",
            )
        else:
            yield StreamEvent(finish_reason=finish_reason or "stop")
