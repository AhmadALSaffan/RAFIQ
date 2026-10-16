"""GitHub Copilot sign-in: GitHub's documented OAuth Device Flow with Rafiq's own OAuth App.

The user gets a short code, enters it at github.com/login/device, and GitHub hands us a
user access token (`gho_…`) that the official Copilot SDK accepts. No client secret is
involved (device flow doesn't need one), no password ever passes through Rafiq, and the
device code stays in this process — only the user code goes to the UI.

GitHub's newer OAuth apps get short-lived tokens: the access token lasts 8 hours and comes
with a refresh token that lasts 6 months from its last use. Rafiq keeps both and renews the
access token before it runs out (`refresh`, driven by auth/refresh.py), so the user signs in
once. A device-flow token renews with the client id alone — still no secret.

Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
"""

import asyncio
import time
import uuid
from dataclasses import dataclass

import httpx

from rafiq_agent.auth.base import (
    AuthError,
    ConnectedIdentity,
    DeviceStart,
    PollOutcome,
    RefreshRejected,
    TokenPair,
)
from rafiq_agent.config import GITHUB_OAUTH_CLIENT_ID
from rafiq_agent.i18n import tr
from rafiq_agent.llm import copilot

DEVICE_CODE_URL = "https://github.com/login/device/code"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"
GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
REFRESH_GRANT = "refresh_token"
# Enough to show who signed in. Copilot access comes from the user's subscription, which
# `copilot.check_token` confirms before the account is saved.
SCOPE = "read:user"

_ERRORS = {
    "device_flow_disabled": "تسجيل الدخول بالجهاز (Device Flow) مش مفعّل على تطبيق GitHub تبع رفيق.",
    "incorrect_client_credentials": "معرّف تطبيق GitHub تبع رفيق غير صحيح.",
    "unsupported_grant_type": "GitHub رفض طريقة الدخول.",
}


@dataclass
class _Flow:
    device_code: str
    interval: int
    expires_at: float
    next_poll: float


