"""Resuming a task that stopped: what it already did becomes context for the next run.

The saved events are the transcript. They don't keep the provider-level tool-call ids, so
rather than replaying them as native tool turns (which each API words differently), the run
is handed a compact recap as one user message — enough for the model to continue from the
failure point without repeating the steps that already finished.
"""

import json
from typing import Any

RESUMED = "resumed"

ARGS_MAX = 240
OUTPUT_MAX = 500
RECAP_MAX = 12_000
ELIDED = "(…خطوات أقدم انحذفت من الملخّص لتوفير السياق)"

RESUME_NOTE = (
    "هالمهمة وقفت قبل ما تخلص وبيكملها المستخدم من وين وقفت. هاد ملخّص لما انعمل قبل:\n\n"
    "{recap}\n\n"
    "كمّل من النقطة اللي وقفت عندها. لا تعيد الخطوات اللي خلصت، وتأكد من الحالة الحالية للملفات "
    "(ممكن تكون تغيّرت) قبل ما تبني عليها، ولو الخطوة الأخيرة فشلت جرّب طريقة تانية."
)


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _args(args: Any) -> str:
    try:
        return _clip(json.dumps(args, ensure_ascii=False), ARGS_MAX)
    except (TypeError, ValueError):
        return _clip(str(args), ARGS_MAX)


def _lines(events: list[tuple[str, dict[str, Any]]]) -> list[str]:
    """One line per step, in order. A tool_call is folded together with the result after it."""
    lines: list[str] = []
    for index, (kind, payload) in enumerate(events):
        if kind == "message" and (text := str(payload.get("text") or "").strip()):
            lines.append(f"• قلت: {_clip(text, OUTPUT_MAX)}")
        elif kind == "tool_call":
            call = payload.get("call") or {}
            nxt = events[index + 1] if index + 1 < len(events) else None
            line = f"• أداة {call.get('tool')}({_args(call.get('args'))})"
            if nxt and nxt[0] == "tool_result" and nxt[1].get("tool") == call.get("tool"):
                verdict = "نجحت" if nxt[1].get("ok") else "فشلت"
                line += f" ← {verdict}: {_clip(str(nxt[1].get('output') or ''), OUTPUT_MAX)}"
            else:
                line += " ← ما إجا نتيجة (وقفت قبلها)"
            lines.append(line)
        elif kind == "tool_result":
            prev = events[index - 1] if index else None
            if not (prev and prev[0] == "tool_call" and (prev[1].get("call") or {}).get("tool") == payload.get("tool")):
                verdict = "نجحت" if payload.get("ok") else "فشلت"
                lines.append(f"• أداة {payload.get('tool')} ← {verdict}: {_clip(str(payload.get('output') or ''), OUTPUT_MAX)}")
        elif kind == "permission_request":
            call = payload.get("call") or {}
            lines.append(f"• طلبت إذن لـ {call.get('tool')} ← {payload.get('resolution')}")
        elif kind == "error":
            lines.append(f"• خطأ: {_clip(str(payload.get('message') or ''), OUTPUT_MAX)}")
        elif kind == RESUMED:
            lines.append("— هون المستخدم كمّل المهمة مرة قبل —")
    return lines


def recap(events: list[tuple[str, dict[str, Any]]]) -> str:
    """The transcript so far as plain lines, newest kept when it has to be cut short.
    Empty when nothing worth telling happened."""
    lines = _lines(events)
    if not lines:
        return ""
    kept: list[str] = []
    size = 0
    for line in reversed(lines):
        if size + len(line) > RECAP_MAX and kept:
            kept.append(ELIDED)
            break
        kept.append(line)
        size += len(line) + 1
    return "\n".join(reversed(kept))


def resume_message(events: list[tuple[str, dict[str, Any]]]) -> str:
    """The user turn that carries the recap into the next run."""
    return RESUME_NOTE.format(recap=recap(events) or "(ما انحفظ شي من الخطوات.)")


def is_resume(events: list[tuple[str, dict[str, Any]]]) -> bool:
    """The task was just put back in line to continue: its latest event says so."""
    return bool(events) and events[-1][0] == RESUMED
