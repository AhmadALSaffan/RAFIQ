"""Sign in with ChatGPT: a ChatGPT Plus/Pro plan pays for Rafiq's requests.

OpenAI's documented flow for open-source apps ("Sign in with ChatGPT" → ChatGPT plan
usage, https://developers.openai.com/siwc/token-sharing-open-source/sign-in), the same one
its own devkit implements (github.com/openai/sign-in-with-chatgpt-devkit):

1. Rafiq starts a listener on 127.0.0.1 (path /auth/callback) and opens the browser at
   OpenAI's authorization endpoint — OAuth 2.0 + OpenID Connect, PKCE (S256), fresh
   state and nonce. The first sign-in registers this installation: `client_id` is
   `dynamic_agent_client` with the app's name and a stable host id, and OpenAI issues a
   client id of its own on the callback, which every later sign-in and refresh reuses.
2. The user signs in on chatgpt.com and allows Rafiq to use their plan; the browser comes
   back to the listener with a one-time code, exchanged here (no client secret) for an
   access token (1 hour), a rotating refresh token (30 days) and an ID token, verified
   against OpenAI's published keys (issuer, audience, nonce, expiry).
3. Requests then go to the public Responses API with the access token (llm/chatgpt.py).

Rafiq never sees a password. Tokens go to the Windows keychain like every other sign-in;
the issued client id and the host id (neither is a secret) sit in the data folder.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from rafiq_agent.auth.base import (
    AuthError,
    ConnectedIdentity,
    DeviceStart,
    PollOutcome,
    RefreshRejected,
    TokenPair,
)
from rafiq_agent.config import DATA_DIR
from rafiq_agent.i18n import tr

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
CALLBACK_PATH = "/auth/callback"
DYNAMIC_CLIENT = "dynamic_agent_client"
APP_NAME = "Rafiq"
# The port OpenAI's examples register with; another one is fine on later sign-ins (only
# the port may change), so a busy 1455 falls back to any free port.
PREFERRED_PORT = 1455
SIGN_IN_TIMEOUT = 10 * 60
REFRESH_LIFETIME = 30 * 24 * 3600
MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage"

_STATE_FILE = "chatgpt-client.json"
# Refresh errors that mean the refresh token itself is finished: sign in again.
_DEAD_REFRESH = {
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# ── This installation's registration ──────────────────────────────────────────────────


def _state_path() -> Path:
    return DATA_DIR / _STATE_FILE


def _load_state() -> dict[str, str]:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
        return {k: v for k, v in data.items() if isinstance(v, str)}
    except (OSError, ValueError):
        return {}


def _save_state(state: dict[str, str]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{secrets.token_hex(3)}.tmp")
    temp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    with contextlib.suppress(OSError):
        os.chmod(temp, 0o600)
    temp.replace(path)


def host_id() -> str:
    """Stable for this installation, distinct from every other (`ext_agent_host_id`)."""
    state = _load_state()
    if not state.get("host_id"):
        state["host_id"] = f"urn:uuid:{uuid.uuid4()}"
        _save_state(state)
    return state["host_id"]


def issued_client_id() -> str | None:
    return _load_state().get("client_id") or None


def _remember_client_id(client_id: str) -> None:
    state = _load_state()
    state["client_id"] = client_id
    _save_state(state)


# ── Talking to auth.openai.com ────────────────────────────────────────────────────────


@dataclass
class _Discovery:
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    revocation_endpoint: str | None


class _Flow:
    def __init__(self, state: str, nonce: str, verifier: str, previous_client: str | None) -> None:
        self.state = state
        self.nonce = nonce
        self.verifier = verifier
        self.previous_client = previous_client
        self.redirect_uri = ""
        self.started = time.monotonic()
        self.outcome: PollOutcome | None = None
        self.claimed = False
        self.server: asyncio.AbstractServer | None = None
        self.done = asyncio.Event()


@dataclass
class _Callback:
    code: str = field(repr=False)
    client_id: str


class ChatGPTAdapter:
    provider = "chatgpt"
    name = "ChatGPT"
    method = "oauth"
    experimental = False
    # Access tokens last an hour: renew in the last quarter of it, not earlier.
    renew_before = 15 * 60

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport
        self._flows: dict[str, _Flow] = {}
        self._discovery: _Discovery | None = None
        self._jwks: dict[str, Any] | None = None

    def unavailable_reason(self) -> str | None:
        return None

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=20, transport=self._transport)

    async def discovery(self) -> _Discovery:
        """OpenAI's published configuration, checked to be OpenAI's own endpoints."""
        if self._discovery is not None:
            return self._discovery
        try:
            async with self._http() as http:
                resp = await http.get(f"{ISSUER}/.well-known/openid-configuration")
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AuthError(tr("ما قدرت أوصل لـ ChatGPT — تأكد من الإنترنت.")) from exc
        if resp.status_code != 200 or not isinstance(data, dict) or data.get("issuer") != ISSUER:
            raise AuthError(tr("ما قدرت أتأكد من إعدادات تسجيل الدخول بـ ChatGPT."))
        endpoints = {}
        for key in ("authorization_endpoint", "token_endpoint", "jwks_uri", "revocation_endpoint"):
            value = data.get(key)
            if value is None and key == "revocation_endpoint":
                endpoints[key] = None
                continue
            if not isinstance(value, str) or not value.startswith(ISSUER + "/"):
                raise AuthError(tr("ما قدرت أتأكد من إعدادات تسجيل الدخول بـ ChatGPT."))
            endpoints[key] = value
        self._discovery = _Discovery(**endpoints)
        return self._discovery

    async def _keys(self, refresh: bool = False) -> dict[str, Any]:
        if self._jwks is not None and not refresh:
            return self._jwks
        config = await self.discovery()
        try:
            async with self._http() as http:
                resp = await http.get(config.jwks_uri)
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT هلق — جرّب كمان شوي.")) from exc
        if resp.status_code != 200 or not isinstance(data, dict) or not isinstance(data.get("keys"), list):
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT هلق — جرّب كمان شوي."))
        self._jwks = data
        return data

    async def verify_id_token(
        self, id_token: str, client_id: str, nonce: str | None = None
    ) -> dict[str, Any]:
        """The ID token's claims, once its signature, issuer, audience, expiry and nonce
        check out — what tells us who signed in."""
        import jwt

        try:
            kid = jwt.get_unverified_header(id_token).get("kid")
        except jwt.PyJWTError as exc:
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT — سجّل دخول من جديد.")) from exc
        key = None
        for attempt in range(2):
            keys = await self._keys(refresh=attempt == 1)
            match = next((k for k in keys["keys"] if k.get("kid") == kid), None)
            if match is not None:
                key = jwt.PyJWK(match).key
                break
        if key is None:
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT — سجّل دخول من جديد."))
        try:
            claims = jwt.decode(
                id_token,
                key=key,
                algorithms=["RS256"],
                audience=client_id,
                issuer=ISSUER,
                leeway=5,
                options={"require": ["iss", "aud", "exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT — سجّل دخول من جديد.")) from exc
        if not claims.get("sub") or (nonce is not None and claims.get("nonce") != nonce):
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT — سجّل دخول من جديد."))
        if claims.get("azp") not in (None, client_id):
            raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT — سجّل دخول من جديد."))
        return claims

    async def _token(self, form: dict[str, str]) -> dict[str, Any]:
        config = await self.discovery()
        try:
            async with self._http() as http:
                resp = await http.post(
                    config.token_endpoint, data=form, headers={"Accept": "application/json"}
                )
            data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AuthError(tr("ما قدرت أوصل لـ ChatGPT — تأكد من الإنترنت.")) from exc
        if resp.status_code >= 400 or not isinstance(data, dict):
            code = data.get("error") if isinstance(data, dict) else None
            about = data.get("error_description") if isinstance(data, dict) else None
            if form.get("grant_type") == "refresh_token" and code in _DEAD_REFRESH:
                raise RefreshRejected(tr("انتهى تسجيل الدخول بـ ChatGPT — سجّل دخول من جديد."))
            detail = f"{code or resp.status_code}: {str(about)[:160]}" if about else (code or resp.status_code)
            raise AuthError(tr("ChatGPT رفض الطلب ({0}).", detail))
        return data

    # ── Signing in ─────────────────────────────────────────────────────────────────────

    async def start(self, callback_base: str) -> DeviceStart:  # noqa: ARG002 - its own listener
        config = await self.discovery()
        flow_id = uuid.uuid4().hex
        previous = issued_client_id()
        flow = _Flow(
            secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(48), previous
        )
        await self._listen(flow_id, flow)
        query: dict[str, str] = {
            "client_id": previous or DYNAMIC_CLIENT,
            "response_type": "code",
            "redirect_uri": flow.redirect_uri,
            "scope": SCOPES,
            "resource": RESOURCE,
            "state": flow.state,
            "nonce": flow.nonce,
            "code_challenge_method": "S256",
            "code_challenge": _b64url(hashlib.sha256(flow.verifier.encode("ascii")).digest()),
            "ext_agent_host_id": host_id(),
        }
        if not previous:
            query["agent_name_hint"] = APP_NAME
        self._flows[flow_id] = flow
        return DeviceStart(
            flow_id=flow_id,
            verification_uri=f"{config.authorization_endpoint}?{urlencode(query)}",
            expires_in=SIGN_IN_TIMEOUT,
            interval=2,
            kind="browser",
        )

    async def _listen(self, flow_id: str, flow: _Flow) -> None:
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            try:
                await self._serve(flow_id, flow, reader, writer)
            finally:
                with contextlib.suppress(Exception):
                    writer.close()

        server = None
        for port in (PREFERRED_PORT, 0):
            try:
                server = await asyncio.start_server(handle, host="127.0.0.1", port=port)
                break
            except OSError:
                continue
        if server is None:
            raise AuthError(tr("ما قدرت أفتح منفذ لتسجيل الدخول — سكّر نسخة تانية من رفيق وجرّب."))
        flow.server = server
        port = server.sockets[0].getsockname()[1]
        flow.redirect_uri = f"http://127.0.0.1:{port}{CALLBACK_PATH}"

        async def stop_later() -> None:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(flow.done.wait(), SIGN_IN_TIMEOUT)
            server.close()

        asyncio.get_running_loop().create_task(stop_later())

    async def _serve(
        self, flow_id: str, flow: _Flow, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 15)
        except (TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            return
        lines = head.decode("latin-1").split("\r\n")
        method, _, rest = lines[0].partition(" ")
        target = rest.rsplit(" ", 1)[0]
        headers = {
            k.strip().lower(): v.strip()
            for k, _, v in (line.partition(":") for line in lines[1:] if ":" in line)
        }
        url = urlsplit(target)
        expected_host = flow.redirect_uri.split("//", 1)[1].split("/", 1)[0]
        if (
            method != "GET"
            or url.path != CALLBACK_PATH
            or headers.get("host") != expected_host
            or flow.done.is_set()
            or flow.claimed
        ):
            await self._reply(writer, 404, tr("مش موجود"), "")
            return
        params = parse_qs(url.query, keep_blank_values=True)
        state = params.get("state", [])
        if len(state) != 1 or not hmac.compare_digest(state[0], flow.state):
            # An unrelated request mustn't spend the sign-in that's waiting.
            await self._reply(
                writer,
                400,
                tr("هالرابط مش من تسجيل الدخول الحالي"),
                tr("ارجع للتبويب اللي بلّشت منه تسجيل الدخول."),
            )
            return
        # Claimed before anything is awaited: a second request from the browser can't spend
        # the one-time code again.
        flow.claimed = True
        await self._reply(
            writer, 200, tr("تمام، رجعنا لرفيق"), tr("رفيق عم يكمّل ربط حساب ChatGPT. فيك تسكّر هالصفحة.")
        )
        flow.outcome = await self._finish(flow, params)
        flow.done.set()

    async def _reply(self, writer: asyncio.StreamWriter, status: int, title: str, body: str) -> None:
        from html import escape

        from rafiq_agent.i18n import current_locale

        loc = current_locale()
        page = (
            f'<!doctype html><html lang="{loc}" dir="{"rtl" if loc == "ar" else "ltr"}"><meta charset="utf-8">'
            f"<title>{escape(tr('رفيق'))}</title><body style=\"font-family:system-ui,'Segoe UI',Tahoma,sans-serif;"
            'background:#141414;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0">'
            '<div style="text-align:center;max-width:26rem;padding:2rem">'
            '<div style="width:56px;height:56px;border-radius:14px;background:#e68835;margin:0 auto 1rem"></div>'
            f'<h1 style="font-size:1.25rem;margin:0 0 .5rem">{escape(title)}</h1>'
            f'<p style="color:#aaa;line-height:1.7;margin:0">{escape(body)}</p></div>'
            "<script>history.replaceState(null,'','/auth/complete')</script></body></html>"
        ).encode()
        reason = {200: "OK", 400: "Bad Request", 404: "Not Found"}.get(status, "OK")
        writer.write(
            f"HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len(page)}\r\n"
            "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n".encode(
                "ascii"
            )
            + page
        )
        with contextlib.suppress(Exception):
            await writer.drain()

    async def _finish(self, flow: _Flow, params: dict[str, list[str]]) -> PollOutcome:
        error = (params.get("error") or [None])[0]
        if error:
            if error == "access_denied":
                return PollOutcome("denied", message=tr("ما وافقت على ربط ChatGPT برفيق."))
            return PollOutcome("error", message=tr("ChatGPT رفض تسجيل الدخول ({0}).", error))
        codes = params.get("code", [])
        returned = params.get("client_id", [])
        client_id = returned[0] if len(returned) == 1 else flow.previous_client
        if (
            len(codes) != 1
            or not codes[0]
            or len(returned) > 1
            or not client_id
            or client_id == DYNAMIC_CLIENT
        ):
            return PollOutcome("error", message=tr("ChatGPT ما كمّل تسجيل التطبيق — جرّب مرة تانية."))
        if flow.previous_client and returned and returned[0] != flow.previous_client:
            return PollOutcome("error", message=tr("ChatGPT ما كمّل تسجيل التطبيق — جرّب مرة تانية."))
        # Kept before the one-time code is spent: a failed exchange mustn't register Rafiq
        # a second time.
        if not flow.previous_client:
            _remember_client_id(client_id)
        try:
            data = await self._token(
                {
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "code": codes[0],
                    "code_verifier": flow.verifier,
                    "redirect_uri": flow.redirect_uri,
                    "resource": RESOURCE,
                }
            )
            id_token = data.get("id_token")
            if not isinstance(id_token, str):
                raise AuthError(tr("ما قدرت أتأكد من هوية حساب ChatGPT — سجّل دخول من جديد."))
            claims = await self.verify_id_token(id_token, client_id, flow.nonce)
        except AuthError as exc:
            return PollOutcome("error", message=str(exc))
        scopes = str(data.get("scope") or "").split()
        access, refresh = data.get("access_token"), data.get("refresh_token")
        if PLAN_SCOPE not in scopes or not isinstance(access, str) or not isinstance(refresh, str):
            # Signed in, but without the plan: there's nothing Rafiq can run on it.
            return PollOutcome(
                "error",
                message=tr(
                    "تسجيل الدخول زبط، بس ما سمحت لرفيق يستخدم خطة ChatGPT. جرّب مرة تانية ووافق على «استخدام خطتك»."
                ),
                kind="chatgpt_plan_off",
            )
        label = str(claims.get("email") or claims.get("name") or "ChatGPT")
        return PollOutcome(
            "complete",
            identity=ConnectedIdentity(
                token=access,
                external_id=str(claims["sub"]),
                label=label,
                refresh_token=refresh,
                expires_in=int(data.get("expires_in") or 3600),
                refresh_expires_in=REFRESH_LIFETIME,
            ),
            kind="chatgpt_welcome",
        )

    async def poll(self, flow_id: str) -> PollOutcome:
        flow = self._flows.get(flow_id)
        if flow is None:
            return PollOutcome("expired", message=tr("انتهت محاولة الدخول — ابدأ من جديد."))
        if flow.outcome is not None:
            self._flows.pop(flow_id, None)
            return flow.outcome
        if time.monotonic() - flow.started > SIGN_IN_TIMEOUT:
            self._flows.pop(flow_id, None)
            flow.done.set()
            return PollOutcome("expired", message=tr("انتهت صلاحية الموافقة — ابدأ من جديد."))
        return PollOutcome("pending")

    # ── After sign-in ──────────────────────────────────────────────────────────────────

    async def refresh(self, refresh_token: str, subject: str | None = None) -> TokenPair:
        client_id = issued_client_id()
        if not client_id:
            raise RefreshRejected(tr("انتهى تسجيل الدخول بـ ChatGPT — سجّل دخول من جديد."))
        data = await self._token(
            {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": refresh_token,
                "resource": RESOURCE,
            }
        )
        access, new_refresh = data.get("access_token"), data.get("refresh_token")
        if not isinstance(access, str) or not isinstance(new_refresh, str):
            raise AuthError(tr("ChatGPT رجّع تسجيل دخول ناقص."))
        id_token = data.get("id_token")
        if isinstance(id_token, str) and subject:
            claims = await self.verify_id_token(id_token, client_id)
            if claims.get("sub") != subject:
                raise RefreshRejected(tr("تسجيل الدخول المجدد طلع لحساب ChatGPT تاني — سجّل دخول من جديد."))
        return TokenPair(
            token=access,
            refresh_token=new_refresh,
            expires_in=int(data.get("expires_in") or 3600),
            refresh_expires_in=REFRESH_LIFETIME,
        )

    async def revoke_refresh(self, refresh_token: str) -> None:
        """Ends the sign-in at OpenAI too (best effort; the local copy goes regardless)."""
        client_id = issued_client_id()
        with contextlib.suppress(Exception):
            config = await self.discovery()
            if config.revocation_endpoint and client_id:
                async with self._http() as http:
                    await http.post(
                        config.revocation_endpoint,
                        data={
                            "token": refresh_token,
                            "token_type_hint": "refresh_token",
                            "client_id": client_id,
                        },
                    )

    async def list_models(self, token: str) -> list[tuple[str, str]]:
        """The models this ChatGPT plan can use (`visibility: list`), by slug."""
        async with self._http() as http:
            resp = await http.get(f"{RESOURCE}/models", headers={"Authorization": f"Bearer {token}"})
        if resp.status_code == 401:
            raise AuthError(tr("تسجيل الدخول بـ ChatGPT انتهى — سجّل دخول من جديد."))
        if resp.status_code >= 400:
            raise AuthError(tr("ChatGPT ما عطى قائمة الموديلات ({0}).", resp.status_code))
        listed = resp.json().get("data") or resp.json().get("models") or []
        out: list[tuple[str, str]] = []
        for m in listed:
            if not isinstance(m, dict) or m.get("visibility", "list") != "list":
                continue
            slug = m.get("slug") or m.get("id")
            if isinstance(slug, str) and slug:
                out.append((slug, str(m.get("display_name") or m.get("name") or slug)))
        return out

    async def check(self, token: str) -> None:
        await self.list_models(token)
