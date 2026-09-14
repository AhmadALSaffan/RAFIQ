"""AuthAI — an EXPERIMENTAL, optional adapter. Off by default; nothing else depends on it.

What it is: an independent open-source relay (https://github.com/authai-io/authai) that lets
a user sign in with ChatGPT, Grok or GitHub Copilot and then speaks OpenAI's wire format
on `/v1/*`. Its own README says it is experimental, unofficial, unaffiliated with OpenAI /
xAI / GitHub, reuses the providers' CLI device-code flows, and forwards ChatGPT traffic to
chatgpt.com's backend. Rafiq surfaces that warning verbatim-in-spirit in the UI.

What Rafiq does here — and only this: call AuthAI's *documented* relay API:
  POST /auth/start {"provider": "openai" | "xai" | "github"}   (+ x-authai-secret, cloud)
  GET  /auth/poll/{sessionId}
  GET  /auth/whoami        (Authorization: Bearer <jwt>)
  POST /auth/revoke        (Authorization: Bearer <jwt>)
  GET  /v1/models, POST /v1/chat/completions   (Bearer <jwt> + x-authai-secret)
No provider endpoint is contacted directly, nothing is scraped, nothing bypassed.

Isolation: config lives in its own settings row ("authai"), the per-app secret in the OS
keychain, the session JWT in the keychain like any account token. The registry loads this
module inside a try/except, so if it breaks — or is deleted — Rafiq starts and runs as usual.
"""

import time
import uuid
from dataclasses import dataclass

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from rafiq_agent.api.deps import require_token
from rafiq_agent.auth.base import AuthError, ConnectedIdentity, DeviceStart, PollOutcome
from rafiq_agent.i18n import tr
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import SettingsRow
from rafiq_agent.storage.secrets import delete_named_secret, get_named_secret, set_named_secret

SETTINGS_KEY = "authai"
SECRET_NAME = "authai-app-secret"
HOSTED_RELAY = "https://relay.authai.io"
# AuthAI's documented provider ids → what the user recognises.
TARGETS = {"openai": "ChatGPT", "xai": "Grok", "github": "GitHub Copilot"}


# ── Config (its own settings row — AppSettings is untouched) ─────────────────────────


class AuthAIConfig(BaseModel):
    enabled: bool = False
    relay_url: str | None = None


class AuthAIConfigOut(AuthAIConfig):
    has_secret: bool = False


class AuthAIConfigIn(AuthAIConfig):
    # Write-only: stored in the keychain, never echoed back. Empty string clears it.
    secret: str | None = None


# The adapter is asked synchronously when resolving an agent's credentials, so the
# last-saved config is mirrored here.
_cache = AuthAIConfig()


async def load_config() -> AuthAIConfig:
    global _cache
    async with SessionLocal() as session:
        row = await session.get(SettingsRow, SETTINGS_KEY)
    _cache = AuthAIConfig.model_validate(row.value) if row else AuthAIConfig()
    return _cache


async def save_config(config: AuthAIConfig) -> None:
    global _cache
    async with SessionLocal() as session:
        row = await session.get(SettingsRow, SETTINGS_KEY)
        if row:
            row.value = config.model_dump()
        else:
            session.add(SettingsRow(key=SETTINGS_KEY, value=config.model_dump()))
        await session.commit()
    _cache = config


def _relay() -> str:
    return (_cache.relay_url or HOSTED_RELAY).rstrip("/")


def _secret_headers() -> dict[str, str]:
    secret = get_named_secret(SECRET_NAME)
    return {"x-authai-secret": secret} if secret else {}


router = APIRouter(prefix="/accounts/authai", tags=["accounts"], dependencies=[Depends(require_token)])


@router.get("/config", response_model=AuthAIConfigOut)
async def get_config() -> AuthAIConfigOut:
    config = await load_config()
    return AuthAIConfigOut(**config.model_dump(), has_secret=bool(get_named_secret(SECRET_NAME)))


@router.put("/config", response_model=AuthAIConfigOut)
async def put_config(body: AuthAIConfigIn) -> AuthAIConfigOut:
    relay = (body.relay_url or "").strip().rstrip("/") or None
    if relay and not relay.lower().startswith(("https://", "http://localhost", "http://127.0.0.1")):
        raise HTTPException(
            status_code=400, detail=tr("عنوان الـ relay لازم يكون https (أو localhost لو مستضيفه عندك).")
        )
    await save_config(AuthAIConfig(enabled=body.enabled, relay_url=relay))
    if body.secret is not None:
        if body.secret.strip():
            set_named_secret(SECRET_NAME, body.secret.strip())
        else:
            delete_named_secret(SECRET_NAME)
    return AuthAIConfigOut(
        enabled=body.enabled, relay_url=relay, has_secret=bool(get_named_secret(SECRET_NAME))
    )


# ── The adapter ──────────────────────────────────────────────────────────────────────


