"""What one request carries, fitted to the model it's going to."""

from typing import Any

from rafiq_agent.core import chat_service
from rafiq_agent.core.context import (
    LM_STUDIO_WINDOW,
    OLLAMA_WINDOW,
    UNKNOWN_WINDOW,
    fit,
    output_room,
    total_tokens,
    window_for,
)
from rafiq_agent.core.designs import (
    current_documents,
    extract_previews,
    keep_newest_versions,
    mention_documents,
    without_html,
)
from rafiq_agent.core.loop import NUDGE_THOUGHT, LoopCallbacks, run_agent_loop
from rafiq_agent.llm.base import StreamEvent
from rafiq_agent.storage.models import Chat, ChatMessage
from rafiq_agent.tools.base import ToolRegistry


def _chat(turns: int, size: int) -> list[dict[str, Any]]:
    """A system prompt, `turns` old exchanges of `size` characters each, and a new question."""
    out: list[dict[str, Any]] = [{"role": "system", "content": "you are rafiq"}]
    for i in range(turns):
        out.append({"role": "user", "content": f"question {i} " + "x" * size})
        out.append({"role": "assistant", "content": f"answer {i} " + "y" * size})
    out.append({"role": "user", "content": "the newest question"})
    return out


def test_windows_come_from_the_model_or_a_careful_default():
    assert window_for("deepseek", "deepseek-v4-pro") >= 1_000_000
    assert window_for("ollama", "llama3") == OLLAMA_WINDOW
    assert window_for("lm_studio", "qwen") == LM_STUDIO_WINDOW
    assert window_for("custom", "something-nobody-knows") == UNKNOWN_WINDOW
    assert window_for("custom", "something-nobody-knows", {"context_window": 2048}) == 2048
    assert window_for("custom", "something-nobody-knows", {"context_window": "8192"}) == 8192
    assert window_for("custom", "something-nobody-knows", {"context_window": "lots"}) == UNKNOWN_WINDOW


def test_a_request_that_fits_is_sent_as_it_is():
    messages = _chat(3, 100)
    assert fit(messages, 100_000) == messages


def test_old_turns_drop_first_and_the_newest_question_stays():
    messages = _chat(20, 2_000)
    fitted = fit(messages, 4_000)
    assert total_tokens(fitted) <= 4_000
    assert fitted[0]["role"] == "system" and "رسالة أقدم" in fitted[0]["content"]
    assert fitted[-1] == {"role": "user", "content": "the newest question"}
    # History still opens on a user message, and the newest exchange is the one kept.
    assert fitted[1]["role"] == "user"
    assert "question 19" in fitted[-3]["content"]


def test_used_tool_results_shrink_before_anything_is_dropped():
    messages = [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "old question"},
        {"role": "assistant", "content": "old answer"},
        {"role": "user", "content": "read two files"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "a", "type": "function", "function": {"name": "read", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "a", "content": "A" * 40_000},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "b", "type": "function", "function": {"name": "read", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "b", "content": "B" * 4_000},
    ]
    fitted = fit(messages, 3_000, head=3)
    assert len(fitted) == len(messages)  # nothing dropped: the old result shrank enough
    assert len(fitted[5]["content"]) < 2_000 and "اختصرها رفيق" in fitted[5]["content"]
    assert fitted[7]["content"] == "B" * 4_000  # the newest step's result is untouched
    assert messages[5]["content"] == "A" * 40_000  # the stored conversation isn't changed


def test_a_single_huge_message_is_clipped_to_fit():
    messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "z" * 200_000}]
    fitted = fit(messages, 2_000)
    assert total_tokens(fitted) <= 2_000
    assert fitted[1]["content"].startswith("zzz") and fitted[1]["content"].endswith("zzz")


def test_the_reply_never_asks_for_more_than_the_window_has_left():
    assert output_room(8_192, 64_000, 6_000) < 2_200
    assert output_room(1_000_000, 64_000, 50_000) == 64_000
    assert output_room(8_192, None, 6_000) is None


def _design(name: str, body: str) -> str:
    return f"قرارات\n```html\n<!-- file: {name} -->\n<html>{body}</html>\n```"


