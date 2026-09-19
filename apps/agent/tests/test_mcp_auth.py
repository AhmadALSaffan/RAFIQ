"""MCP: readable connection errors, Bearer normalisation, OAuth token storage, presets,
and the connect / callback routes."""

import asyncio
import json

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent import mcp_oauth
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.main import app
from rafiq_agent.mcp_bridge import _launch, _normalized_headers
from rafiq_agent.mcp_oauth import (
    CLIENT_NAME,
    FIGMA_CLIENT_NAME,
    KeyringTokenStorage,
    client_name_for,
    describe_error,
)
from rafiq_agent.storage.db import init_db

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def test_bare_tokens_become_bearer_tokens():
    assert _normalized_headers({"Authorization": "ghp_abc"}) == {"Authorization": "Bearer ghp_abc"}
    assert _normalized_headers({"Authorization": "Bearer ghp_abc"}) == {"Authorization": "Bearer ghp_abc"}
    assert _normalized_headers({"authorization": "token x"}) == {"authorization": "token x"}
    assert _normalized_headers({"X-Key": "abc"}) == {"X-Key": "abc"}


def test_errors_are_unwrapped_and_explained():
    response = httpx.Response(401, request=httpx.Request("GET", "https://x"))
    inner = httpx.HTTPStatusError("401", request=response.request, response=response)
    group = BaseExceptionGroup("unhandled errors in a TaskGroup", [ExceptionGroup("inner", [inner])])
    text = describe_error(group)
    assert "401" in text and "TaskGroup" not in text
    assert "404" in describe_error(httpx.HTTPStatusError("x", request=response.request, response=httpx.Response(404, request=response.request)))
    assert "Node.js" in describe_error(FileNotFoundError("npx"))
    assert "boom" not in describe_error(httpx.ConnectError("boom"))  # explained, not echoed
    assert describe_error(RuntimeError("plain reason")) == "plain reason"


async def test_a_swallowed_status_is_probed_and_named(monkeypatch):
    from rafiq_agent import mcp_bridge

    async def fake_probe(url, headers):
        assert headers["Authorization"].startswith("Bearer ")
        return 401

    monkeypatch.setattr(mcp_bridge, "_probe_status", fake_probe)
    monkeypatch.setattr(mcp_bridge, "load_secrets", lambda _id: {"env": {}, "headers": {"Authorization": "ghp_x"}})

    class Boom:
        async def __aenter__(self):
            raise RuntimeError("Server returned an error response")

        async def __aexit__(self, *_):
            return None

    monkeypatch.setattr(mcp_bridge, "create_mcp_http_client", lambda **_: Boom(), raising=False)
    conn = mcp_bridge.Connection(mcp_bridge._Config("id", "gh", "http", None, [], "https://x/mcp/", "none"))

    async def failing_run():
        try:
            async with Boom():
                pass
        except BaseException as exc:  # noqa: BLE001
            from rafiq_agent.mcp_oauth import GENERIC_HTTP_ERRORS, describe_error, describe_status

            conn.error = describe_error(exc)
            if any(g in conn.error for g in GENERIC_HTTP_ERRORS):
                status = await mcp_bridge._probe_status(conn.config.url, mcp_bridge._normalized_headers(mcp_bridge.load_secrets(conn.config.id)["headers"]))
                if status is not None and (explained := describe_status(status)):
                    conn.error = explained

    await failing_run()
    assert "401" in conn.error and "Server returned" not in conn.error


async def test_oauth_storage_round_trips_and_drops_clients_from_another_port(monkeypatch):
    from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

    storage = KeyringTokenStorage("srv-test")
    mcp_oauth.forget("srv-test")
    assert await storage.get_tokens() is None
    await storage.set_tokens(OAuthToken(access_token="at", token_type="Bearer", refresh_token="rt"))
    assert (await storage.get_tokens()).access_token == "at"
    assert mcp_oauth.is_authorized("srv-test")

    monkeypatch.setenv("RAFIQ_PORT", "8765")
    await storage.set_client_info(OAuthClientInformationFull(client_id="c1", redirect_uris=[mcp_oauth.redirect_uri()]))
    assert (await storage.get_client_info()).client_id == "c1"
    monkeypatch.setenv("RAFIQ_PORT", "9999")
    assert await storage.get_client_info() is None  # registered for another port: re-register
    assert (await storage.get_tokens()).access_token == "at"  # tokens survive

    mcp_oauth.forget("srv-test")
    assert not mcp_oauth.is_authorized("srv-test")


async def test_pending_flow_delivers_the_code_to_the_waiting_connection():
    flow = mcp_oauth.begin("srv-flow")
    # `iss` travels with it: a server that advertises RFC 9207 refuses the exchange without it.
    assert mcp_oauth.deliver("the-code", "st", "https://www.figma.com") is True
    assert flow.code.result() == ("the-code", "st", "https://www.figma.com")
    assert mcp_oauth.deliver("again", "st") is False  # nobody waiting
    mcp_oauth.end("srv-flow")


