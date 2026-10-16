"""What went wrong with a model, in a form the app can act on.

A provider's failure used to reach the user as one of four generic lines, or as the raw
error text. Neither says what to do. Each failure is sorted here into a *kind*, and the app
opens a guide for that kind: numbered steps, pictures and the right link. The user doesn't
have to work out what «403 Forbidden» means.

Kinds (stable codes, shared with the UI's guides):

- `copilot_not_enabled`: signed in to GitHub, but Copilot isn't turned on for the account.
- `region_blocked`: the provider doesn't serve the user's country; a VPN helps.
- `bad_key`: the API key is wrong, revoked or expired.
- `no_credit`: the account at the provider has no balance or quota left.
- `rate_limited`: too many requests for now.
- `local_server_down`: Ollama or LM Studio isn't running.
- `cant_reach`: the provider can't be reached at all (offline, or blocked on the network).
- `model_not_found`: the model's name isn't one the provider offers this account.
"""

from __future__ import annotations

from rafiq_agent.auth.base import redact
from rafiq_agent.i18n import tr

LOCAL_PROVIDERS = {"ollama", "ollama_chat", "lm_studio"}

PROVIDER_NAMES = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "gemini": "Google Gemini",
    "vertex_ai": "Google Vertex AI",
    "deepseek": "DeepSeek",
    "github_copilot": "GitHub Copilot",
    "openrouter": "OpenRouter",
    "xai": "xAI",
    "mistral": "Mistral",
    "groq": "Groq",
    "azure": "Azure OpenAI",
    "bedrock": "AWS Bedrock",
    "ollama": "Ollama",
    "ollama_chat": "Ollama",
    "lm_studio": "LM Studio",
}

# Lower-case fragments of the providers' own messages, most specific first.
_COPILOT_OFF = (
    "not authorized to use this copilot feature",
    "copilot is not enabled",
    "no copilot subscription",
    "do not have access to copilot",
    "copilot access is not enabled",
    "you are not authorized to use copilot",
)
_REGION = (
    "unsupported_country_region_territory",
    "country, region, or territory not supported",
    "not supported in your country",
    "not available in your country",
    "not available in your region",
    "unavailable in your region",
    "user location is not supported",
    "location is not supported",
    "region is not supported",
    "not available in your location",
    "unavailable for legal reasons",
    "blocked in your region",
)
_NO_CREDIT = (
    "insufficient_quota",
    "exceeded your current quota",
    "credit balance is too low",
    "insufficient balance",
    "insufficient credits",
    "insufficient_balance",
    "payment required",
    "billing",
    "out of credits",
    "requires more credits",
)
_BAD_KEY = (
    "invalid api key",
    "incorrect api key",
    "invalid_api_key",
    "invalid x-api-key",
    "api key not valid",
    "api_key_invalid",
    "authentication_error",
    "no api key provided",
    "invalid authentication",
    "unauthenticated",
)


def provider_of(model_or_provider: str | None) -> str | None:
    """'deepseek/deepseek-chat' or 'deepseek' → 'deepseek'."""
    if not model_or_provider:
        return None
    head = model_or_provider.split("/", 1)[0] if "/" in model_or_provider else model_or_provider
    return head if head in PROVIDER_NAMES else None


def provider_name(provider: str | None) -> str | None:
    return PROVIDER_NAMES.get(provider or "")


