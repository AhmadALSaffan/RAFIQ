"""What each provider needs beyond "a key and maybe a URL".

Most providers are an API key and an endpoint; a few need more:

* **Azure OpenAI** — your resource's endpoint, an API version, and the *deployment* name as
  the model.
* **AWS Bedrock** — an access key ID and secret (kept together, as JSON, in the keychain) and
  a region.
* **Google Vertex AI** — a service-account JSON key (in the keychain), a project and a
  location.

Non-secret settings (API version, region, project, location) live in `LlmModel.options`;
secrets only ever in the keychain, like every other key.
"""

import json
from typing import Any

# OpenAI-compatible providers litellm knows by name. The URL here is the default; a model
# can override it (e.g. DashScope's mainland-China endpoint).
PRESET_BASES: dict[str, str] = {
    "cerebras": "https://api.cerebras.ai/v1",
    "fireworks_ai": "https://api.fireworks.ai/inference/v1",
    "together_ai": "https://api.together.xyz/v1",
    "dashscope": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "moonshot": "https://api.moonshot.ai/v1",
    "zai": "https://api.z.ai/api/paas/v4",
    "lm_studio": "http://localhost:1234/v1",
}

AZURE_API_VERSION = "2024-10-21"
VERTEX_LOCATION = "us-central1"

# Offered when a provider has no model list to read (or it can't be read).
SUGGESTED: dict[str, list[tuple[str, str]]] = {
    "vertex_ai": [
        ("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ("gemini-2.5-flash", "Gemini 2.5 Flash"),
        ("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"),
    ],
    "zai": [("glm-4.6", "GLM-4.6"), ("glm-4.5", "GLM-4.5"), ("glm-4.5-air", "GLM-4.5-Air")],
    "moonshot": [("kimi-k2-0905-preview", "Kimi K2"), ("kimi-k2-turbo-preview", "Kimi K2 Turbo")],
}


class ProviderConfigError(ValueError):
    """The model's settings can't work (a malformed service-account key, say)."""


def parse_json_secret(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "")
    except ValueError as exc:
        raise ProviderConfigError("the saved credentials aren't valid JSON") from exc
    if not isinstance(data, dict):
        raise ProviderConfigError("the saved credentials aren't a JSON object")
    return data


def call_kwargs(
    provider: str, api_key: str | None, base_url: str | None, options: dict[str, Any] | None
) -> dict[str, Any]:
    """The litellm arguments that point a request at this provider with these credentials."""
    options = options or {}
    if provider == "azure":
        return {
            "api_key": api_key,
            "api_base": base_url,
            "api_version": options.get("api_version") or AZURE_API_VERSION,
        }
    if provider == "bedrock":
        creds = parse_json_secret(api_key)
        out = {
            "aws_access_key_id": creds.get("access_key_id"),
            "aws_secret_access_key": creds.get("secret_access_key"),
            "aws_region_name": options.get("region") or creds.get("region") or "us-east-1",
        }
        if creds.get("session_token"):
            out["aws_session_token"] = creds["session_token"]
        return out
    if provider == "vertex_ai":
        account = parse_json_secret(api_key)
        return {
            "vertex_credentials": json.dumps(account),
            "vertex_project": options.get("project") or account.get("project_id"),
            "vertex_location": options.get("location") or VERTEX_LOCATION,
        }
    base = base_url or PRESET_BASES.get(provider)
    if provider == "ollama" and not base:
        base = "http://localhost:11434"
    return {"api_key": api_key or ("lm-studio" if provider == "lm_studio" else None), "api_base": base}


def caches_prompts(model: str) -> bool:
    """Claude (through Anthropic, Bedrock or Vertex) caches only what it's told to; the others
    (OpenAI, DeepSeek, Gemini…) cache repeated prefixes on their own."""
    return "claude" in model.lower()


def with_cache_marks(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Marks the system prompt and the latest user message as cache breakpoints, so each
    step of a tool loop — and the next message in the chat — rereads the long shared prefix
    at the cached price instead of paying for it again."""

    def marked(message: dict[str, Any]) -> dict[str, Any]:
        content = message.get("content")
        if isinstance(content, str):
            if not content:
                return message
            blocks = [{"type": "text", "text": content}]
        elif isinstance(content, list) and content:
            blocks = [dict(b) for b in content]
        else:
            return message
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
        return {**message, "content": blocks}

    out = list(messages)
    if out and out[0].get("role") == "system":
        out[0] = marked(out[0])
    for i in range(len(out) - 1, 0, -1):
        if out[i].get("role") == "user":
            out[i] = marked(out[i])
            break
    return out


# Tools some models already carry. Rafiq skips registering its own version of these, so the
# model uses the one it was built with instead of a duplicate that only competes with it —
# and providers that reject a duplicate name (Copilot does) stop failing outright.
#
# Only add a tool here once the provider really runs it through the API Rafiq calls; a
# wrong entry means the model is offered nothing at all.
NATIVE_TOOLS: dict[str, frozenset[str]] = {
    # Copilot reads and searches the web itself. Leaving both to it also means a Copilot
    # chat never spends the user's Brave/Tavily quota. (It refuses a session outright if
    # web_fetch is redefined, so this is required for that one, not just preferable.)
    "github_copilot": frozenset({"web_fetch", "web_search"}),
}


def native_tools(provider: str, model_id: str | None = None) -> frozenset[str]:
    """The tool names this model provides itself (Rafiq leaves those to it)."""
    return NATIVE_TOOLS.get(provider, frozenset())
