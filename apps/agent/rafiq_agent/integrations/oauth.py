"""Signing in to a tracker without pasting a token: the OAuth 2.0 device authorization grant
(RFC 8628). The app shows a short code, the user enters it on the provider's own page, and
the token comes back to Rafiq — no client secret, no redirect page, nothing for a desktop
app to hide.

GitHub and GitLab support it. Each needs an OAuth app registered by the user (or their
organisation) with the device flow enabled; its client id is public and is all Rafiq needs.
Atlassian's OAuth requires a client secret, which a desktop app can't keep, so Jira stays on
API tokens.

Tokens are kept in the OS keychain like any other credential. GitLab's expire after two
hours and come with a refresh token; `refresh_if_needed` renews them before use."""

import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

import httpx

from rafiq_agent.i18n import tr
from rafiq_agent.integrations.base import IntegrationError

FLOWS: dict[str, "Flow"] = {}


@dataclass
class Flow:
    provider: str
    client_id: str
    host: str
    device_code: str
    interval: int
    expires_at: float
    name: str | None = None


def endpoints(provider: str, host: str) -> dict[str, str]:
    host = host.rstrip("/")
    if provider == "github":
        web = "https://github.com" if host in ("", "https://api.github.com") else host.replace("/api/v3", "")
        return {"code": f"{web}/login/device/code", "token": f"{web}/login/oauth/access_token", "scope": "repo read:user notifications"}
    if provider == "gitlab":
        base = host or "https://gitlab.com"
        return {"code": f"{base}/oauth/authorize_device", "token": f"{base}/oauth/token", "scope": "api read_user"}
    raise IntegrationError(tr("هالمنصّة ما بتدعم تسجيل الدخول بكود."))


async def start(provider: str, client_id: str, host: str = "", name: str | None = None,
                transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    if not client_id.strip():
        raise IntegrationError(tr("حط الـ Client ID تبع تطبيق OAuth."))
    urls = endpoints(provider, host)
    async with httpx.AsyncClient(timeout=20, transport=transport, headers={"Accept": "application/json"}) as c:
        resp = await c.post(urls["code"], data={"client_id": client_id.strip(), "scope": urls["scope"]})
    if resp.status_code >= 400:
        raise IntegrationError(tr("المنصّة رفضت طلب تسجيل الدخول: {0}", resp.text[:200]))
    data = resp.json()
    flow_id = secrets.token_urlsafe(12)
    FLOWS[flow_id] = Flow(
        provider=provider,
        client_id=client_id.strip(),
        host=host,
        device_code=data["device_code"],
        interval=int(data.get("interval") or 5),
        expires_at=time.time() + int(data.get("expires_in") or 900),
        name=name,
    )
    return {
        "flow_id": flow_id,
        "user_code": data.get("user_code"),
        "verification_uri": data.get("verification_uri") or data.get("verification_url"),
        "verification_uri_complete": data.get("verification_uri_complete"),
        "interval": int(data.get("interval") or 5),
        "expires_in": int(data.get("expires_in") or 900),
    }


async def poll(flow_id: str, transport: httpx.AsyncBaseTransport | None = None) -> tuple[str, str | None]:
    """("pending" | "slow_down" | "done" | "expired" | "denied", the secret to store when done)."""
    flow = FLOWS.get(flow_id)
    if not flow:
        return "expired", None
    if time.time() > flow.expires_at:
        FLOWS.pop(flow_id, None)
        return "expired", None
    urls = endpoints(flow.provider, flow.host)
    async with httpx.AsyncClient(timeout=20, transport=transport, headers={"Accept": "application/json"}) as c:
        resp = await c.post(
            urls["token"],
            data={"client_id": flow.client_id, "device_code": flow.device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code"},
        )
    data = resp.json() if resp.content else {}
    error = data.get("error")
    if error in ("authorization_pending",):
        return "pending", None
    if error == "slow_down":
        flow.interval += 5
        return "slow_down", None
    if error in ("access_denied",):
        FLOWS.pop(flow_id, None)
        return "denied", None
    if error in ("expired_token",) or (error and "expired" in str(error)):
        FLOWS.pop(flow_id, None)
        return "expired", None
    if not data.get("access_token"):
        raise IntegrationError(tr("المنصّة ما رجّعت token: {0}", str(error or resp.status_code)))
    FLOWS.pop(flow_id, None)
    return "done", pack(data, flow.client_id)


def pack(data: dict[str, Any], client_id: str) -> str:
    """What the keychain keeps for an OAuth sign-in."""
    expires = data.get("expires_in")
    return json.dumps(
        {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_at": time.time() + int(expires) if expires else None,
            "client_id": client_id,
        }
    )


def unpack(secret: str | None) -> dict[str, Any] | None:
    if not secret or not secret.startswith("{"):
        return None
    try:
        data = json.loads(secret)
    except ValueError:
        return None
    return data if isinstance(data, dict) and data.get("access_token") else None


def access_token(secret: str | None) -> str:
    data = unpack(secret)
    return data["access_token"] if data else (secret or "")


async def refresh(provider: str, host: str, secret: str, transport: httpx.AsyncBaseTransport | None = None) -> str | None:
    """A new secret when the token is about to run out and can be renewed; None otherwise."""
    data = unpack(secret)
    if not data or not data.get("refresh_token") or not data.get("expires_at"):
        return None
    if data["expires_at"] - time.time() > 120:
        return None
    urls = endpoints(provider, host)
    async with httpx.AsyncClient(timeout=20, transport=transport, headers={"Accept": "application/json"}) as c:
        resp = await c.post(
            urls["token"],
            data={"grant_type": "refresh_token", "refresh_token": data["refresh_token"], "client_id": data.get("client_id", "")},
        )
    if resp.status_code >= 400:
        raise IntegrationError(tr("انتهى تسجيل الدخول — سجّل دخول من جديد من صفحة الربط."))
    return pack(resp.json(), data.get("client_id", ""))
