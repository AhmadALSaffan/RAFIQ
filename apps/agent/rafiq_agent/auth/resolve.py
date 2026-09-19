"""The one place that turns an agent (an `LlmModel`) into a working provider.

Every caller that used to read `get_api_key(model.api_key_ref)` now comes through here, so
API-key agents behave exactly as before and account-based ones get their own credentials
— never another agent's.
"""

from rafiq_agent.auth.base import AuthError, Credentials
from rafiq_agent.i18n import tr
from rafiq_agent.llm.base import LlmProvider
from rafiq_agent.storage.models import LlmModel
from rafiq_agent.storage.secrets import get_api_key

DISCONNECTED = "الحساب المربوط بهالنموذج مفصول — اربطه من جديد من الإعدادات ← الحسابات المتصلة."


def credentials_for(model: LlmModel) -> Credentials:
    if model.auth_method == "oauth":
        account = model.account
        if account is None or account.status != "connected" or not account.secret_ref:
            raise AuthError(tr(DISCONNECTED))
        token = get_api_key(account.secret_ref)
        if not token:
            raise AuthError(tr(DISCONNECTED))
        return Credentials(api_key=token, base_url=model.base_url, account_id=account.id)
    return Credentials(api_key=get_api_key(model.api_key_ref), base_url=model.base_url)


async def helper_llm(fallback: "LlmProvider | None" = None) -> "LlmProvider | None":
    """The model Rafiq uses for its own chores — summarising a long chat, writing a commit
    message — when the user picked one. Falls back to whatever the caller was going to use,
    so nothing breaks if the chosen model is gone."""
    from rafiq_agent.core.agent_runtime import load_settings
    from rafiq_agent.storage.db import SessionLocal
    from rafiq_agent.storage.models import LlmModel

    chosen = (await load_settings()).helper_model_id
    if not chosen:
        return fallback
    async with SessionLocal() as session:
        model = await session.get(LlmModel, chosen)
    if model is None or model.verify_ok is False:
        return fallback
    return llm_for(model)


def llm_for(
    model: LlmModel,
    *,
    temperature: float | None = None,
    max_tokens: int | None = None,
    reasoning_effort: str | None = None,
    fallback: LlmModel | None = None,
):
    """A provider for this agent, capped per credential, retried when the provider pushes
    back, and — if `fallback` is given — handed to that agent when it still fails."""
    from rafiq_agent.llm.resilience import ResilientProvider

    backup = None
    if fallback is not None and fallback.id != model.id:
        try:
            backup = llm_for(
                fallback, temperature=temperature, max_tokens=max_tokens, reasoning_effort=reasoning_effort
            )
        except AuthError:
            backup = None  # a broken fallback must not break the agent itself
    return ResilientProvider(
        _provider_for(model, temperature=temperature, max_tokens=max_tokens, reasoning_effort=reasoning_effort),
        key=f"{model.provider}:{model.account_id or model.api_key_ref or model.base_url or 'default'}",
        fallback=backup,
    )


def _provider_for(
    model: LlmModel,
    *,
    temperature: float | None,
    max_tokens: int | None,
    reasoning_effort: str | None,
):
    """An `LlmProvider` — or, for Copilot agents, a `CopilotProvider` with the same surface."""
    creds = credentials_for(model)
    base_url, headers = creds.base_url, None
    if model.auth_method == "oauth":
        from rafiq_agent.auth.registry import adapter_for

        adapter = adapter_for(model.provider)
        if adapter is not None and hasattr(adapter, "request_headers"):
            base_url = adapter.base_url()
            headers = adapter.request_headers()
    if model.provider == "github_copilot":
        from rafiq_agent.llm.copilot import CopilotProvider, sdk_available

        if not sdk_available():
            raise AuthError(tr("مكتبة GitHub Copilot مش مثبّتة بهالنسخة."))
        return CopilotProvider(
            account_id=creds.account_id or "",
            token=creds.api_key or "",
            model_id=model.model_id,
            reasoning_effort=reasoning_effort,
        )
    return LlmProvider(
        model.provider,
        model.model_id,
        creds.api_key,
        base_url,
        temperature=temperature,
        max_tokens=max_tokens,
        reasoning_effort=reasoning_effort,
        extra_headers=headers,
        options=model.options,
    )