@dataclass
class _Flow:
    session_id: str
    target: str
    expires_at: float


class AuthAIAdapter:
    provider = "authai"
    name = "AuthAI"
    method = "experimental"
    experimental = True

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport
        self._flows: dict[str, _Flow] = {}

    def unavailable_reason(self) -> str | None:
        if not _cache.enabled:
            return tr("AuthAI مطفي — فعّله من بطاقة AuthAI تحت.")
        return None

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=20, transport=self._transport)

    async def start(self, callback_base: str = "", target: str = "openai") -> DeviceStart:
        await load_config()
        if not _cache.enabled:
            raise AuthError(tr("AuthAI مطفي."))
        if target not in TARGETS:
            raise AuthError(tr("اختار ChatGPT أو Grok أو GitHub Copilot."))
        try:
            async with self._http() as http:
                resp = await http.post(
                    f"{_relay()}/auth/start", json={"provider": target}, headers=_secret_headers()
                )
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتصل بـ AuthAI relay — تأكد من العنوان ومن الإنترنت.")) from exc
        if resp.status_code == 401:
            raise AuthError(tr("AuthAI رفض الطلب — تأكد من الـ app secret."))
        if resp.status_code == 503:
            raise AuthError(tr("AuthAI موقّف تسجيل الدخول الجديد مؤقتاً."))
        if resp.status_code >= 400:
            raise AuthError(tr("AuthAI رجّع خطأ ({0}).", resp.status_code))
        body = resp.json()
        flow_id = uuid.uuid4().hex
        expires_in = int(body.get("expiresInMs", 900_000) / 1000)
        self._flows[flow_id] = _Flow(
            session_id=body["sessionId"], target=target, expires_at=time.monotonic() + expires_in
        )
        return DeviceStart(
            flow_id=flow_id,
            user_code=body.get("userCode", ""),
            verification_uri=body.get("verificationUrl", ""),
            expires_in=expires_in,
            interval=max(2, int(body.get("pollIntervalMs", 5000) / 1000)),
            kind="device",
        )

    async def poll(self, flow_id: str) -> PollOutcome:
        flow = self._flows.get(flow_id)
        if flow is None or time.monotonic() > flow.expires_at:
            self._flows.pop(flow_id, None)
            return PollOutcome("expired", message=tr("انتهت محاولة الدخول — ابدأ من جديد."))
        try:
            async with self._http() as http:
                resp = await http.get(f"{_relay()}/auth/poll/{flow.session_id}", headers=_secret_headers())
        except httpx.HTTPError:
            return PollOutcome("pending")
        body = resp.json() if resp.content else {}
        status = body.get("status")
        if status == "pending":
            return PollOutcome("pending")
        self._flows.pop(flow_id, None)
        if status != "complete" or not body.get("jwt"):
            return PollOutcome("error", message=tr("AuthAI ما كمّل تسجيل الدخول."))
        jwt = body["jwt"]
        try:
            user_id = await self._whoami(jwt)
        except AuthError as exc:
            return PollOutcome("error", message=str(exc))
        return PollOutcome(
            "complete",
            identity=ConnectedIdentity(
                token=jwt,
                external_id=f"{flow.target}:{user_id}",
                label=f"{TARGETS[flow.target]} · {user_id[:6]}",
            ),
        )

    async def _whoami(self, jwt: str) -> str:
        try:
            async with self._http() as http:
                resp = await http.get(
                    f"{_relay()}/auth/whoami", headers={"Authorization": f"Bearer {jwt}", **_secret_headers()}
                )
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتأكد من الجلسة عند AuthAI.")) from exc
        if resp.status_code >= 400:
            raise AuthError(tr("AuthAI ما قبل الجلسة."))
        return str((resp.json().get("user") or {}).get("id", ""))

    async def check(self, token: str) -> None:
        await self._whoami(token)

    async def revoke(self, token: str) -> None:
        """Best effort: tell the relay to forget this session. Local deletion happens anyway."""
        try:
            async with self._http() as http:
                await http.post(
                    f"{_relay()}/auth/revoke",
                    headers={"Authorization": f"Bearer {token}", **_secret_headers()},
                )
        except httpx.HTTPError:
            pass

    # Hooks the core calls without knowing anything about AuthAI:

    def base_url(self) -> str:
        return f"{_relay()}/v1"

    def request_headers(self) -> dict[str, str]:
        return _secret_headers()

    async def list_models(self, token: str) -> list[tuple[str, str]]:
        try:
            async with self._http() as http:
                resp = await http.get(
                    f"{self.base_url()}/models",
                    headers={"Authorization": f"Bearer {token}", **_secret_headers()},
                )
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتصل بـ AuthAI relay.")) from exc
        if resp.status_code >= 400:
            raise AuthError(tr("AuthAI رفض الطلب — ممكن الجلسة انتهت، اربط الحساب من جديد."))
        return [(m["id"], m.get("id")) for m in resp.json().get("data", []) if m.get("id")]
