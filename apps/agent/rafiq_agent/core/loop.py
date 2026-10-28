import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from rafiq_agent.core.context import STEP_BUDGET, compact_steps, fit, message_tokens, reply_room
from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.tools.base import ToolRegistry

DENIED_OUTPUT = "المستخدم رفض هذا الإجراء، أو الإعدادات تمنعه."


async def _noop(*_: Any) -> None:
    return None


@dataclass
class LoopCallbacks:
    """Hooks the loop reports through. Tasks persist events; chats stream them to the UI."""

    # (tool, category, args, preview) -> allowed. `preview` is what the call would do (a
    # diff for a file write), for the permission card; None when the args say it all.
    permit: Callable[..., Awaitable[bool]]
    on_text_delta: Callable[[str], Awaitable[None]] = _noop
    on_reasoning_delta: Callable[[str], Awaitable[None]] = _noop
    on_turn_text: Callable[[str], Awaitable[None]] = _noop
    on_tool_call: Callable[[str, str, str, dict[str, Any]], Awaitable[None]] = _noop
    on_tool_result: Callable[[str, str, bool, str], Awaitable[None]] = _noop
    # A final answer `check_reply` refused: take its text back off the screen.
    on_redo: Callable[[str], Awaitable[None]] = _noop


NUDGE = "أكمل من وين وقفت، واكتب الرد كامل."
# A reasoning model that thought, then stopped without a word of answer.
NUDGE_THOUGHT = "(رسالة من رفيق) فكّرت بس ما كتبت ولا كلمة من الرد. اكتب الرد هلأ مباشرة."

# When the model's reply hits its output limit. A cut tool call is never run (its arguments
# are half a file); the model is told why, and asked for smaller pieces.
CUT_TOOL = (
    "(رسالة من رفيق) ردّك الأخير انقطع لأنه وصل لأقصى طول بيقدر الموديل يكتبه بمرة وحدة، "
    "قبل ما يكمل استدعاء {tools} — فما نفّذته. اللي بدك تكتبه أطول من هيك: قسّمه. "
    "مثلاً كل صفحة بملف لحالها، أو اكتب الملف على أقسام أصغر بكذا استدعاء. وخلّي تفكيرك مختصر."
)
CUT_THINKING = (
    "(رسالة من رفيق) انقطع ردّك وإنت عم تفكّر، قبل ما تبلّش بالشغل، لأنه وصل لأقصى طول. "
    "اختصر التفكير وابدأ بالتنفيذ مباشرة، وقسّم الشغل الكبير على خطوات."
)
CUT_TEXT = "(رسالة من رفيق) انقطع ردّك لأنه طوّل. كمّل من الكلمة اللي وقفت عندها بالضبط، بدون ما تعيد شي."
# How many times one turn is helped past the limit before it gives up and says so.
MAX_CUTS = 3
# How many times a reply the chat refuses (`check_reply`) is sent back to be redone.
MAX_REDOS = 2


async def _preview(tool: Any, args: dict[str, Any]) -> str | None:
    """A tool's own account of what the call would change. Never lets a preview failure
    block the call itself."""
    try:
        return await tool.preview(args)
    except Exception:  # noqa: BLE001 - a broken preview is not a broken tool
        return None


def _last_was_tool(messages: list[dict[str, Any]]) -> bool:
    return bool(messages) and messages[-1].get("role") == "tool"


@dataclass
class LoopResult:
    status: str  # "completed" | "empty" | "max_iterations" | "cut"
    text: str
    reasoning: str


