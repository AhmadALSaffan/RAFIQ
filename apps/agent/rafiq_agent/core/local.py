"""Models that run on this computer (Ollama, LM Studio): how big a window to ask for, and which
tools they get.

Ollama reads 2,048–8,192 tokens unless a request asks for more (`num_ctx`), and changing that
number reloads the model, so Rafiq asks for one fixed size per model: what the model itself
supports (from Ollama's /api/show), capped by what this machine's memory comfortably holds.
A local model also reads its prompt far slower than a cloud one, so it gets the lean set of
tools (core/fit.py) unless the chat asks for more.
"""

from __future__ import annotations

import json
import logging
import urllib.request

log = logging.getLogger(__name__)

LOCAL_PROVIDERS = frozenset({"ollama", "lm_studio"})
OLLAMA_DEFAULT = "http://127.0.0.1:11434"  # not localhost: see llm/presets.py::prefer_ipv4
# Asked for when Ollama can't say what the model supports (it's down, or the model is gone).
OLLAMA_FALLBACK = 8_192
# How long Ollama keeps the model in memory after a request: the next message starts at once
# instead of waiting for the model to load again (Ollama's own default is 5 minutes).
KEEP_ALIVE = "30m"

_max_by_model: dict[tuple[str, str], int] = {}


def is_local(provider: str | None) -> bool:
    return provider in LOCAL_PROVIDERS


def memory_budget() -> int:
    """The window this machine holds comfortably next to a small model: the cache that a
    window needs grows with it, and one that spills out of the graphics card's memory is slow."""
    try:
        import psutil

        gb = psutil.virtual_memory().total / 2**30
    except Exception:  # noqa: BLE001
        return OLLAMA_FALLBACK
    return 16_384 if gb >= 12 else OLLAMA_FALLBACK


def ollama_max(model_id: str, base_url: str | None = None) -> int | None:
    """The longest context this model was trained for, as Ollama reports it (cached; a failed
    lookup isn't, so it's tried again once Ollama is up)."""
    from rafiq_agent.llm.presets import prefer_ipv4

    base = (prefer_ipv4(base_url) or OLLAMA_DEFAULT).rstrip("/").removesuffix("/v1")
    key = (base, model_id)
    if key in _max_by_model:
        return _max_by_model[key]
    try:
        request = urllib.request.Request(
            f"{base}/api/show", data=json.dumps({"model": model_id}).encode(), headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(request, timeout=3) as response:  # noqa: S310 - the user's own Ollama
            info = json.loads(response.read()).get("model_info") or {}
    except Exception:  # noqa: BLE001
        log.debug("ollama /api/show failed for %s", model_id, exc_info=True)
        return None
    found = [int(v) for k, v in info.items() if k.endswith(".context_length") and isinstance(v, (int, float))]
    if not found:
        return None
    _max_by_model[key] = max(found)
    return _max_by_model[key]


def ollama_window(model_id: str, base_url: str | None = None) -> int:
    most = ollama_max(model_id, base_url)
    if not most:
        return OLLAMA_FALLBACK
    return max(2_048, min(most, memory_budget()))
