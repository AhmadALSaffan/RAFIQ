"""Which models get the motion guides. A frontier or upper-mid model (Opus, Sonnet, GPT,
Gemini Pro, Grok…) gets the format and the tools and directs the video its own way; a
weaker one (DeepSeek, Qwen, Haiku, Copilot's Auto, the small and local ones) gets the full
guides — the director's playbook, a finished example and the 3D recipes — to follow."""

import re

# Providers whose every model is guided: local runtimes (small models) and the families the
# user named.
GUIDED_PROVIDERS = {"deepseek", "dashscope", "ollama", "lm_studio"}

# Model families and size words that mean a weaker model, matched as whole words in the id.
_GUIDED = re.compile(
    r"(^|[/:._\s-])(deepseek|qwen\d*(\.\d+)?|qwq|haiku|mini|nano|lite|flash-lite|gemma\d*|llama\d*(\.\d+)?|"
    r"phi\d*|mistral-small|ministral|small|tiny|\d+(\.\d+)?b)($|[/:._\s-])",
    re.I,
)


def guided(provider: str | None, model_id: str | None) -> bool:
    """True when this model gets the step-by-step guides; False when it creates freely."""
    provider = (provider or "").lower()
    model = (model_id or "").lower().strip()
    if provider in GUIDED_PROVIDERS:
        return True
    # GitHub Copilot's "Auto" picks a model per request, often a small one.
    if model in {"auto", "copilot-auto"} or model.endswith("/auto"):
        return True
    return bool(_GUIDED.search(model))
