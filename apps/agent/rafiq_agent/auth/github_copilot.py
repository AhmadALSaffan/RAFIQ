"""GitHub Copilot sign-in: GitHub's documented OAuth Device Flow with Rafiq's own OAuth App.

The user gets a short code, enters it at github.com/login/device, and GitHub hands us a
user access token (`gho_…`) that the official Copilot SDK accepts. No client secret is
involved (device flow doesn't need one), no password ever passes through Rafiq, and the
device code stays in this process — only the user code goes to the UI.

Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
"""

import time
import uuid
from dataclasses import dataclass

import httpx

from rafiq_agent.auth.base import AuthError, ConnectedIdentity, DeviceStart, PollOutcome
from rafiq_agent.config import GITHUB_OAUTH_CLIENT_ID
from rafiq_agent.i18n import tr
from rafiq_agent.llm import copilot

DEVICE_CODE_URL = "https://github.com/login/device/code"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"
GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
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

    async def poll(self, flow_id: str) -> PollOutcome:
        flow = self._flows.get(flow_id)
        if flow is None:
            return PollOutcome("expired", message=tr("انتهت محاولة الدخول — ابدأ من جديد."))
        now = time.monotonic()
        if now > flow.expires_at:
            self._flows.pop(flow_id, None)
            return PollOutcome("expired", message=tr("انتهت صلاحية الرمز — ابدأ من جديد."))
        # GitHub rate-limits polling; asking early just earns a slow_down.
        if now < flow.next_poll:
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
            await self.check(token)
        except AuthError as exc:
            return PollOutcome("error", message=str(exc))
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
