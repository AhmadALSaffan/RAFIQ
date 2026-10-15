"""A GitHub sign-in lasts: the 8-hour token renews itself, so the user connects once."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.auth import refresh
from rafiq_agent.auth.base import AuthError, RefreshRejected, TokenPair
from rafiq_agent.auth.github_copilot import GitHubCopilotAdapter
from rafiq_agent.auth.registry import adapter_for
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import AuthAccount
from rafiq_agent.storage.secrets import get_api_key, store_api_key

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture(autouse=True)
def memory_keyring(monkeypatch):
    """Keep the suite out of the real Windows Credential Manager."""
    vault: dict[tuple[str, str], str] = {}
    monkeypatch.setattr("keyring.set_password", lambda s, k, v: vault.__setitem__((s, k), v))
    monkeypatch.setattr("keyring.get_password", lambda s, k: vault.get((s, k)))
    monkeypatch.setattr("keyring.delete_password", lambda s, k: vault.pop((s, k), None))
    return vault


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _account(expires_in: timedelta | None, refresh_token: str | None = "ghr_first_refresh") -> str:
    await init_db()
    async with SessionLocal() as session:
        account = AuthAccount(
            provider="github_copilot",
            external_id="octo",
            label="octo",
            secret_ref=store_api_key("gho_first_access"),
            refresh_ref=store_api_key(refresh_token) if refresh_token else None,
            expires_at=datetime.now(UTC) + expires_in if expires_in is not None else None,
        )
        session.add(account)
        await session.commit()
        return account.id


async def _load(account_id: str) -> AuthAccount:
    async with SessionLocal() as session:
        return await session.get(AuthAccount, account_id)


def _github(token_answers: list[dict]) -> httpx.MockTransport:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/login/oauth/access_token":
            seen.append(dict(httpx.QueryParams(request.content.decode())))
            return httpx.Response(200, json=token_answers.pop(0))
        if request.url.path == "/user":
            return httpx.Response(200, json={"id": 7, "login": "octo"})
        return httpx.Response(200, json={"device_code": "dc", "user_code": "U", "interval": 0, "expires_in": 900})

    transport = httpx.MockTransport(handler)
    transport.seen = seen  # type: ignore[attr-defined]
    return transport


async def test_the_sign_in_keeps_githubs_refresh_token(monkeypatch):
    transport = _github(
        [
            {
                "access_token": "gho_access",
                "refresh_token": "ghr_refresh",
                "expires_in": 28800,
                "refresh_token_expires_in": 15897600,
            }
        ]
    )
    adapter = GitHubCopilotAdapter("cid", transport=transport)

    async def fine(token: str) -> None:
        return None

    monkeypatch.setattr(adapter, "check", fine)
    start = await adapter.start()
    done = await adapter.poll(start.flow_id)
    assert done.status == "complete"
    assert done.identity.refresh_token == "ghr_refresh"
    assert done.identity.expires_in == 28800 and done.identity.refresh_expires_in == 15897600
    assert "ghr_refresh" not in repr(done.identity)  # never in a log line


async def test_renewing_asks_with_the_client_id_alone():
    transport = _github([{"access_token": "gho_new", "refresh_token": "ghr_new", "expires_in": 28800}])
    pair = await GitHubCopilotAdapter("cid", transport=transport).refresh("ghr_old")
    assert pair.token == "gho_new" and pair.refresh_token == "ghr_new" and pair.expires_in == 28800
    sent = transport.seen[0]  # type: ignore[attr-defined]
    assert sent == {"client_id": "cid", "grant_type": "refresh_token", "refresh_token": "ghr_old"}


async def test_a_refused_refresh_token_needs_a_new_sign_in():
    transport = _github([{"error": "bad_refresh_token", "error_description": "The refresh token passed is incorrect or expired."}])
    with pytest.raises(RefreshRejected):
        await GitHubCopilotAdapter("cid", transport=transport).refresh("ghr_old")


async def test_a_token_about_to_run_out_is_renewed_and_both_new_tokens_are_kept(monkeypatch):
    account_id = await _account(timedelta(minutes=10))
    asked: list[str] = []

    async def renew(refresh_token: str) -> TokenPair:
        asked.append(refresh_token)
        return TokenPair(token="gho_second_access", refresh_token="ghr_second_refresh", expires_in=28800)

    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", renew)
    assert await refresh.fresh_token(account_id) == "gho_second_access"
    assert asked == ["ghr_first_refresh"]

    account = await _load(account_id)
    assert get_api_key(account.secret_ref) == "gho_second_access"
    assert get_api_key(account.refresh_ref) == "ghr_second_refresh"
    left = refresh._aware(account.expires_at) - datetime.now(UTC)
    assert timedelta(hours=7) < left <= timedelta(hours=8)
    # Fresh now: the next call doesn't spend the new refresh token.
    assert await refresh.fresh_token(account_id) == "gho_second_access"
    assert len(asked) == 1


async def test_a_token_with_hours_left_is_used_as_it_is(monkeypatch):
    account_id = await _account(timedelta(hours=5))

    async def never(_: str) -> TokenPair:
        raise AssertionError("renewed too early")

    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", never)
    assert await refresh.fresh_token(account_id) == "gho_first_access"


async def test_offline_keeps_the_current_token_and_the_account_connected(monkeypatch):
    account_id = await _account(timedelta(minutes=-5))

    async def offline(_: str) -> TokenPair:
        raise AuthError("no internet")

    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", offline)
    assert await refresh.fresh_token(account_id) == "gho_first_access"
    assert (await _load(account_id)).status == "connected"


async def test_a_refused_refresh_marks_the_account_disconnected(monkeypatch, client):
    account_id = await _account(timedelta(minutes=-5))

    async def refused(_: str) -> TokenPair:
        raise RefreshRejected("gone")

    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", refused)
    assert await refresh.fresh_token(account_id) is None
    account = await _load(account_id)
    assert account.status == "disconnected" and account.secret_ref is None and account.refresh_ref is None
    listed = {a["id"]: a for a in (await client.get("/accounts", headers=AUTH)).json()}
    assert listed[account_id]["status"] == "disconnected"  # Settings offers «Reconnect»


async def test_one_renewal_at_a_time(monkeypatch):
    import asyncio

    account_id = await _account(timedelta(minutes=1))
    calls = 0

    async def slow(refresh_token: str) -> TokenPair:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return TokenPair(token=f"gho_after_{calls}", refresh_token=f"ghr_after_{calls}", expires_in=28800)

    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", slow)
    tokens = await asyncio.gather(*(refresh.fresh_token(account_id) for _ in range(5)))
    # A refresh token works once: five callers, one renewal, everyone gets its result.
    assert calls == 1 and set(tokens) == {"gho_after_1"}


async def test_the_background_pass_renews_only_whats_due(monkeypatch):
    soon = await _account(timedelta(minutes=5))
    later = await _account(timedelta(hours=6))
    legacy = await _account(None, refresh_token=None)  # signed in before refresh tokens
    renewed: list[str] = []

    async def renew(refresh_token: str) -> TokenPair:
        renewed.append(refresh_token)
        return TokenPair(token="gho_renewed", refresh_token="ghr_renewed", expires_in=28800)

    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", renew)
    assert await refresh.renew_due() >= 1
    assert get_api_key((await _load(soon)).secret_ref) == "gho_renewed"
    assert get_api_key((await _load(later)).secret_ref) == "gho_first_access"
    assert get_api_key((await _load(legacy)).secret_ref) == "gho_first_access"


async def test_disconnecting_forgets_the_refresh_token_too(client, memory_keyring):
    account_id = await _account(timedelta(hours=8))
    assert (await client.delete(f"/accounts/{account_id}", headers=AUTH)).status_code == 204
    assert "ghr_first_refresh" not in memory_keyring.values()
    assert "gho_first_access" not in memory_keyring.values()


async def test_a_token_that_ran_out_overnight_is_renewed_mid_turn(monkeypatch):
    """The morning case: the app was closed, the 8-hour token ran out. Copilot refuses it,
    Rafiq renews it, and the same message goes through — no «reconnect»."""
    pytest.importorskip("copilot")
    import asyncio

    from copilot.session_events import AssistantMessageDeltaData, SessionIdleData

    from rafiq_agent.llm import copilot as bridge

    account_id = await _account(None)  # expiry unknown: only Copilot's refusal tells

    class Event:
        def __init__(self, data):
            self.data = data

    class Session:
        def __init__(self, options):
            self.options = options

        async def send(self, prompt, attachments=None):
            async def run():
                self.options["on_event"](Event(AssistantMessageDeltaData.from_dict({"deltaContent": "صباح الخير", "messageId": "m"})))
                self.options["on_event"](Event(SessionIdleData.from_dict({})))

            asyncio.get_running_loop().create_task(run())

        async def disconnect(self):
            pass

    class Client:
        def __init__(self, token):
            self.token = token

        async def create_session(self, **options):
            if options["github_token"] != "gho_renewed":
                raise RuntimeError('Request session.create failed: {"status":401} Unauthorized')
            return Session(options)

    async def client_for(_, token):
        return Client(token)

    async def nothing(_):
        return None

    async def revoked(token):
        return token == "gho_first_access"

    async def renew(_: str) -> TokenPair:
        return TokenPair(token="gho_renewed", refresh_token="ghr_renewed", expires_in=28800)

    monkeypatch.setattr(bridge, "client_for", client_for)
    monkeypatch.setattr(bridge, "drop_client", nothing)
    monkeypatch.setattr(bridge, "token_revoked", revoked)
    monkeypatch.setattr(adapter_for("github_copilot"), "refresh", renew)

    provider = bridge.CopilotProvider(account_id=account_id, token="gho_first_access", model_id="gpt-5")
    text = ""
    async for event in provider.stream_chat([{"role": "user", "content": "مرحبا"}], []):
        text += event.text_delta or ""
    assert text == "صباح الخير"
    account = await _load(account_id)
    assert account.status == "connected" and get_api_key(account.secret_ref) == "gho_renewed"
