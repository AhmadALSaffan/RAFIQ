"""The agent loop: tool calls, refusals, and models that go quiet."""

from dataclasses import dataclass
from typing import Any

from rafiq_agent.core.loop import DENIED_OUTPUT, LoopCallbacks, run_agent_loop
from rafiq_agent.llm.base import StreamEvent, ToolCallDelta
from rafiq_agent.tools.base import Tool, ToolRegistry, ToolResult


class FakeLlm:
    """Replays scripted turns; records what it was asked, so we can assert on context."""

    def __init__(self, turns: list[list[StreamEvent]]) -> None:
        self.turns = turns
        self.seen: list[list[dict[str, Any]]] = []

    async def stream_chat(self, messages, tools):  # noqa: ANN001 - mirrors LlmProvider
        self.seen.append([dict(m) for m in messages])
        for event in self.turns.pop(0):
            yield event


class EchoTool(Tool):
    name = "echo"
    category = "read_only"
    description = "echo"
    parameters = {"type": "object", "properties": {}}

    def __init__(self) -> None:
        self.calls = 0

    async def run(self, args: dict[str, Any]) -> ToolResult:
        self.calls += 1
        return ToolResult(ok=True, output="done")


@dataclass
class Recorder:
    texts: list[str]

    async def allow(self, *_: Any) -> bool:
        return True

    async def deny(self, *_: Any) -> bool:
        return False


def registry_with(tool: Tool) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(tool)
    return registry


async def test_plain_reply_completes():
    llm = FakeLlm([[StreamEvent(text_delta="مرحبا"), StreamEvent(finish_reason="stop")]])
    result = await run_agent_loop(
        llm, [{"role": "user", "content": "hi"}], ToolRegistry(), LoopCallbacks(permit=Recorder([]).allow)
    )
    assert result.status == "completed"
    assert result.text == "مرحبا"


async def test_tool_call_runs_then_the_model_answers():
    tool = EchoTool()
    llm = FakeLlm(
        [
            [
                StreamEvent(
                    tool_calls=[ToolCallDelta(id="c1", name="echo", arguments_json="{}")],
                    finish_reason="tool_calls",
                )
            ],
            [StreamEvent(text_delta="خلصت"), StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(
        llm,
        [{"role": "user", "content": "go"}],
        registry_with(tool),
        LoopCallbacks(permit=Recorder([]).allow),
    )
    assert tool.calls == 1
    assert result.text == "خلصت"
    # the tool result is fed back to the model
    assert any(m.get("role") == "tool" for m in llm.seen[-1])


async def test_a_refused_tool_tells_the_model_instead_of_running_it():
    tool = EchoTool()
    llm = FakeLlm(
        [
            [
                StreamEvent(
                    tool_calls=[ToolCallDelta(id="c1", name="echo", arguments_json="{}")],
                    finish_reason="tool_calls",
                )
            ],
            [StreamEvent(text_delta="تمام"), StreamEvent(finish_reason="stop")],
        ]
    )
    await run_agent_loop(
        llm, [{"role": "user", "content": "go"}], registry_with(tool), LoopCallbacks(permit=Recorder([]).deny)
    )
    assert tool.calls == 0
    assert any(m.get("content") == DENIED_OUTPUT for m in llm.seen[-1])


async def test_a_silent_turn_after_a_tool_gets_one_nudge():
    tool = EchoTool()
    llm = FakeLlm(
        [
            [
                StreamEvent(
                    tool_calls=[ToolCallDelta(id="c1", name="echo", arguments_json="{}")],
                    finish_reason="tool_calls",
                )
            ],
            [StreamEvent(finish_reason="stop")],  # model says nothing
            [StreamEvent(text_delta="آسف، هاد الرد"), StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(
        llm,
        [{"role": "user", "content": "go"}],
        registry_with(tool),
        LoopCallbacks(permit=Recorder([]).allow),
    )
    assert result.status == "completed"
    assert result.text == "آسف، هاد الرد"


async def test_two_silent_turns_are_reported_as_empty():
    tool = EchoTool()
    llm = FakeLlm(
        [
            [
                StreamEvent(
                    tool_calls=[ToolCallDelta(id="c1", name="echo", arguments_json="{}")],
                    finish_reason="tool_calls",
                )
            ],
            [StreamEvent(finish_reason="stop")],
            [StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(
        llm,
        [{"role": "user", "content": "go"}],
        registry_with(tool),
        LoopCallbacks(permit=Recorder([]).allow),
    )
    assert result.status == "empty"
