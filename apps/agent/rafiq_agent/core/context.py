"""How much of a conversation fits the model it's going to.

Every model reads a window of tokens (a million for some, a few thousand for a small local
one), and its reply has to fit in that same window. Sending the whole history every time
works until it doesn't. A long design chat on a small model either fails, or the server
quietly drops the start of the request, which is where the instructions are. So every
request is fitted to the model's window before it goes out:

1. The reply gets its room first: a share of the window, at most the model's output limit.
2. Tool results the model has already acted on shrink to their head and tail.
3. Earlier turns drop, oldest first. The chat's summary stands in for them.
4. If a single message is still too big, it's clipped in the middle.

Nothing here touches what's stored. It decides what one request carries.
"""

from __future__ import annotations

from typing import Any

# A model the price table doesn't know, on an OpenAI-compatible server: assume a modest
# window rather than a huge one. Over-trimming costs a little memory; over-sending fails.
UNKNOWN_WINDOW = 16_384
# Local servers: Rafiq asks Ollama for this window itself (its own default is smaller);
# LM Studio uses whatever the model was loaded with, which is often 4,096.
OLLAMA_WINDOW = 8_192
LM_STUDIO_WINDOW = 4_096
# The reply's share of a small window. A big model keeps its full output limit.
REPLY_SHARE = 0.25
# Tokens kept aside for the provider's own framing (roles, tool-call wrappers).
MARGIN = 256
# What an image counts for. Providers differ; this is the usual order of magnitude.
IMAGE_TOKENS = 800
# A shrunk tool result keeps this many characters from each end.
SHRUNK_CHARS = 600

OMITTED_NOTE = (
    "(ملاحظة من رفيق: في {0} رسالة أقدم بهالمحادثة ما انبعتت لأنها ما بتساع بذاكرة هالنموذج. "
    "اعتمد على الملخص إذا موجود، وإذا لزمك شي منها اسأل المستخدم.)"
)


def tokens(text: str | None) -> int:
    """A cautious estimate: UTF-8 bytes / 4. Close for English, a little high for Arabic,
    which is the safe side to be wrong on."""
    return len((text or "").encode("utf-8")) // 4 + 1 if text else 0


def message_tokens(message: dict[str, Any]) -> int:
    total = 4
    content = message.get("content")
    if isinstance(content, str):
        total += tokens(content)
    elif isinstance(content, list):
        for part in content:
            if part.get("type") == "text":
                total += tokens(part.get("text"))
            else:
                total += IMAGE_TOKENS
    for call in message.get("tool_calls") or []:
        fn = call.get("function") or {}
        total += tokens(fn.get("name")) + tokens(fn.get("arguments"))
    total += tokens(message.get("reasoning_content"))
    total += IMAGE_TOKENS * len(message.get("images") or [])
    return total


def total_tokens(messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None) -> int:
    import json

    schemas = tokens(json.dumps(tools, ensure_ascii=False)) if tools else 0
    return sum(message_tokens(m) for m in messages) + schemas


def window_for(provider: str, model_id: str, options: dict[str, Any] | None = None) -> int:
    """How many tokens this model reads in one request."""
    # A model's own setting wins. Options arrive from the API as text, so "8192" counts too.
    try:
        override = int((options or {}).get("context_window") or 0)
    except (TypeError, ValueError):
        override = 0
    if override > 0:
        return override
    if provider == "ollama":
        return OLLAMA_WINDOW
    if provider == "lm_studio":
        return LM_STUDIO_WINDOW
    import litellm

    from rafiq_agent.llm.base import litellm_model_string

    for name in (litellm_model_string(provider, model_id), model_id):
        try:
            info = litellm.get_model_info(model=name)
        except Exception:  # noqa: BLE001 - not in the table
            continue
        window = info.get("max_input_tokens") or info.get("max_tokens")
        if window:
            return int(window)
    return UNKNOWN_WINDOW


def reply_room(window: int, max_tokens: int | None) -> int:
    """What's kept free for the reply: the model's own limit, but never most of the window."""
    share = int(window * REPLY_SHARE)
    return min(max_tokens, share) if max_tokens else min(4_096, share)


def output_room(window: int, max_tokens: int | None, used: int) -> int | None:
    """The max_tokens to actually send, given what the request already uses. A provider
    that's asked for more than its window has left rejects the request outright."""
    if not max_tokens:
        return None
    left = window - used - MARGIN
    return max(256, min(max_tokens, left))


def squeeze(text: str, keep: int = SHRUNK_CHARS) -> str:
    """The head and tail of a long text, with a note saying what was left out."""
    if len(text) <= keep * 2 + 80:
        return text
    return f"{text[:keep]}\n… (اختصرها رفيق: {len(text) - keep * 2} حرف بالنص) …\n{text[-keep:]}"


