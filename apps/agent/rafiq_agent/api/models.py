from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.llm.discovery import DiscoveryError, VerifyResult, discover_models, verify_model
from rafiq_agent.schemas.models import DiscoveredModelOut, DiscoverRequest, ModelCreate, ModelOut
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import LlmModel
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
    )


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
async def discover(body: DiscoverRequest) -> list[DiscoveredModelOut]:
    try:
        found = await discover_models(body.provider, body.api_key, body.base_url)
    except DiscoveryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [DiscoveredModelOut(id=m.id, display_name=m.display_name) for m in found]


@router.post("", response_model=ModelOut, status_code=201)
async def create_model(body: ModelCreate, session: AsyncSession = Depends(get_session)) -> ModelOut:
    # Only save a model that actually answers — a broken config would just fail every task later.
    result = await verify_model(body.provider, body.model_id, body.api_key, body.base_url)
    if not result.ok:
        raise HTTPException(status_code=400, detail=f"الموديل ما اشتغل: {result.error}")

    api_key_ref = store_api_key(body.api_key) if body.api_key else None
    model = LlmModel(
        name=body.name,
        provider=body.provider,
        model_id=body.model_id,
        base_url=body.base_url,
        api_key_ref=api_key_ref,
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
    result = await verify_model(
        model.provider, model.model_id, get_api_key(model.api_key_ref), model.base_url
    )
    _apply_verification(model, result)
    await session.commit()
    await session.refresh(model)
    return _to_out(model)


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, session: AsyncSession = Depends(get_session)) -> None:
    model = await session.get(LlmModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="model not found")
    delete_api_key(model.api_key_ref)
    await session.delete(model)
    await session.commit()