def classify(exc: BaseException | str, provider: str | None = None) -> str | None:
    """The kind of failure, or None when it's none of the known ones."""
    if isinstance(exc, BaseException):
        explicit = getattr(exc, "kind", None)
        if explicit:
            return explicit
        name = type(exc).__name__
        status = getattr(exc, "status_code", None)
        provider = provider or provider_of(getattr(exc, "llm_provider", None))
        text = f"{name} {exc}".lower()
    else:
        name, status, text = "", None, exc.lower()

    if any(s in text for s in _COPILOT_OFF):
        return "copilot_not_enabled"
    # The Copilot runtime's own refusal: a JSON-RPC failure with a 403 inside, e.g.
    # "Request models.list failed … 403 Forbidden … forbidden: access denied". GitHub
    # accepted the sign-in; Copilot didn't let the account in (not turned on, a policy, or
    # for a few minutes after several sign-ins in a row).
    copilot_call = "json-rpc" in text or "copilot" in text or provider == "github_copilot"
    if copilot_call and ('"status":403' in text or "forbidden" in text):
        return "copilot_not_enabled"
    if status == 451 or any(s in text for s in _REGION):
        return "region_blocked"
    # Anthropic answers a request from an unsupported region with a bare 403 "Request not allowed".
    if provider == "anthropic" and "request not allowed" in text:
        return "region_blocked"
    if status == 402 or any(s in text for s in _NO_CREDIT):
        return "no_credit"
    if "authentication" in name.lower() or status == 401 or any(s in text for s in _BAD_KEY):
        return "bad_key"
    if "ratelimit" in name.lower() or status == 429 or "rate limit" in text or "too many requests" in text:
        return "rate_limited"
    connection = (
        "connection" in name.lower()
        or "timeout" in name.lower()
        or "connecterror" in text
        or "connection refused" in text
        or "actively refused" in text
        or "failed to establish a new connection" in text
        or "name or service not known" in text
        or "getaddrinfo failed" in text
    )
    if connection:
        return "local_server_down" if provider in LOCAL_PROVIDERS else "cant_reach"
    if "notfound" in name.lower() or status == 404 or "model_not_found" in text or "does not exist" in text:
        return "model_not_found"
    return None


def message_for(kind: str, provider: str | None = None) -> str:
    """One line saying what happened; the guide in the app says what to do about it."""
    who = provider_name(provider) or tr("المزوّد")
    messages = {
        "copilot_not_enabled": tr("حساب GitHub تبعك ما فيه Copilot مفعّل. التفعيل مجاني وبياخد دقيقة."),
        "region_blocked": tr("{0} ما بيقدّم الخدمة ببلدك. شغّل VPN وجرّب من جديد.", who),
        "bad_key": tr("{0} رفض المفتاح: غلط، أو انلغى، أو انتهت صلاحيته.", who),
        "no_credit": tr("رصيدك عند {0} خلص.", who),
        "rate_limited": tr("{0} طلب نستنى شوي: وصلت لحد الطلبات بالدقيقة.", who),
        "local_server_down": tr("{0} مش شغّال على جهازك.", who),
        "cant_reach": tr("ما قدرت أوصل لـ {0}.", who),
        "model_not_found": tr("{0} ما عنده هالموديل، أو حسابك ما بيوصله.", who),
    }
    return messages[kind]


def explain(exc: BaseException | str, provider: str | None = None) -> tuple[str, str | None]:
    """(what to tell the user, the kind of failure or None)."""
    kind = classify(exc, provider)
    if isinstance(exc, BaseException):
        provider = provider or provider_of(getattr(exc, "llm_provider", None))
    if kind:
        return message_for(kind, provider), kind
    text = str(exc)
    return redact(text)[:300] if text else tr("صار خطأ ما توقّعناه."), None


def error_event(exc: BaseException, model: str | None = None) -> dict[str, str | None]:
    """The fields an «error» event carries in a chat or task stream."""
    provider = provider_of(model) or provider_of(getattr(exc, "llm_provider", None))
    message, kind = explain(exc, provider)
    return {"message": message, "kind": kind, "provider": provider_name(provider)}


class GuidedError(Exception):
    """An error the API answers with a kind, so the app can open the right guide."""

    def __init__(self, message: str, kind: str | None = None, provider: str | None = None, status: int = 400):
        super().__init__(message)
        self.message = message
        self.kind = kind
        self.provider = provider
        self.status = status

    @classmethod
    def of(cls, exc: BaseException | str, provider: str | None = None, *, status: int = 400, prefix: str | None = None) -> GuidedError:
        message, kind = explain(exc, provider)
        return cls(prefix.format(message) if prefix else message, kind, provider_name(provider), status)
