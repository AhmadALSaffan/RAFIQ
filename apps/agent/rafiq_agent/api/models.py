import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.auth.base import redact
from rafiq_agent.i18n import tr
from rafiq_agent.llm.discovery import DiscoveryError, VerifyResult, discover_models, verify_model
from rafiq_agent.schemas.models import (
    DiscoveredModelOut,
    DiscoverRequest,
    ModelAuthUpdate,
    ModelCreate,
    ModelFallbackUpdate,
    ModelOut,
)
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import AuthAccount, LlmModel
from rafiq_agent.storage.secrets import delete_api_key, get_api_key, store_api_key

router = APIRouter(prefix="/models", tags=["models"], dependencies=[Depends(require_token)])


def _to_out(model: LlmModel) -> ModelOut:
    return ModelOut(
        id=model.id,
        name=model.name,
        provider=model.provider,
        model_id=model.model_id,
        base_url=model.base_url,
        has_key=bool(model.api_key_ref),
        created_at=model.created_at,
        verify_ok=model.verify_ok,
        verify_error=model.verify_error,
        verify_latency_ms=model.verify_latency_ms,
        verified_at=model.verified_at,
        supports_tools=model.supports_tools,
        auth_method=model.auth_method or "api_key",
        account_id=model.account_id,
        account_label=model.account.label if model.account else None,
        account_status=model.account.status if model.account else None,
        fallback_model_id=model.fallback_model_id,
        options=dict(model.options or {}),
    )


async def _connected_account(session: AsyncSession, account_id: str | None, provider: str) -> AuthAccount:
    account = await session.get(AuthAccount, account_id) if account_id else None
    if account is None or account.provider != provider:
        raise HTTPException(status_code=400, detail=tr("اختار حساب مربوط لهالمزوّد."))
    if account.status != "connected" or not account.secret_ref:
        raise HTTPException(status_code=400, detail=tr("الحساب مفصول — اربطه من جديد من الإعدادات."))
    return account


async def _verify_with_account(
    account: AuthAccount, model_id: str, base_url: str | None = None
) -> VerifyResult:
    """Checks an agent that signs in with an account, using that account's own credential."""
    from rafiq_agent.llm import copilot

    token = get_api_key(account.secret_ref)
    from rafiq_agent.auth.registry import adapter_for

    adapter = adapter_for(account.provider)
    if adapter is not None and hasattr(adapter, "list_models"):
        started_at = time.perf_counter()
        try:
            ids = {model for model, _ in await adapter.list_models(token or "")}
        except Exception as exc:  # noqa: BLE001
            return VerifyResult(False, 0, None, redact(str(exc))[:300])
        latency = int((time.perf_counter() - started_at) * 1000)
        if model_id not in ids:
            return VerifyResult(False, latency, None, tr("هالموديل مش متاح لهالحساب."))
        return VerifyResult(True, latency, None, None)
    if account.provider != "github_copilot":
        # Key-issuing sign-ins (OpenRouter) end with an ordinary API key: verify it the
        # same way a pasted key is verified.
        if not token:
            return VerifyResult(False, 0, None, tr("الحساب مفصول — اربطه من جديد من الإعدادات."))
        return await verify_model(account.provider, model_id, token, base_url)

    started = time.perf_counter()

    def result(ok: bool, error: str | None) -> VerifyResult:
        return VerifyResult(
            ok=ok,
            latency_ms=int((time.perf_counter() - started) * 1000),
            supports_tools=True if ok else None,
            error=error,
        )

    if not token:
        return result(False, tr("الحساب مفصول — اربطه من جديد من الإعدادات."))
    try:
        available = {model for model, _ in await copilot.list_models(account.id, token)}
    except Exception as exc:  # noqa: BLE001 - any runtime failure is a verification failure
        return result(False, redact(str(exc))[:300])
    if model_id not in available:
        return result(False, tr("هالموديل مش متاح لحساب Copilot هاد."))
    return result(True, None)


def _apply_verification(model: LlmModel, result: VerifyResult) -> None:
    model.verify_ok = result.ok
    model.verify_error = result.error
    model.verify_latency_ms = result.latency_ms
    model.verified_at = datetime.now(UTC)
    if result.ok:
        model.supports_tools = result.supports_tools


@router.get("", response_model=list[ModelOut])
async def list_models(session: AsyncSession = Depends(get_session)) -> list[ModelOut]:
    result = await session.execute(select(LlmModel).order_by(LlmModel.created_at))
    return [_to_out(m) for m in result.scalars().all()]


