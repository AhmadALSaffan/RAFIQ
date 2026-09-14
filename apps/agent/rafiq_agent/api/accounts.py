"""Connected accounts: sign in with a provider account, see who is connected, disconnect.

Tokens go straight from the provider into the OS keychain; the database keeps only a
reference and a display label, and no response here ever includes a credential.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.auth.base import AuthError
from rafiq_agent.auth.registry import ADAPTERS, adapter_for
from rafiq_agent.i18n import current_locale, tr
from rafiq_agent.schemas.accounts import AccountOut, AccountProviderOut, ConnectPollOut, ConnectStartOut
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import AuthAccount, LlmModel
from rafiq_agent.storage.secrets import delete_api_key, get_api_key, store_api_key

router = APIRouter(prefix="/accounts", tags=["accounts"], dependencies=[Depends(require_token)])
# The provider's redirect lands here from the user's browser, which has no bearer token.
# It can only finish a flow an authenticated caller started (unguessable, single-use id),
# and the code is worthless without the PKCE verifier that never leaves this process.
callback_router = APIRouter(prefix="/accounts/callback", tags=["accounts"])

# flow_id → provider, so a poll can only ever complete the flow it started.
_flows: dict[str, str] = {}


async def _to_out(session: AsyncSession, account: AuthAccount) -> AccountOut:
    used = await session.execute(select(LlmModel.name).where(LlmModel.account_id == account.id))
    return AccountOut(
        id=account.id,
        provider=account.provider,
        method=account.method,
        label=account.label,
        status=account.status,
        created_at=account.created_at,
        verified_at=account.verified_at,
        used_by=list(used.scalars().all()),
    )


@router.get("/providers", response_model=list[AccountProviderOut])
async def list_providers() -> list[AccountProviderOut]:
    out = []
    for adapter in ADAPTERS.values():
        reason = adapter.unavailable_reason()
        out.append(
            AccountProviderOut(
                id=adapter.provider,
                name=adapter.name,
                method=adapter.method,
                experimental=adapter.experimental,
                available=reason is None,
                unavailable_reason=reason,
            )
        )
    return out


@router.get("", response_model=list[AccountOut])
async def list_accounts(session: AsyncSession = Depends(get_session)) -> list[AccountOut]:
    rows = await session.execute(select(AuthAccount).order_by(AuthAccount.created_at))
    return [await _to_out(session, a) for a in rows.scalars().all()]


@router.post("/{provider}/connect", response_model=ConnectStartOut)
async def start_connect(provider: str, request: Request, target: str | None = None) -> ConnectStartOut:
    adapter = adapter_for(provider)
    if adapter is None:
        raise HTTPException(status_code=404, detail=tr("مزوّد غير معروف"))
    reason = adapter.unavailable_reason()
    if reason:
        raise HTTPException(status_code=400, detail=reason)
    try:
        callback = f"{str(request.base_url).rstrip('/')}/accounts/callback/{provider}"
        # `target` picks the upstream service for adapters that front several (AuthAI).
        started = await (adapter.start(callback, target=target) if target else adapter.start(callback))
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _flows[started.flow_id] = provider
    return ConnectStartOut(**started.__dict__)


@router.post("/connect/{flow_id}/poll", response_model=ConnectPollOut)
async def poll_connect(flow_id: str, session: AsyncSession = Depends(get_session)) -> ConnectPollOut:
    provider = _flows.get(flow_id)
    adapter = adapter_for(provider) if provider else None
    if adapter is None:
        return ConnectPollOut(status="expired", message=tr("انتهت محاولة الدخول — ابدأ من جديد."))

    outcome = await adapter.poll(flow_id)
    if outcome.status != "complete" or outcome.identity is None:
        if outcome.status != "pending":
            _flows.pop(flow_id, None)
        return ConnectPollOut(status=outcome.status, message=outcome.message)
    _flows.pop(flow_id, None)

    identity = outcome.identity
    # Reconnecting the same login revives its row, so agents bound to it work again.
    existing = await session.execute(
        select(AuthAccount).where(
            AuthAccount.provider == provider, AuthAccount.external_id == identity.external_id
        )
    )
    account = existing.scalars().first()
    if account is None:
        account = AuthAccount(provider=provider, method=adapter.method, external_id=identity.external_id)
        session.add(account)
    else:
        delete_api_key(account.secret_ref)
    account.label = identity.label
    account.secret_ref = store_api_key(identity.token)
    account.status = "connected"
    account.verified_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(account)
    return ConnectPollOut(status="complete", account=await _to_out(session, account))


@router.delete("/{account_id}", status_code=204)
async def disconnect(account_id: str, session: AsyncSession = Depends(get_session)) -> None:
    """Forgets this account's token. Only agents bound to *this* account are affected —
    they stop and ask to reconnect; nothing silently switches to another login or key."""
    account = await session.get(AuthAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="account not found")

    adapter = adapter_for(account.provider)
    revoke = getattr(adapter, "revoke", None)
    token = get_api_key(account.secret_ref) if revoke else None
    if revoke and token:
        await revoke(token)  # best effort — the local copy is deleted regardless
    delete_api_key(account.secret_ref)
    if account.provider == "github_copilot":
        from rafiq_agent.llm import copilot

        await copilot.drop_client(account.id)

    in_use = await session.execute(select(LlmModel.id).where(LlmModel.account_id == account.id).limit(1))
    if in_use.first() is None:
        await session.delete(account)
    else:
        account.secret_ref = None
        account.status = "disconnected"
    await session.commit()


_CALLBACK_PAGE = """<!doctype html><html lang="{lang}" dir="{dir}"><meta charset="utf-8">
<title>{app}</title>
<body style="font-family:system-ui,'Segoe UI',Tahoma,sans-serif;background:#141414;color:#eee;
display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:26rem;padding:2rem">
<div style="width:56px;height:56px;border-radius:14px;background:#e68835;margin:0 auto 1rem"></div>
<h1 style="font-size:1.25rem;margin:0 0 .5rem">{title}</h1>
<p style="color:#aaa;line-height:1.7;margin:0">{body}</p>
</div></body></html>"""


@callback_router.get("/{provider}/{flow_id}", response_class=HTMLResponse)
async def browser_callback(provider: str, flow_id: str, code: str = "") -> HTMLResponse:
    adapter = adapter_for(provider)
    receive = getattr(adapter, "receive", None)
    accepted = bool(receive and _flows.get(flow_id) == provider and await receive(flow_id, code))
    loc = current_locale()
    frame = {"lang": loc, "dir": "rtl" if loc == "ar" else "ltr", "app": tr("رفيق")}
    if accepted:
        page = _CALLBACK_PAGE.format(
            **frame, title=tr("تمام، رجعنا لرفيق"), body=tr("فيك تسكّر هالصفحة وترجع للتطبيق.")
        )
    else:
        page = _CALLBACK_PAGE.format(
            **frame,
            title=tr("هالرابط انتهى"),
            body=tr("ابدأ تسجيل الدخول من جديد من رفيق ← الإعدادات ← الحسابات المتصلة."),
        )
    return HTMLResponse(page, status_code=200 if accepted else 400)
