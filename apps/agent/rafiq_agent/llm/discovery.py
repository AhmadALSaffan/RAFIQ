import asyncio
import time
from dataclasses import dataclass

import httpx
import litellm

from rafiq_agent.auth.base import redact
from rafiq_agent.i18n import tr
from rafiq_agent.llm.base import litellm_model_string
from rafiq_agent.llm.presets import PRESET_BASES, SUGGESTED, ProviderConfigError, call_kwargs

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
        raise DiscoveryError(tr("المفتاح غير صحيح أو ما عنده صلاحية."))
    if resp.status_code >= 400:
        raise DiscoveryError(tr("المزوّد رجّع خطأ ({0}).", resp.status_code))


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


def _suggested(provider: str) -> list[DiscoveredModel]:
    return [DiscoveredModel(id=m, display_name=name) for m, name in SUGGESTED.get(provider, [])]


def _bedrock_models(api_key: str | None, options: dict[str, str]) -> list[DiscoveredModel]:
    """Foundation models you can call on demand, plus the cross-region inference profiles
    that newer models (Claude 4 and up) require."""
    import boto3

    creds = call_kwargs("bedrock", api_key, None, options)
    client = boto3.client(
        "bedrock",
        region_name=creds["aws_region_name"],
        aws_access_key_id=creds["aws_access_key_id"],
        aws_secret_access_key=creds["aws_secret_access_key"],
        aws_session_token=creds.get("aws_session_token"),
    )
    out: list[DiscoveredModel] = []
    for profile in client.list_inference_profiles().get("inferenceProfileSummaries", []):
        out.append(
            DiscoveredModel(id=profile["inferenceProfileId"], display_name=profile.get("inferenceProfileName", ""))
        )
    listed = client.list_foundation_models(byOutputModality="TEXT", byInferenceType="ON_DEMAND")
    for model in listed.get("modelSummaries", []):
        name = f"{model.get('providerName', '')} {model.get('modelName', '')}".strip()
        out.append(DiscoveredModel(id=model["modelId"], display_name=name or model["modelId"]))
    return out


async def discover_models(
    provider: str, api_key: str | None, base_url: str | None, options: dict[str, str] | None = None
) -> list[DiscoveredModel]:
    options = options or {}
    if provider == "azure":
        raise DiscoveryError(tr("Azure ما بيعرض قائمة — اكتب اسم الـ deployment تبعك كاسم للموديل."))
    if provider == "vertex_ai":
        return _suggested(provider)
    if provider == "bedrock":
        try:
            return await asyncio.to_thread(_bedrock_models, api_key, options)
        except ProviderConfigError as exc:
            raise DiscoveryError(tr("بيانات AWS مو صحيحة.")) from exc
        except Exception as exc:  # noqa: BLE001 - botocore raises many shapes
            raise DiscoveryError(tr("ما قدرت أجيب موديلات Bedrock: {0}", redact(str(exc))[:200])) from exc
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
                    raise DiscoveryError(tr("لازم تحدد Base URL للمزوّد المخصص."))
                url = f"{base_url.rstrip('/')}/models"
            elif provider in PRESET_BASES:
                url = f"{(base_url or PRESET_BASES[provider]).rstrip('/')}/models"
            elif provider in endpoints:
                url = endpoints[provider]
            else:
                raise DiscoveryError(tr("مزوّد غير معروف: {0}", provider))

            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            resp = await client.get(url, headers=headers)
            if resp.status_code == 404 and SUGGESTED.get(provider):
                return _suggested(provider)  # no model list on this endpoint
            _raise_for_status(resp)
            payload = resp.json()
            # Together answers with a bare list; everyone else wraps it in {"data": [...]}.
            data = payload if isinstance(payload, list) else payload.get("data", [])
            models = _openai_style(data, name_key="name" if provider == "openrouter" else None)
            if provider == "openai":
                created = {m.get("id"): m.get("created", 0) for m in data}
                models.sort(key=lambda m: created.get(m.id, 0), reverse=True)
            return models
    except httpx.ConnectError as exc:
        raise DiscoveryError(tr("ما قدرت اتصل بالمزوّد — تأكد من الإنترنت أو من الـ Base URL.")) from exc
    except httpx.TimeoutException as exc:
        raise DiscoveryError(tr("المزوّد ما رد بالوقت المحدد.")) from exc


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
    provider: str,
    model_id: str,
    api_key: str | None,
    base_url: str | None,
    options: dict[str, str] | None = None,
) -> VerifyResult:
    model = litellm_model_string(provider, model_id)
    started = time.perf_counter()
    try:
        connection = call_kwargs(provider, api_key, base_url, options)
        await litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
            timeout=30,
            **connection,
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
        return tr("المفتاح غير صحيح.")
    if "NotFound" in name:
        return tr("الموديل غير موجود عند هالمزوّد، أو ما عندك صلاحية عليه.")
    if "RateLimit" in name:
        return tr("تجاوزت حد الاستخدام أو الرصيد خلص.")
    if "Connection" in name or "Timeout" in name:
        return tr("ما قدرت اتصل بالمزوّد.")
    return redact(str(exc))[:300]
