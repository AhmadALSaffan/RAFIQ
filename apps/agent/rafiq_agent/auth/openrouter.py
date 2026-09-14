"""OpenRouter sign-in: OpenRouter's documented OAuth PKCE flow for third-party apps.

The user approves Rafiq on openrouter.ai; OpenRouter redirects to Rafiq's local callback
with a one-time code, and Rafiq exchanges it — with the PKCE verifier that never left this
process — for a user-controlled OpenRouter API key. From then on the key works exactly
like one pasted by hand, except the user never had to copy it.

No app registration is needed, localhost callbacks are allowed on any port, and the code
is single-use and expires after 10 minutes.

Docs: https://openrouter.ai/docs/guides/overview/auth/oauth
"""

import base64
import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx

from rafiq_agent.auth.base import AuthError, ConnectedIdentity, DeviceStart, PollOutcome
from rafiq_agent.i18n import tr

AUTH_URL = "https://openrouter.ai/auth"
EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys"
KEY_INFO_URL = "https://openrouter.ai/api/v1/key"
KEY_LABEL = "Rafiq"
CODE_LIFETIME = 600  # seconds — OpenRouter's code expires after 10 minutes


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@dataclass
class _Flow:
    verifier: str = field(repr=False)
    expires_at: float
    outcome: PollOutcome | None = None


class OpenRouterAdapter:
    provider = "openrouter"
    name = "OpenRouter"
    method = "oauth"
    experimental = False

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport
        self._flows: dict[str, _Flow] = {}

    def unavailable_reason(self) -> str | None:
        return None

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=20, transport=self._transport)

    async def start(self, callback_base: str) -> DeviceStart:
        flow_id = uuid.uuid4().hex
        verifier = secrets.token_urlsafe(64)
        self._flows[flow_id] = _Flow(verifier=verifier, expires_at=time.monotonic() + CODE_LIFETIME)
        query = urlencode(
            {
                # The flow id rides in the path, so OpenRouter's appended ?code= can't clash.
                "callback_url": f"{callback_base.rstrip('/')}/{flow_id}",
                "code_challenge": _challenge(verifier),
                "code_challenge_method": "S256",
                "key_label": KEY_LABEL,
            }
        )
        return DeviceStart(
            flow_id=flow_id,
            verification_uri=f"{AUTH_URL}?{query}",
            expires_in=CODE_LIFETIME,
            interval=2,
            kind="browser",
        )

    async def receive(self, flow_id: str, code: str) -> bool:
        """Called by the local callback. Exchanges the code; the result waits for `poll`.

        Returns False for an unknown or already-used flow, so the callback can say so
        without touching anything.
        """
        flow = self._flows.get(flow_id)
        if flow is None or flow.outcome is not None or not code:
            return False
        if time.monotonic() > flow.expires_at:
            flow.outcome = PollOutcome("expired", message=tr("انتهت صلاحية الموافقة — ابدأ من جديد."))
            return True
        try:
            key = await self._exchange(code, flow.verifier)
            await self.check(key)
        except AuthError as exc:
            flow.outcome = PollOutcome("error", message=str(exc))
            return True
        flow.outcome = PollOutcome(
            "complete",
            identity=ConnectedIdentity(
                token=key,
                # Every approval issues a new key, so each one is its own account row.
                external_id=hashlib.sha256(key.encode()).hexdigest()[:16],
                label=f"OpenRouter …{key[-4:]}",
            ),
        )
        return True

    async def poll(self, flow_id: str) -> PollOutcome:
        flow = self._flows.get(flow_id)
        if flow is None:
            return PollOutcome("expired", message=tr("انتهت محاولة الدخول — ابدأ من جديد."))
        if flow.outcome is not None:
            self._flows.pop(flow_id, None)
            return flow.outcome
        if time.monotonic() > flow.expires_at:
            self._flows.pop(flow_id, None)
            return PollOutcome("expired", message=tr("انتهت صلاحية الموافقة — ابدأ من جديد."))
        return PollOutcome("pending")

    async def _exchange(self, code: str, verifier: str) -> str:
        try:
            async with self._http() as http:
                resp = await http.post(
                    EXCHANGE_URL,
                    json={"code": code, "code_verifier": verifier, "code_challenge_method": "S256"},
                )
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتصل بـ OpenRouter — تأكد من الإنترنت.")) from exc
        if resp.status_code >= 400:
            raise AuthError(tr("OpenRouter رفض رمز الموافقة — ابدأ من جديد."))
        key = (resp.json() or {}).get("key")
        if not key:
            raise AuthError(tr("OpenRouter ما رجّع مفتاح."))
        return key

    async def check(self, token: str) -> None:
        try:
            async with self._http() as http:
                resp = await http.get(KEY_INFO_URL, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            raise AuthError(tr("ما قدرت اتأكد من مفتاح OpenRouter.")) from exc
        if resp.status_code >= 400:
            raise AuthError(tr("OpenRouter ما قبل المفتاح الجديد."))