def _last_step(messages: list[dict[str, Any]]) -> int:
    """Index of the newest assistant message that called tools: its results are what the
    model is working with right now, so they shrink last."""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant" and messages[i].get("tool_calls"):
            return i
    return len(messages)


def fit(
    messages: list[dict[str, Any]],
    budget: int,
    *,
    head: int | None = None,
    tools: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """The messages, trimmed to `budget` tokens. `head` is where the current request starts
    (the user's newest message): everything between the system prompt and it is history
    and may be dropped whole; from it on, nothing is dropped, only shrunk."""
    out = [dict(m) for m in messages]
    overhead = total_tokens([], tools)
    used = overhead + sum(message_tokens(m) for m in out)
    if used <= budget:
        return out

    start = 1 if out and out[0].get("role") == "system" else 0
    head = len(out) - 1 if head is None else max(start, min(head, len(out) - 1))

    # 1. Tool results the model already acted on: head and tail are enough.
    newest = _last_step(out)
    for i, m in enumerate(out):
        if used <= budget:
            return out
        if m.get("role") == "tool" and i < newest and isinstance(m.get("content"), str):
            before = message_tokens(m)
            m["content"] = squeeze(m["content"])
            used -= before - message_tokens(m)

    # 2. Earlier turns, oldest first. History opens on a user message, as providers expect.
    dropped = 0
    while used > budget and start < head:
        used -= message_tokens(out[start])
        del out[start]
        head -= 1
        dropped += 1
        while start < head and out[start].get("role") != "user":
            used -= message_tokens(out[start])
            del out[start]
            head -= 1
            dropped += 1
    if dropped and start == 1:
        note = OMITTED_NOTE.format(dropped)
        system = out[0].get("content")
        if isinstance(system, str):
            out[0]["content"] = f"{system}\n\n{note}"
            used += tokens(note)

    # 3. Still too big: the newest tool results, then whatever single message is largest.
    for m in out:
        if used <= budget:
            return out
        if m.get("role") == "tool" and isinstance(m.get("content"), str):
            before = message_tokens(m)
            m["content"] = squeeze(m["content"])
            used -= before - message_tokens(m)
    for _ in range(len(out) * 2):
        if used <= budget:
            break
        sized = [(message_tokens(m), i) for i, m in enumerate(out) if isinstance(m.get("content"), str)]
        if not sized:
            break
        size, i = max(sized)
        over = used - budget
        text = out[i]["content"]
        # Keep what's left after removing the excess (in characters, up to four a token,
        # erring towards removing a bit more, and leaving room for the note), split between
        # head and tail.
        keep = max(200, (len(text) - over * 4 - 400) // 2)
        clipped = squeeze(text, keep)
        if clipped == text:
            break
        out[i]["content"] = clipped
        used -= size - message_tokens(out[i])
    return out


# How much one run may grow before its older steps are compacted (see `compact_steps`).
STEP_BUDGET = 24_000
# The newest steps stay whole: they're what the model is working from right now.
KEEP_STEPS = 2
# A tool argument longer than this (a whole file written) is replaced by a note once acted on.
LONG_ARGUMENT = 1_500
SENT_NOTE = "(… {0} حرف انبعتوا بخطوة سابقة — ما بينعادوا هون)"


def compact_steps(messages: list[dict[str, Any]], start: int, keep: int = KEEP_STEPS) -> None:
    """Shrinks the steps of a run the model has moved past, in place. Every request carries
    the whole run so far, so a run that reads and writes pages re-sends every page on every
    later step, even with a million-token window where `fit` never has to trim. The results
    and the files written in older steps keep their head and tail; the newest `keep` steps
    stay whole. Done in one go when the run has grown (not on every step), so the request
    keeps the same beginning from one step to the next and a provider's prompt cache holds."""
    import json

    steps = [i for i in range(start, len(messages)) if messages[i].get("role") == "assistant" and messages[i].get("tool_calls")]
    if len(steps) <= keep:
        return
    until = steps[-keep]
    for m in messages[start:until]:
        content = m.get("content")
        if m.get("role") == "tool" and isinstance(content, str):
            m["content"] = squeeze(content)
        for call in m.get("tool_calls") or []:
            fn = call.get("function") or {}
            raw = fn.get("arguments")
            if not isinstance(raw, str) or len(raw) <= LONG_ARGUMENT:
                continue
            try:
                args = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(args, dict):
                continue
            short = {k: SENT_NOTE.format(len(v)) if isinstance(v, str) and len(v) > LONG_ARGUMENT else v for k, v in args.items()}
            fn["arguments"] = json.dumps(short, ensure_ascii=False)