async def run_agent_loop(
    llm: LlmProvider,
    messages: list[dict[str, Any]],
    registry: ToolRegistry,
    cb: LoopCallbacks,
    max_iterations: int = 25,
    check_reply: Callable[[str], str | None] | None = None,
) -> LoopResult:
    """`check_reply` sees each final answer (a step without tool calls); when it returns a
    note, that answer is set aside and the model is sent the note to redo it (a motion chat
    uses it to turn code back into scene edits)."""
    # A provider that runs tools of its own (Copilot's web_fetch) asks the same permission
    # gate Rafiq's tools go through, instead of deciding for itself.
    hook = getattr(llm, "set_permission_hook", None)
    if hook is not None:
        hook(cb.permit)
    try:
        return await _run(llm, messages, registry, cb, max_iterations, check_reply)
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
    check_reply: Callable[[str], str | None] | None = None,
) -> LoopResult:
    all_text, all_reasoning = "", ""
    schemas = registry.schemas()
    nudged = False
    cuts = 0
    redos = 0
    # Each request is fitted to the model's window (core/context.py). The user's newest
    # message is where this turn starts: before it is history, which may be left out.
    head = len(messages) - 1
    window = getattr(llm, "context_window", None)
    budget = window - reply_room(window, getattr(llm, "max_tokens", None)) if isinstance(window, int) else None
    # What this run has added since its older steps were last compacted.
    settled = sum(message_tokens(m) for m in messages[head:])

    for _ in range(max_iterations):
        text, reasoning = "", ""
        tool_calls: list[Any] = []
        truncated = False

        sent = fit(messages, budget, head=head, tools=schemas) if budget else messages
        async for event in llm.stream_chat(sent, schemas):
            if event.text_delta:
                text += event.text_delta
                await cb.on_text_delta(event.text_delta)
            if event.reasoning_delta:
                reasoning += event.reasoning_delta
                await cb.on_reasoning_delta(event.reasoning_delta)
            if event.tool_calls:
                tool_calls = event.tool_calls
            if event.truncated:
                truncated = True

        all_text += text
        all_reasoning += reasoning
        if text.strip():
            await cb.on_turn_text(text.strip())

        if truncated:
            if cuts >= MAX_CUTS:
                return LoopResult("cut", all_text, all_reasoning)
            cuts += 1
            if text:
                messages.append({"role": "assistant", "content": text})
            if tool_calls:
                names = ", ".join(sorted({tc.name for tc in tool_calls if tc.name})) or "the tool"
                messages.append({"role": "user", "content": CUT_TOOL.format(tools=names)})
            elif text.strip():
                messages.append({"role": "user", "content": CUT_TEXT})
            else:
                messages.append({"role": "user", "content": CUT_THINKING})
            continue

        if not tool_calls:
            # Some models go quiet right after a tool result: no text, no call, nothing.
            # Nudge once before giving up, so a long skill read doesn't dead-end the turn.
            # A reasoning model can also think its whole budget through and stop there.
            if not text.strip() and not all_text.strip() and not nudged and (_last_was_tool(messages) or reasoning.strip()):
                nudged = True
                messages.append({"role": "user", "content": NUDGE if _last_was_tool(messages) else NUDGE_THOUGHT})
                continue
            if check_reply is not None and text.strip() and redos < MAX_REDOS and (note := check_reply(text)):
                redos += 1
                all_text = all_text[: len(all_text) - len(text)]
                await cb.on_redo(text)
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": note})
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

        images: list[str] = []
        shown: list[str] = []
        for tc in tool_calls:
            try:
                args = json.loads(tc.arguments_json or "{}")
            except json.JSONDecodeError:
                args = {}

            tool = registry.get(tc.name)
            if tool is None:
                ok, output = False, f"unknown tool: {tc.name}"
            elif not await cb.permit(tool.name, tool.category, args, await _preview(tool, args)):
                ok, output = False, DENIED_OUTPUT
            else:
                await cb.on_tool_call(tc.id, tool.name, tool.category, args)
                result = await tool.run(args)
                ok, output = result.ok, result.output
                shown = result.images or []

            await cb.on_tool_result(tc.id, tc.name, ok, output)
            tool_message: dict[str, Any] = {"role": "tool", "tool_call_id": tc.id, "content": output}
            if tool is not None and shown and getattr(llm, "tool_images_inline", False):
                # Copilot takes a tool's pictures with its result; a separate user message
                # would land while the tool call is still waiting for its answer.
                tool_message["images"] = shown
            elif tool is not None:
                images += shown
            shown = []
            messages.append(tool_message)

        if images:
            await _show_images(llm, messages, images)

        if sum(message_tokens(m) for m in messages[head:]) - settled > STEP_BUDGET:
            compact_steps(messages, head)
            settled = sum(message_tokens(m) for m in messages[head:])

    return LoopResult("max_iterations", all_text, all_reasoning)


IMAGES_NOTE = "الصور اللي رجعت من الأدوات:"


async def _show_images(llm: LlmProvider, messages: list[dict[str, Any]], images: list[str]) -> None:
    """Tool results are text-only on most APIs, so screenshots follow as a user message.
    Only the latest set stays in the context — older ones become a one-line placeholder,
    or a few screenshots in, every request would carry megabytes of old images."""
    from rafiq_agent.llm.discovery import supports_vision

    # Unknown (None) counts as able, the same as for attachments.
    if supports_vision(getattr(llm, "model", "")) is False:
        from rafiq_agent.core.vision import describe_images

        try:
            words = await describe_images(images[-4:])
        except Exception:  # noqa: BLE001 - no vision model set, or it failed
            messages.append(
                {
                    "role": "user",
                    "content": "(الأداة رجّعت صورة، بس هالنموذج ما بيقرأ الصور وما في موديل رؤية بالإعدادات. "
                    "ما تحاول تفتحها ببايثون أو أي أداة تانية — قول للمستخدم.)",
                }
            )
            return
        messages.append({"role": "user", "content": f"(هالنموذج ما بيشوف صور، فموديل الرؤية وصف الصور اللي رجعت من الأدوات:)\n{words}"})
        return
    for message in messages:
        content = message.get("content")
        if message.get("role") == "user" and isinstance(content, list) and content and content[0].get("text") == IMAGES_NOTE:
            message["content"] = "(صورة قديمة من أداة — انشالت لتوفير السياق)"
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": IMAGES_NOTE},
                *({"type": "image_url", "image_url": {"url": url}} for url in images[-4:]),
            ],
        }
    )