@router.post("/discover", response_model=list[DiscoveredModelOut])
async def discover(
    body: DiscoverRequest, session: AsyncSession = Depends(get_session)
) -> list[DiscoveredModelOut]:
    if body.account_id and body.provider != "github_copilot":
        account = await _connected_account(session, body.account_id, body.provider)
        from rafiq_agent.auth.registry import adapter_for

        adapter = adapter_for(account.provider)
        if adapter is not None and hasattr(adapter, "list_models"):
            try:
                listed = await adapter.list_models(get_api_key(account.secret_ref) or "")
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=400, detail=redact(str(exc))[:300]) from exc
            return [DiscoveredModelOut(id=model, display_name=name) for model, name in listed]
        try:
            found = await discover_models(body.provider, get_api_key(account.secret_ref), body.base_url)
        except DiscoveryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return [DiscoveredModelOut(id=m.id, display_name=m.display_name) for m in found]
    if body.provider == "github_copilot":
        from rafiq_agent.llm import copilot

        account = await _connected_account(session, body.account_id, body.provider)
        try:
            found = await copilot.list_models(account.id, get_api_key(account.secret_ref) or "")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=tr("ما قدرت أجيب موديلات Copilot: {0}", redact(str(exc))[:200])
            ) from exc
        return [DiscoveredModelOut(id=model, display_name=name) for model, name in found]
    try:
        found = await discover_models(body.provider, body.api_key, body.base_url, body.options)
    except DiscoveryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [DiscoveredModelOut(id=m.id, display_name=m.display_name) for m in found]


@router.post("", response_model=ModelOut, status_code=201)
async def create_model(body: ModelCreate, session: AsyncSession = Depends(get_session)) -> ModelOut:
    # Only save a model that actually answers — a broken config would just fail every task later.
    if body.provider == "github_copilot" or body.auth_method == "oauth":
        account = await _connected_account(session, body.account_id, body.provider)
        result = await _verify_with_account(account, body.model_id, body.base_url)
    else:
        account = None
        result = await verify_model(body.provider, body.model_id, body.api_key, body.base_url, body.options)
    if not result.ok:
        raise HTTPException(status_code=400, detail=tr("الموديل ما اشتغل: {0}", result.error))

    api_key_ref = store_api_key(body.api_key) if body.api_key and account is None else None
    model = LlmModel(
        name=body.name,
        provider=body.provider,
        model_id=body.model_id,
        base_url=body.base_url,
        api_key_ref=api_key_ref,
        auth_method="oauth" if account else "api_key",
        account_id=account.id if account else None,
        options={k: v for k, v in body.options.items() if v} or None,
    )
    _apply_verification(model, result)
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return _to_out(model)


@router.post("/{model_id}/verify", response_model=ModelOut)
async def reverify_model(model_id: str, session: AsyncSession = Depends(get_session)) -> ModelOut:
    model = await session.get(LlmModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    if model.auth_method == "oauth":
        if model.account is None or model.account.status != "connected":
            result = VerifyResult(False, 0, None, tr("الحساب مفصول — اربطه من جديد من الإعدادات."))
        else:
            result = await _verify_with_account(model.account, model.model_id, model.base_url)
    else:
        result = await verify_model(
            model.provider, model.model_id, get_api_key(model.api_key_ref), model.base_url, model.options
        )
    _apply_verification(model, result)
    await session.commit()
    await session.refresh(model)
    return _to_out(model)


@router.put("/{model_id}/account", response_model=ModelOut)
async def set_model_account(
    model_id: str, body: ModelAuthUpdate, session: AsyncSession = Depends(get_session)
) -> ModelOut:
    """Switches the account one agent signs in with. Other agents keep theirs."""
    model = await session.get(LlmModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    if model.auth_method != "oauth":
        raise HTTPException(status_code=400, detail=tr("هالنموذج بيشتغل بمفتاح، مش بحساب."))
    account = await _connected_account(session, body.account_id, model.provider)
    model.account_id = account.id
    _apply_verification(model, await _verify_with_account(account, model.model_id, model.base_url))
    await session.commit()
    await session.refresh(model)
    return _to_out(model)


@router.put("/{model_id}/fallback", response_model=ModelOut)
async def set_model_fallback(
    model_id: str, body: ModelFallbackUpdate, session: AsyncSession = Depends(get_session)
) -> ModelOut:
    """Which agent takes over when this one's provider keeps failing."""
    model = await session.get(LlmModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    target = body.fallback_model_id or None
    if target is not None and (target == model_id or not await session.get(LlmModel, target)):
        raise HTTPException(status_code=400, detail=tr("اختار نموذج تاني كاحتياطي."))
    model.fallback_model_id = target
    await session.commit()
    await session.refresh(model)
    return _to_out(model)


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, session: AsyncSession = Depends(get_session)) -> None:
    model = await session.get(LlmModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    delete_api_key(model.api_key_ref)
    # Agents that fell back to this one simply have no fallback now.
    for other in (await session.execute(select(LlmModel).where(LlmModel.fallback_model_id == model_id))).scalars():
        other.fallback_model_id = None
    await session.delete(model)
    await session.commit()
