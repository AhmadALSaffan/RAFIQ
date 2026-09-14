import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.tools.base import ToolRegistry

DENIED_OUTPUT = "المستخدم رفض هذا الإجراء، أو الإعدادات تمنعه."


async def _noop(*_: Any) -> None:
    return None


@dataclass
class LoopCallbacks:
    """Hooks the loop reports through. Tasks persist events; chats stream them to the UI."""

    permit: Callable[[str, str, dict[str, Any]], Awaitable[bool]]
    on_text_delta: Callable[[str], Awaitable[None]] = _noop
    on_reasoning_delta: Callable[[str], Awaitable[None]] = _noop
    on_turn_text: Callable[[str], Awaitable[None]] = _noop
    on_tool_call: Callable[[str, str, str, dict[str, Any]], Awaitable[None]] = _noop
    on_tool_result: Callable[[str, str, bool, str], Awaitable[None]] = _noop


NUDGE = "أكمل من وين وقفت، واكتب الرد كامل."


def _last_was_tool(messages: list[dict[str, Any]]) -> bool:
    return bool(messages) and messages[-1].get("role") == "tool"


@dataclass
class LoopResult:
    status: str  # "completed" | "empty" | "max_iterations"
    text: str
    reasoning: str


async def run_agent_loop(
    llm: LlmProvider,
    messages: list[dict[str, Any]],
    registry: ToolRegistry,
    cb: LoopCallbacks,
    max_iterations: int = 25,
) -> LoopResult:
    try:
        return await _run(llm, messages, registry, cb, max_iterations)
    finally:
        # Stateful providers (Copilot keeps a live session across tool steps) release it
        # here, however the run ended — finished, failed, or cancelled.
        close = getattr(llm, "aclose", None)
        if close is not None:
            await close()


async def _run(
    llm: LlmProvider,
    messages: list[dict[str, Any]],
    registry: ToolRegistry,
    cb: LoopCallbacks,
    max_iterations: int,
) -> LoopResult:
    all_text, all_reasoning = "", ""
    schemas = registry.schemas()
    nudged = False

    for _ in range(max_iterations):
        text, reasoning = "", ""
        tool_calls: list[Any] = []

        async for event in llm.stream_chat(messages, schemas):
            if event.text_delta:
                text += event.text_delta
                await cb.on_text_delta(event.text_delta)
            if event.reasoning_delta:
                reasoning += event.reasoning_delta
                await cb.on_reasoning_delta(event.reasoning_delta)
            if event.tool_calls:
                tool_calls = event.tool_calls

        all_text += text
        all_reasoning += reasoning
        if text.strip():
            await cb.on_turn_text(text.strip())

        if not tool_calls:
            # Some models go quiet right after a tool result: no text, no call, nothing.
            # Nudge once before giving up, so a long skill read doesn't dead-end the turn.
            if not text.strip() and not all_text.strip() and not nudged and _last_was_tool(messages):
                nudged = True
                messages.append({"role": "user", "content": NUDGE})
                continue
            if not all_text.strip():
                return LoopResult("empty", all_text, all_reasoning)
            return LoopResult("completed", all_text, all_reasoning)

        assistant_turn: dict[str, Any] = {
            "role": "assistant",
            "content": text or None,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": tc.arguments_json},
                }
                for tc in tool_calls
            ],
        }
        if reasoning:
            # Thinking models (e.g. DeepSeek) reject a tool-result turn that drops their reasoning.
            assistant_turn["reasoning_content"] = reasoning
        messages.append(assistant_turn)

        for tc in tool_calls:
            try:
                args = json.loads(tc.arguments_json or "{}")
            except json.JSONDecodeError:
                args = {}

            tool = registry.get(tc.name)
            if tool is None:
                ok, output = False, f"unknown tool: {tc.name}"
            elif not await cb.permit(tool.name, tool.category, args):
                ok, output = False, DENIED_OUTPUT
            else:
                await cb.on_tool_call(tc.id, tool.name, tool.category, args)
                result = await tool.run(args)
                ok, output = result.ok, result.output

            await cb.on_tool_result(tc.id, tc.name, ok, output)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": output})

    return LoopResult("max_iterations", all_text, all_reasoning)