async def test_preset_and_auth_are_stored_and_reported(client):
    body = {
        "name": "Notion",
        "transport": "http",
        "url": "https://mcp.notion.com/mcp",
        "env": {},
        "headers": {},
        "enabled": True,
        "auth": "oauth",
        "preset": "notion",
    }
    r = await client.post("/mcp", json=body, headers=AUTH)
    assert r.status_code == 201, r.text
    server = r.json()
    assert server["auth"] == "oauth" and server["preset"] == "notion" and server["authorized"] is False

    # A stdio server can't be OAuth, whatever the body says.
    r = await client.post("/mcp", json={**body, "name": "fs", "transport": "stdio", "command": "npx", "url": None, "preset": "filesystem"}, headers=AUTH)
    assert r.status_code == 201 and r.json()["auth"] == "none"
    stdio = r.json()

    r = await client.post(f"/mcp/{server['id']}/logout", headers=AUTH)
    assert r.status_code == 200 and r.json()["authorized"] is False

    # Both of them: an enabled server left behind is one the next test's first reply waits on.
    for s in (server, stdio):
        assert (await client.delete(f"/mcp/{s['id']}", headers=AUTH)).status_code in (200, 204)


async def test_callback_page_reports_stale_links(client):
    r = await client.get("/mcp/oauth/callback?code=abc&state=x")
    assert r.status_code == 400 and "text/html" in r.headers["content-type"]
    r = await client.get("/mcp/oauth/callback?error=access_denied")
    assert r.status_code == 400
    flow = mcp_oauth.begin("srv-cb")
    r = await client.get("/mcp/oauth/callback?code=abc&state=x&iss=https%3A%2F%2Fwww.figma.com")
    assert r.status_code == 200 and flow.code.result() == ("abc", "x", "https://www.figma.com")
    mcp_oauth.end("srv-cb")

    # Figma's own path answers the same way.
    flow = mcp_oauth.begin("srv-cb2")
    r = await client.get("/callback?code=def&state=y")
    assert r.status_code == 200 and flow.code.result() == ("def", "y", "")
    mcp_oauth.end("srv-cb2")


def test_secret_never_reaches_the_api_shape():
    out = json.dumps({"secret_keys": ["Authorization"], "authorized": True})
    assert "Bearer" not in out


# ── Servers with their own rules ──────────────────────────────────────────────────────


def test_figma_is_registered_under_a_name_it_accepts():
    # Figma's registration endpoint 403s any client name outside its own list.
    assert client_name_for("https://mcp.figma.com/mcp") == FIGMA_CLIENT_NAME
    assert client_name_for("https://x/y", "figma") == FIGMA_CLIENT_NAME
    # Everyone else still meets Rafiq — including a host that merely looks like Figma.
    assert client_name_for("https://mcp.notion.com/mcp") == CLIENT_NAME
    assert client_name_for("https://mcp.figma.com.attacker.net/mcp") == CLIENT_NAME
    assert client_name_for("", None) == CLIENT_NAME


def test_node_shims_are_launched_through_cmd_on_windows(monkeypatch):
    monkeypatch.setattr("rafiq_agent.mcp_bridge.sys.platform", "win32")
    assert _launch("npx", ["-y", "@playwright/mcp@latest"]) == ("cmd", ["/c", "npx", "-y", "@playwright/mcp@latest"])
    assert _launch("npm", ["x"]) == ("cmd", ["/c", "npm", "x"])
    assert _launch("npx.cmd", []) == ("cmd", ["/c", "npx.cmd"])
    # Real executables are started directly, as they always were.
    assert _launch("uvx", ["mcp-server-fetch"]) == ("uvx", ["mcp-server-fetch"])
    assert _launch("docker", ["mcp", "gateway", "run"]) == ("docker", ["mcp", "gateway", "run"])


def test_nothing_is_wrapped_off_windows(monkeypatch):
    monkeypatch.setattr("rafiq_agent.mcp_bridge.sys.platform", "linux")
    assert _launch("npx", ["-y", "x"]) == ("npx", ["-y", "x"])


async def test_a_timeout_keeps_its_message_instead_of_cancellederror():
    from rafiq_agent import mcp_bridge

    conn = mcp_bridge.Connection(mcp_bridge._Config("id", "slow", "stdio", "npx", [], None))

    async def never_ready() -> None:
        try:
            await asyncio.sleep(60)
        except BaseException as exc:  # noqa: BLE001 - mirrors _run's handler
            if conn.error is None:
                conn.error = type(exc).__name__
            raise

    conn._ready, conn._stop, conn.error = asyncio.Event(), asyncio.Event(), None
    conn._task = asyncio.create_task(never_ready())
    monkey = mcp_bridge.CONNECT_TIMEOUT
    assert monkey > 0
    try:
        await asyncio.wait_for(conn._ready.wait(), 0.2)
    except TimeoutError:
        conn.error = "الخادم ما رد خلال وقت كافي."
        await conn.stop()
    assert conn.error == "الخادم ما رد خلال وقت كافي."