def test_a_design_chat_sends_each_document_once():
    replies = [_design("home", "v1" * 500), _design("home", "v2" * 500), _design("pricing", "p1"), "شكراً"]
    kept = keep_newest_versions(replies, "design")
    assert "v1v1" not in kept[0] and "نسخة أقدم" in kept[0]
    assert "v2v2" in kept[1]  # the newest home page
    assert "p1" in kept[2]
    assert kept[3] == "شكراً"
    # The preview still reads the same documents from what's stored.
    assert extract_previews(replies[1], "design")[0]["name"] == "home"
    assert "<html>" not in without_html(replies[0])


def test_the_current_design_rides_with_the_newest_message_only():
    replies = [_design("home", "v1"), _design("home", "v2")]
    mentioned = [mention_documents(r, "design") for r in replies]
    assert all("<html>" not in r and "«home»" in r for r in mentioned)
    note = current_documents([{"name": "home", "html": "<html>v2</html>"}, {"name": "empty", "html": ""}])
    assert "```html home" in note and "<html>v2</html>" in note and "empty" not in note
    assert current_documents([]) == ""


class _Summariser:
    """Answers like a model with a small window, and records what it was sent."""

    def __init__(self, window: int, answers: list[str] | None = None) -> None:
        self.context_window = window
        self.answers = answers
        self.bodies: list[str] = []

    async def complete(self, messages, max_tokens=None):  # noqa: ANN001 - mirrors LlmProvider
        self.bodies.append(messages[-1]["content"])
        assert total_tokens(messages) + (max_tokens or 0) <= self.context_window
        if self.answers is not None:
            return self.answers.pop(0)
        return f"summary {len(self.bodies)}"


def _messages(count: int, size: int) -> list[ChatMessage]:
    return [
        ChatMessage(id=f"m{i}", role="user" if i % 2 == 0 else "assistant", content=f"{i} " + "w" * size)
        for i in range(count)
    ]


async def test_a_small_model_summarises_a_long_chat_in_pieces(monkeypatch):
    async def no_helper(_):  # noqa: ANN001
        return None

    monkeypatch.setattr(chat_service, "helper_llm", no_helper)
    chat = Chat(title="t")
    llm = _Summariser(window=4_096)
    report = await chat_service.summarize(chat, _messages(30, 3_000), llm, keep=2)
    assert len(llm.bodies) > 1  # it didn't fit at once, so it was folded piece by piece
    assert "ملخص سابق" in llm.bodies[-1]  # each piece builds on the summary so far
    assert chat.summary == f"summary {len(llm.bodies)}" and chat.summary_until == "m27"
    assert report["folded_messages"] == 28


async def test_a_second_summary_only_reads_what_is_new(monkeypatch):
    async def no_helper(_):  # noqa: ANN001
        return None

    monkeypatch.setattr(chat_service, "helper_llm", no_helper)
    chat = Chat(title="t", summary="what happened before", summary_until="m5")
    llm = _Summariser(window=200_000)
    await chat_service.summarize(chat, _messages(10, 50), llm, keep=0)
    assert "what happened before" in llm.bodies[0]
    assert "5 w" not in llm.bodies[0] and "6 w" in llm.bodies[0]


async def test_an_empty_summary_from_the_helper_falls_back_to_the_chat_model(monkeypatch):
    helper = _Summariser(window=200_000, answers=[""])

    async def with_helper(_):  # noqa: ANN001
        return helper

    monkeypatch.setattr(chat_service, "helper_llm", with_helper)
    chat = Chat(title="t")
    await chat_service.summarize(chat, _messages(6, 50), _Summariser(window=200_000), keep=0)
    assert chat.summary == "summary 1"


class _Thinker:
    """A reasoning model that thinks, stops without a word, then answers when nudged."""

    def __init__(self) -> None:
        self.seen: list[list[dict[str, Any]]] = []

    async def stream_chat(self, messages, tools):  # noqa: ANN001 - mirrors LlmProvider
        self.seen.append(messages)
        if len(self.seen) == 1:
            yield StreamEvent(reasoning_delta="hmm, a long think")
        else:
            yield StreamEvent(text_delta="الجواب")
        yield StreamEvent(finish_reason="stop")


async def test_a_model_that_only_thought_is_asked_for_the_answer():
    async def allow(*_: Any) -> bool:
        return True

    llm = _Thinker()
    result = await run_agent_loop(llm, [{"role": "user", "content": "q"}], ToolRegistry(), LoopCallbacks(permit=allow))
    assert result.status == "completed" and result.text == "الجواب"
    assert llm.seen[1][-1]["content"] == NUDGE_THOUGHT
