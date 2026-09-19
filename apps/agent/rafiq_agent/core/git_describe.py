"""A commit message and a pull-request description for a task's diff, from its model."""

import json
from typing import Any

from rafiq_agent.auth.resolve import helper_llm, llm_for
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import LlmModel

MAX_DIFF = 24_000

PROMPT = (
    "اكتب لهالتغييرات: رسالة commit (سطر أول قصير بصيغة الأمر بالإنجليزي، ثم سطر فاضي، ثم "
    "شرح مختصر)، وعنوان pull request، ووصف pull request بالـ Markdown (شو تغيّر، ليش، وكيف يتجرّب). "
    "رجّع JSON فقط بهالمفاتيح: commit_message, pr_title, pr_body."
)


def _parse(text: str) -> dict[str, str]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{") :] if "{" in raw else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return {k: str(data.get(k, "")).strip() for k in ("commit_message", "pr_title", "pr_body")}
        except ValueError:
            pass
    # Not JSON: the whole answer is the commit message; the rest can be edited by hand.
    first = raw.splitlines()[0] if raw else ""
    return {"commit_message": raw, "pr_title": first[:72], "pr_body": raw}


async def describe_changes(model_id: str, title: str, prompt: str, diff: str) -> dict[str, Any]:
    async with SessionLocal() as session:
        model = await session.get(LlmModel, model_id)
        fallback = (
            await session.get(LlmModel, model.fallback_model_id) if model and model.fallback_model_id else None
        )
    if model is None:
        raise RuntimeError("model not found")
    # A commit message from a diff is housekeeping — the helper model writes it when set.
    llm = await helper_llm() or llm_for(model, fallback=fallback)
    clipped = diff if len(diff) <= MAX_DIFF else diff[:MAX_DIFF] + "\n… (truncated)"
    messages = [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": f"المهمة: {title}\n\nالطلب:\n{prompt}\n\nالـ diff:\n```diff\n{clipped}\n```"},
    ]
    text = await llm.complete(messages, max_tokens=1200)
    return _parse(text)
