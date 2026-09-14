import time
from dataclasses import dataclass

import httpx
import litellm

from rafiq_agent.llm.base import litellm_model_string

OLLAMA_DEFAULT_BASE = "http://localhost:11434"

# Chat-incapable model families returned by OpenAI-style /models endpoints.
_NON_CHAT_MARKERS = (
    "embedding",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "davinci",
    "babbage",
    "transcribe",
    "image",
    "audio",
    "realtime",
    "search",
    "computer-use",
    "sora",
)


class DiscoveryError(Exception):
    pass


@dataclass
class DiscoveredModel:
    id: str
    display_name: str


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code in (401, 403):
        raise DiscoveryError("المفتاح غير صحيح أو ما عنده صلاحية.")
    if resp.status_code >= 400:
        raise DiscoveryError(f"المزوّد رجّع خطأ ({resp.status_code}).")


def _openai_style(data: list[dict], name_key: str | None = None) -> list[DiscoveredModel]:
    models = []
    for m in data:
        model_id = m.get("id", "")
        if not model_id or any(marker in model_id.lower() for marker in _NON_CHAT_MARKERS):
            continue
        models.append(
            DiscoveredModel(id=model_id, display_name=m.get(name_key, model_id) if name_key else model_id)
        )
    return models


async def discover_models(provider: str, api_key: str | None, base_url: str | None) -> list[DiscoveredModel]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if provider == "anthropic":
                resp = await client.get(
                    "https://api.anthropic.com/v1/models",
                    params={"limit": 100},
                    headers={"x-api-key": api_key or "", "anthropic-version": "2023-06-01"},
                )
                _raise_for_status(resp)
                return [
                    DiscoveredModel(id=m["id"], display_name=m.get("display_name", m["id"]))
                    for m in resp.json().get("data", [])
                ]

            if provider == "gemini":
                resp = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": api_key or "", "pageSize": 200},
                )
                _raise_for_status(resp)
                return [
                    DiscoveredModel(
                        id=m["name"].removeprefix("models/"), display_name=m.get("displayName", m["name"])
                    )
                    for m in resp.json().get("models", [])
                    if "generateContent" in m.get("supportedGenerationMethods", [])
                ]

            if provider == "ollama":
                base = (base_url or OLLAMA_DEFAULT_BASE).rstrip("/")
                resp = await client.get(f"{base}/api/tags")
                _raise_for_status(resp)
                return [
                    DiscoveredModel(id=m["name"], display_name=m["name"])
                    for m in resp.json().get("models", [])
                ]

            endpoints = {
                "openai": "https://api.openai.com/v1/models",
                "deepseek": "https://api.deepseek.com/models",
                "groq": "https://api.groq.com/openai/v1/models",
                "mistral": "https://api.mistral.ai/v1/models",
                "xai": "https://api.x.ai/v1/models",
                "openrouter": "https://openrouter.ai/api/v1/models",
            }
            if provider == "custom":
                if not base_url:
                    raise DiscoveryError("لازم تحدد Base URL للمزوّد المخصص.")
                url = f"{base_url.rstrip('/')}/models"
            elif provider in endpoints:
                url = endpoints[provider]
            else:
                raise DiscoveryError(f"مزوّد غير معروف: {provider}")

            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            resp = await client.get(url, headers=headers)
            _raise_for_status(resp)
            data = resp.json().get("data", [])
            models = _openai_style(data, name_key="name" if provider == "openrouter" else None)
            if provider == "openai":
                created = {m.get("id"): m.get("created", 0) for m in data}
                models.sort(key=lambda m: created.get(m.id, 0), reverse=True)
            return models
    except httpx.ConnectError as exc:
        raise DiscoveryError("ما قدرت اتصل بالمزوّد — تأكد من الإنترنت أو من الـ Base URL.") from exc
    except httpx.TimeoutException as exc:
        raise DiscoveryError("المزوّد ما رد بالوقت المحدد.") from exc


@dataclass
class VerifyResult:
    ok: bool
    latency_ms: int
    supports_tools: bool | None
    error: str | None


def _capability(model: str, key: str) -> bool | None:
    """True/False only when litellm's registry actually knows the model; None means unknown."""
    try:
        info = litellm.get_model_info(model=model)
    except Exception:  # noqa: BLE001 - litellm raises for models missing from its registry
        return None
    value = info.get(key)
    return bool(value) if value is not None else None


def _supports_tools(model: str) -> bool | None:
    return _capability(model, "supports_function_calling")


def supports_vision(model: str) -> bool | None:
    return _capability(model, "supports_vision")


async def verify_model(
    provider: str, model_id: str, api_key: str | None, base_url: str | None
) -> VerifyResult:
    model = litellm_model_string(provider, model_id)
    if provider == "ollama" and not base_url:
        base_url = OLLAMA_DEFAULT_BASE
    started = time.perf_counter()
    try:
        await litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
            api_key=api_key,
            api_base=base_url,
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001 - any provider failure is a verification failure
        return VerifyResult(
            ok=False,
            latency_ms=int((time.perf_counter() - started) * 1000),
            supports_tools=None,
            error=friendly_error(exc),
        )
    return VerifyResult(
        ok=True,
        latency_ms=int((time.perf_counter() - started) * 1000),
        supports_tools=_supports_tools(model),
        error=None,
    )


def friendly_error(exc: Exception) -> str:
    name = type(exc).__name__
    if "Authentication" in name:
        return "المفتاح غير صحيح."
    if "NotFound" in name:
        return "الموديل غير موجود عند هالمزوّد، أو ما عندك صلاحية عليه."
    if "RateLimit" in name:
        return "تجاوزت حد الاستخدام أو الرصيد خلص."
    if "Connection" in name or "Timeout" in name:
        return "ما قدرت اتصل بالمزوّد."
    return str(exc)[:300]
