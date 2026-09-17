"""OAuth for remote MCP servers (Notion, Linear, Atlassian, Sentry, Stripe, Figma…).

The MCP SDK does the protocol work (discovery, dynamic client registration, PKCE, token
refresh). This module gives it the three things it can't know: where to keep tokens (the
Windows credential store, under `mcp-oauth:<server id>`), how to show the user the
authorization page (the app opens the URL the SDK hands us), and how the authorization
code comes back (the browser is redirected to the agent's own `/mcp/oauth/callback`).

Nothing here logs or returns a token. The UI only ever learns *whether* a server is
authorized.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from dataclasses import dataclass, field
from typing import Any

from rafiq_agent.storage.secrets import delete_named_secret, get_named_secret, set_named_secret

AUTHORIZE_TIMEOUT = 300  # the user has five minutes to finish in the browser


def secret_name(server_id: str) -> str:
    return f"mcp-oauth:{server_id}"


def agent_port() -> int:
    return int(os.environ.get("RAFIQ_PORT", "8765"))


def redirect_uri() -> str:
    return f"http://127.0.0.1:{agent_port()}/mcp/oauth/callback"


def is_authorized(server_id: str) -> bool:
    """Has this server been through the browser step (tokens on file)?"""
    try:
        data = json.loads(get_named_secret(secret_name(server_id)) or "{}")
    except (ValueError, TypeError):
        return False
    return bool(data.get("tokens"))


def forget(server_id: str) -> None:
    with contextlib.suppress(Exception):
        delete_named_secret(secret_name(server_id))


class KeyringTokenStorage:
    """The SDK's TokenStorage, backed by one keychain entry per server. The registered
    client carries the redirect URI (and so the agent's port); if the port changed since,
    the client is dropped and registered again."""

    def __init__(self, server_id: str) -> None:
        self.server_id = server_id

    def _load(self) -> dict[str, Any]:
        try:
            return json.loads(get_named_secret(secret_name(self.server_id)) or "{}")
        except (ValueError, TypeError):
            return {}

    def _save(self, data: dict[str, Any]) -> None:
        set_named_secret(secret_name(self.server_id), json.dumps(data))

    async def get_tokens(self):  # noqa: ANN201 - the SDK's protocol types
        from mcp.shared.auth import OAuthToken

        raw = self._load().get("tokens")
        return OAuthToken.model_validate(raw) if raw else None

    async def set_tokens(self, tokens) -> None:  # noqa: ANN001
        data = self._load()
        data["tokens"] = tokens.model_dump(mode="json", exclude_none=True)
        self._save(data)

    async def get_client_info(self):  # noqa: ANN201
        from mcp.shared.auth import OAuthClientInformationFull

        data = self._load()
        raw = data.get("client")
        if not raw or data.get("port") != agent_port():
            return None
        return OAuthClientInformationFull.model_validate(raw)

    async def set_client_info(self, client_info) -> None:  # noqa: ANN001
        data = self._load()
        data["client"] = client_info.model_dump(mode="json", exclude_none=True)
        data["port"] = agent_port()
        self._save(data)


@dataclass
class Pending:
    """One authorization in flight: the URL the user must open, and the code coming back."""

    server_id: str
    url: asyncio.Future[str] = field(default_factory=lambda: asyncio.get_running_loop().create_future())
    code: asyncio.Future[tuple[str, str]] = field(default_factory=lambda: asyncio.get_running_loop().create_future())


_pending: dict[str, Pending] = {}


def pending_for(server_id: str) -> Pending | None:
    return _pending.get(server_id)


def begin(server_id: str) -> Pending:
    flow = Pending(server_id)
    _pending[server_id] = flow
    return flow


def end(server_id: str) -> None:
    _pending.pop(server_id, None)


def deliver(code: str, state: str | None) -> bool:
    """The browser came back with a code. Any flow still waiting gets it — the SDK checks
    the state itself, so a stale tab can't complete someone else's flow."""
    for flow in list(_pending.values()):
        if not flow.code.done():
            flow.code.set_result((code, state or ""))
            return True
    return False


def provider(server_id: str, server_url: str):  # noqa: ANN201 - httpx.Auth from the SDK
    from mcp.client.auth import OAuthClientProvider
    from mcp.shared.auth import OAuthClientMetadata

    flow = pending_for(server_id) or begin(server_id)

    async def redirect_handler(url: str) -> None:
        if not flow.url.done():
            flow.url.set_result(url)

    async def callback_handler():  # noqa: ANN202
        from mcp.shared.auth import AuthorizationCodeResult

        code, state = await asyncio.wait_for(flow.code, AUTHORIZE_TIMEOUT)
        return AuthorizationCodeResult(code=code, state=state or None)

    return OAuthClientProvider(
        server_url=server_url,
        client_metadata=OAuthClientMetadata(
            client_name="Rafiq",
            client_uri="https://github.com/AhmadALSaffan/RAFIQ",  # type: ignore[arg-type]
            redirect_uris=[redirect_uri()],  # type: ignore[list-item]
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method="none",
        ),
        storage=KeyringTokenStorage(server_id),
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
    )


def describe_status(status: int) -> str | None:
    """What an HTTP status from an MCP endpoint means to the person reading it."""
    from rafiq_agent.i18n import tr

    if status in (401, 403):
        return tr("الخادم رفض الدخول ({0}) — التوكن غلط أو منتهي، أو لازم تربط الحساب من جديد.", status)
    if status == 404:
        return tr("ما في خادم MCP على هالرابط (404).")
    if status >= 500:
        return tr("الخادم عنده مشكلة ({0}). جرّب بعد شوي.", status)
    return None


# The SDK folds a non-2xx reply into one of these; the status itself is lost, so the
# bridge probes the endpoint once more to name it.
GENERIC_HTTP_ERRORS = ("Server returned an error response", "Not Found", "Session terminated")


def describe_error(exc: BaseException) -> str:
    """The reason a connection failed, in one line a person can act on. The SDK raises
    exception groups ("unhandled errors in a TaskGroup"), so dig for the real one."""
    from rafiq_agent.i18n import tr

    leaf: BaseException = exc
    seen = 0
    while isinstance(leaf, BaseExceptionGroup) and leaf.exceptions and seen < 10:
        leaf = leaf.exceptions[0]
        seen += 1
    name = type(leaf).__name__
    status = getattr(getattr(leaf, "response", None), "status_code", None)
    if status is not None and (explained := describe_status(status)):
        return explained
    if "Connect" in name or "Timeout" in name or "ConnectionRefused" in name:
        return tr("ما قدرت أوصل للخادم — تأكد من الإنترنت أو من الرابط/الأمر.")
    if name in ("FileNotFoundError",):
        return tr("الأمر مش موجود على جهازك — نزّل الأداة اللي بيحتاجها الخادم (Node.js/uv/Docker).")
    if "OAuth" in name or "Registration" in name:
        return tr("ما قدرت أكمّل ربط الحساب: {0}", str(leaf)[:200])
    text = str(leaf).strip() or name
    return text[:300]