class GitHubCopilotAdapter:
    provider = "github_copilot"
    name = "GitHub Copilot"
    method = "oauth"
    experimental = False

    def __init__(
        self, client_id: str = GITHUB_OAUTH_CLIENT_ID, transport: httpx.AsyncBaseTransport | None = None
    ):
        self._client_id = client_id
        self._transport = transport
        self._flows: dict[str, _Flow] = {}

    def unavailable_reason(self) -> str | None:
        if not self._client_id:
            return tr("ما في معرّف تطبيق GitHub بهالنسخة.")
        if not copilot.sdk_available():
            return tr("مكتبة GitHub Copilot مش مثبّتة بهالنسخة.")
        return None

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=20, transport=self._transport, headers={"Accept": "application/json"}
        )

    async def start(self, callback_base: str = "") -> DeviceStart:
        try:
            async with self._http() as http:
                resp = await http.post(DEVICE_CODE_URL, data={"client_id": self._client_id, "scope": SCOPE})
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتصل بـ GitHub — تأكد من الإنترنت.")) from exc
        body = resp.json() if resp.content else {}
        if "error" in body or resp.status_code >= 400:
            raise AuthError(tr(_ERRORS.get(body.get("error", ""), "GitHub رفض طلب تسجيل الدخول.")))

        flow_id = uuid.uuid4().hex
        interval = int(body.get("interval", 5))
        expires_in = int(body.get("expires_in", 900))
        now = time.monotonic()
        self._flows[flow_id] = _Flow(
            device_code=body["device_code"], interval=interval, expires_at=now + expires_in, next_poll=now
        )
        return DeviceStart(
            flow_id=flow_id,
            user_code=body["user_code"],
            verification_uri=body.get("verification_uri", "https://github.com/login/device"),
            expires_in=expires_in,
            interval=interval,
        )

    async def poll(self, flow_id: str, now_please: bool = False) -> PollOutcome:
        """`now_please`: the user says they've approved — ask GitHub straight away instead of
        waiting out the polling interval."""
        flow = self._flows.get(flow_id)
        if flow is None:
            return PollOutcome("expired", message=tr("انتهت محاولة الدخول — ابدأ من جديد."))
        now = time.monotonic()
        if now > flow.expires_at:
            self._flows.pop(flow_id, None)
            return PollOutcome("expired", message=tr("انتهت صلاحية الرمز — ابدأ من جديد."))
        # GitHub rate-limits polling; asking early just earns a slow_down.
        if now < flow.next_poll and not now_please:
            return PollOutcome("pending")
        flow.next_poll = now + flow.interval

        try:
            async with self._http() as http:
                resp = await http.post(
                    TOKEN_URL,
                    data={
                        "client_id": self._client_id,
                        "device_code": flow.device_code,
                        "grant_type": GRANT_TYPE,
                    },
                )
        except httpx.HTTPError:
            return PollOutcome("pending")
        body = resp.json() if resp.content else {}
        error = body.get("error")

        if error == "authorization_pending":
            return PollOutcome("pending")
        if error == "slow_down":
            flow.interval = int(body.get("interval", flow.interval + 5))
            flow.next_poll = time.monotonic() + flow.interval
            return PollOutcome("pending")
        if error == "expired_token":
            self._flows.pop(flow_id, None)
            return PollOutcome("expired", message=tr("انتهت صلاحية الرمز — ابدأ من جديد."))
        if error == "access_denied":
            self._flows.pop(flow_id, None)
            return PollOutcome("denied", message=tr("تم رفض الدخول من GitHub."))
        if error or "access_token" not in body:
            self._flows.pop(flow_id, None)
            return PollOutcome("error", message=tr(_ERRORS.get(error or "", "GitHub رجّع رد غير متوقع.")))

        self._flows.pop(flow_id, None)
        token = body["access_token"]
        try:
            identity = await self._identity(token)
        except AuthError as exc:
            return PollOutcome("error", message=str(exc))
        identity.refresh_token = body.get("refresh_token") or None
        identity.expires_in = _seconds(body.get("expires_in"))
        identity.refresh_expires_in = _seconds(body.get("refresh_token_expires_in"))
        # A token minted a second ago is sometimes refused by Copilot for a few seconds (a 401
        # while it propagates). Give it a moment before calling the sign-in a failure.
        for attempt in range(3):
            try:
                await self.check(token)
                break
            except AuthError as exc:
                if exc.kind == "copilot_not_enabled":
                    # The sign-in is good; Copilot just isn't turned on yet. Keep the
                    # account, so after turning it on there's no second sign-in.
                    return PollOutcome("complete", identity=identity, message=str(exc), kind=exc.kind)
                if attempt == 2:
                    return PollOutcome("error", message=str(exc), kind=exc.kind)
                await asyncio.sleep(2 + 2 * attempt)
        return PollOutcome("complete", identity=identity)

    async def _identity(self, token: str) -> ConnectedIdentity:
        try:
            async with self._http() as http:
                resp = await http.get(USER_URL, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت أجيب معلومات حساب GitHub.")) from exc
        if resp.status_code >= 400:
            raise AuthError(tr("GitHub رفض التوكن."))
        user = resp.json()
        return ConnectedIdentity(
            token=token, external_id=str(user.get("id", "")), label=user.get("login", "GitHub")
        )

    async def check(self, token: str) -> None:
        await copilot.check_token(token)

    async def refresh(self, refresh_token: str) -> TokenPair:
        """A new access token (and a new refresh token — the old pair stops working).
        Raises RefreshRejected when GitHub refuses the refresh token itself, AuthError when
        GitHub can't be reached (try again later; nothing is lost)."""
        try:
            async with self._http() as http:
                resp = await http.post(
                    TOKEN_URL,
                    data={"client_id": self._client_id, "grant_type": REFRESH_GRANT, "refresh_token": refresh_token},
                )
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتصل بـ GitHub — تأكد من الإنترنت.")) from exc
        body = resp.json() if resp.content else {}
        error = body.get("error")
        if error in ("bad_refresh_token", "unauthorized_client", "incorrect_client_credentials") or (
            resp.status_code in (400, 401) and "access_token" not in body
        ):
            raise RefreshRejected(tr("انتهى دخولك لـ GitHub — اربط الحساب من جديد من الإعدادات ← الحسابات المتصلة."))
        if error or "access_token" not in body:
            raise AuthError(tr("GitHub رجّع رد غير متوقع."))
        return TokenPair(
            token=body["access_token"],
            refresh_token=body.get("refresh_token") or None,
            expires_in=_seconds(body.get("expires_in")),
            refresh_expires_in=_seconds(body.get("refresh_token_expires_in")),
        )


def _seconds(value: object) -> int | None:
    try:
        number = int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None
