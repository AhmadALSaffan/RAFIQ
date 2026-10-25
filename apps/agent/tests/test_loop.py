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


# ── Replies cut off by the model's output limit ─────────────────────────────────────────


async def test_a_cut_tool_call_is_not_run_and_the_model_is_asked_to_split_it():
    tool = EchoTool()
    half = ToolCallDelta(id="c1", name="echo", arguments_json='{"path": "site.html", "content": "<html><body>…')
    llm = FakeLlm(
        [
            [StreamEvent(tool_calls=[half], finish_reason="tool_calls", truncated=True)],
            [StreamEvent(tool_calls=[ToolCallDelta(id="c2", name="echo", arguments_json="{}")], finish_reason="tool_calls")],
            [StreamEvent(text_delta="كتبت الصفحات على ملفات."), StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(llm, [{"role": "user", "content": "اعمل الموقع"}], registry_with(tool), LoopCallbacks(permit=Recorder([]).allow))
    assert result.status == "completed"
    assert tool.calls == 1  # only the whole call ran, never the half one
    told = llm.seen[1][-1]["content"]
    assert "انقطع" in told and "echo" in told and "قسّمه" in told


async def test_a_reply_cut_while_thinking_is_asked_to_think_less():
    llm = FakeLlm(
        [
            [StreamEvent(reasoning_delta="بفكّر وبفكّر…"), StreamEvent(finish_reason="length", truncated=True)],
            [StreamEvent(text_delta="هاد الجواب."), StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(llm, [{"role": "user", "content": "سؤال"}], ToolRegistry(), LoopCallbacks(permit=Recorder([]).allow))
    assert result.status == "completed" and result.text == "هاد الجواب."
    assert "اختصر التفكير" in llm.seen[1][-1]["content"]


async def test_a_reply_cut_mid_sentence_carries_on_where_it_stopped():
    llm = FakeLlm(
        [
            [StreamEvent(text_delta="أول نص "), StreamEvent(finish_reason="length", truncated=True)],
            [StreamEvent(text_delta="وآخره."), StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(llm, [{"role": "user", "content": "اكتب"}], ToolRegistry(), LoopCallbacks(permit=Recorder([]).allow))
    assert result.text == "أول نص وآخره."
    assert llm.seen[1][-2] == {"role": "assistant", "content": "أول نص "}


async def test_a_model_that_keeps_hitting_the_limit_ends_with_cut_not_empty():
    cut = [StreamEvent(reasoning_delta="…"), StreamEvent(finish_reason="length", truncated=True)]
    llm = FakeLlm([list(cut) for _ in range(5)])
    result = await run_agent_loop(llm, [{"role": "user", "content": "اعمل"}], ToolRegistry(), LoopCallbacks(permit=Recorder([]).allow))
    assert result.status == "cut"


async def test_the_provider_reports_a_reply_cut_by_the_output_limit(monkeypatch):
    from types import SimpleNamespace as NS

    from rafiq_agent.llm import base

    async def fake_completion(**_kwargs):
        async def stream():
            call = NS(index=0, id="c1", function=NS(name="filesystem_write", arguments='{"path": "a.html", "content": "<ht'))
            yield NS(usage=None, choices=[NS(delta=NS(content=None, reasoning_content=None, tool_calls=[call]), finish_reason=None)])
            yield NS(usage=None, choices=[NS(delta=NS(content=None, reasoning_content=None, tool_calls=None), finish_reason="length")])

        return stream()

    monkeypatch.setattr(base.litellm, "acompletion", fake_completion)
    from rafiq_agent.llm import usage

    monkeypatch.setattr(usage, "record", lambda *a, **k: None)
    llm = base.LlmProvider(provider="deepseek", model_id="deepseek-v4-flash", api_key="sk-test", base_url=None)
    events = [e async for e in llm.stream_chat([{"role": "user", "content": "x"}], [])]
    assert events[-1].tool_calls and events[-1].truncated


async def test_a_refused_reply_is_sent_back_and_redone():
    """A motion chat turns code back into scene edits: the reply with code is set aside,
    the model is told why, and what it does next is the answer."""
    from rafiq_agent.core.motion import ENGINE_ONLY_REDO, engine_only

    tool = EchoTool()
    llm = FakeLlm(
        [
            [StreamEvent(text_delta="هاد القلب:\n```html\n<canvas></canvas>\n```"), StreamEvent(finish_reason="stop")],
            [StreamEvent(tool_calls=[ToolCallDelta(id="c1", name="echo", arguments_json="{}")], finish_reason="tool_calls")],
            [StreamEvent(text_delta="بنيت القلب بالمحرك."), StreamEvent(finish_reason="stop")],
        ]
    )
    result = await run_agent_loop(
        llm, [{"role": "user", "content": "قلب 3D"}], registry_with(tool), LoopCallbacks(permit=Recorder([]).allow),
        check_reply=engine_only,
    )
    assert result.status == "completed"
    assert tool.calls == 1
    assert result.text == "بنيت القلب بالمحرك."
    assert llm.seen[1][-1] == {"role": "user", "content": ENGINE_ONLY_REDO}


async def test_a_reply_refused_again_and_again_is_kept_in_the_end():
    from rafiq_agent.core.loop import MAX_REDOS
    from rafiq_agent.core.motion import engine_only

    code = [StreamEvent(text_delta="```js\nnew THREE.Scene()\n```"), StreamEvent(finish_reason="stop")]
    llm = FakeLlm([list(code) for _ in range(MAX_REDOS + 1)])
    result = await run_agent_loop(
        llm, [{"role": "user", "content": "hi"}], ToolRegistry(), LoopCallbacks(permit=Recorder([]).allow),
        check_reply=engine_only,
    )
    assert result.status == "completed" and len(llm.seen) == MAX_REDOS + 1
