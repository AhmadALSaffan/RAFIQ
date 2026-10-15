"""Keeps short-lived sign-ins alive, so the user signs in once.

GitHub's newer OAuth apps hand out access tokens that last 8 hours, with a refresh token
that lasts 6 months from its last use. Before this module, Rafiq kept only the access token:
it died after a working day and the user had to connect the account again, every day.

Now an account's token is renewed shortly before it runs out — in the background while the
app is open, and right before it's used after the app was closed for the night. A refresh
token works once: the new pair is written to the keychain before anything else happens, and
one account is renewed by one caller at a time.

Only when the provider refuses the refresh token itself (revoked, or unused for 6 months)
does the account become «disconnected», which is when the app shows «Reconnect».
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime, timedelta

from rafiq_agent.auth.base import AuthError, RefreshRejected, TokenPair
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import AuthAccount
from rafiq_agent.storage.secrets import delete_api_key, get_api_key, replace_api_key, store_api_key

log = logging.getLogger(__name__)

# Renew this long before the access token runs out: a turn that starts just before expiry
# still finishes on a valid token.
RENEW_BEFORE = timedelta(minutes=45)
# How often the background loop looks. Well under RENEW_BEFORE, so nothing slips through.
CHECK_EVERY = 10 * 60

_locks: dict[str, asyncio.Lock] = {}


def _lock(account_id: str) -> asyncio.Lock:
    return _locks.setdefault(account_id, asyncio.Lock())


def _aware(moment: datetime | None) -> datetime | None:
    # SQLite gives the stored UTC time back without its zone.
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def due(account: AuthAccount, now: datetime | None = None) -> bool:
    """Whether this account's access token should be renewed now."""
    expires = _aware(account.expires_at)
    if expires is None or not account.refresh_ref:
        return False
    return (now or datetime.now(UTC)) >= expires - RENEW_BEFORE


def apply_pair(account: AuthAccount, pair: TokenPair, now: datetime | None = None) -> None:
    """Stores a renewed pair under the account's existing references — keychain first."""
    now = now or datetime.now(UTC)
    if account.secret_ref:
        replace_api_key(account.secret_ref, pair.token)
    else:
        account.secret_ref = store_api_key(pair.token)
    if pair.refresh_token:
        if account.refresh_ref:
            replace_api_key(account.refresh_ref, pair.refresh_token)
        else:
            account.refresh_ref = store_api_key(pair.refresh_token)
    account.expires_at = now + timedelta(seconds=pair.expires_in) if pair.expires_in else None
    if pair.refresh_expires_in:
        account.refresh_expires_at = now + timedelta(seconds=pair.refresh_expires_in)
    account.verified_at = now


async def signed_out(account_id: str) -> None:
    """The provider won't take this sign-in any more: say so, so the app offers «Reconnect»
    instead of an account that looks connected while every chat fails."""
    async with SessionLocal() as session:
        account = await session.get(AuthAccount, account_id)
        if account is None:
            return
        delete_api_key(account.secret_ref)
        delete_api_key(account.refresh_ref)
        account.secret_ref = None
        account.refresh_ref = None
        account.expires_at = None
        account.status = "disconnected"
        await session.commit()
    if account.provider == "github_copilot":
        from rafiq_agent.llm import copilot

        await copilot.drop_client(account_id)


async def fresh_token(account_id: str, *, force: bool = False) -> str | None:
    """The account's access token, renewed first when it's about to run out (or `force`,
    when the provider has just refused it). None when the account is gone or disconnected.
    A network failure while renewing keeps the current token: the next try may work."""
    from rafiq_agent.auth.registry import adapter_for

    async with _lock(account_id), SessionLocal() as session:
        account = await session.get(AuthAccount, account_id)
        if account is None or account.status != "connected":
            return None
        if not (force or due(account)):
            return get_api_key(account.secret_ref)
        adapter = adapter_for(account.provider)
        refresh_token = get_api_key(account.refresh_ref)
        if adapter is None or not hasattr(adapter, "refresh") or not refresh_token:
            return get_api_key(account.secret_ref)
        try:
            pair = await adapter.refresh(refresh_token)
        except RefreshRejected:
            rejected = True
        except AuthError:
            log.info("couldn't renew a sign-in yet; keeping the current token", exc_info=True)
            return get_api_key(account.secret_ref)
        else:
            rejected = False
            apply_pair(account, pair)
            await session.commit()
            return pair.token
    if rejected:
        await signed_out(account_id)
    return None


async def renew_due() -> int:
    """Renews every account that's close to running out. Returns how many were renewed."""
    from sqlalchemy import select

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(AuthAccount).where(AuthAccount.status == "connected", AuthAccount.refresh_ref.is_not(None))
            )
        ).scalars().all()
    renewed = 0
    for account in rows:
        if due(account):
            with contextlib.suppress(Exception):
                if await fresh_token(account.id):
                    renewed += 1
    return renewed


async def keep_fresh() -> None:
    """Runs for as long as the app does: at start-up (a token that ran out overnight), then
    every few minutes."""
    while True:
        with contextlib.suppress(Exception):
            await renew_due()
        await asyncio.sleep(CHECK_EVERY)
