"""Pictures for models that can't see them.

A model that reads images gets the picture itself. One that doesn't (DeepSeek, many local
models) gets it described in words by the vision model chosen in Settings — the same helper
Motion uses for its frames — so nobody has to install anything for a chat to "see".
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

GENERAL_PROMPT = (
    "أنت عين لموديل ما بيشوف صور. صف كل صورة بدقة بنقاط قصيرة: شو نوعها (لقطة شاشة، صورة، رسم، "
    "مستند…)، كل النصوص اللي فيها حرفياً، العناصر المهمة ووين موجودة، الألوان، وأي شي غريب أو "
    "مكسور. ما تخمّن شي مش ظاهر. اكتب بالعربي، والنصوص الإنجليزية بتضل متل ما هي."
)


async def describe_images(
    images: list[str],
    labels: list[str] | None = None,
    prompt: str = GENERAL_PROMPT,
    max_tokens: int = 1200,
) -> str:
    """The chosen vision model describes the pictures. Raises LookupError when none is set
    (or it stopped working)."""
    from rafiq_agent.auth.resolve import llm_for
    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    chosen = (await load_settings()).vision_model_id
    if not chosen:
        raise LookupError("no vision model")
    async with SessionLocal() as session:
        model = await session.get(LlmModel, chosen)
    if model is None or model.verify_ok is False:
        raise LookupError("the vision model is gone or not working")
    parts: list[dict[str, Any]] = []
    for i, url in enumerate(images):
        label = labels[i] if labels and i < len(labels) else f"الصورة {i + 1}:"
        parts.append({"type": "text", "text": label})
        parts.append({"type": "image_url", "image_url": {"url": url}})
    llm = llm_for(model)
    try:
        return (await llm.complete([{"role": "system", "content": prompt}, {"role": "user", "content": parts}], max_tokens=max_tokens)).strip()
    finally:
        await llm.aclose()


def _cache(path: str) -> Path:
    return Path(f"{path}.description.txt")


async def describe_attachments(attachments: list[Any]) -> dict[str, str]:
    """{attachment id: description} for the pictures among them. Each picture is described
    once and the words kept next to the file, so a long chat doesn't pay for it every turn.
    Empty when no vision model is set — the chat then says it can't see the picture."""
    from rafiq_agent.core.attachments import image_data_url

    out: dict[str, str] = {}
    for a in attachments:
        if getattr(a, "kind", None) != "image":
            continue
        cached = _cache(a.path)
        if cached.is_file():
            out[a.id] = cached.read_text(encoding="utf-8")
            continue
        try:
            text = await describe_images([image_data_url(a.path)], [f"«{a.name}»:"])
        except LookupError:
            return out
        except Exception:  # noqa: BLE001 - a failed description shouldn't sink the message
            continue
        cached.write_text(text, encoding="utf-8")
        out[a.id] = text
    return out
