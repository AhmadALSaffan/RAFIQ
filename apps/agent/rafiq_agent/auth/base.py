"""The small contract every sign-in method shares.

A provider that supports account sign-in implements `AccountAdapter`; nothing else in the
app knows how GitHub (or any future provider) does OAuth. Tokens only ever pass through
`Credentials`, whose repr is redacted so a stray log line or traceback can't leak one.
"""

import re
from dataclasses import dataclass, field
from typing import Literal, Protocol

AuthMethod = Literal["api_key", "oauth", "experimental"]


class AuthError(Exception):
    """A readable, user-facing sign-in problem (Arabic message)."""


@dataclass(frozen=True, repr=False)
class Credentials:
    api_key: str | None = None
    base_url: str | None = None
    account_id: str | None = None

    def __repr__(self) -> str:
        return f"Credentials(account_id={self.account_id!r}, api_key=<redacted>)"


@dataclass
class DeviceStart:
    """What the user needs to finish a sign-in in their browser.

    `device`: type `user_code` at `verification_uri` (GitHub).
    `browser`: open `verification_uri` and approve; the provider redirects back to Rafiq's
    local callback with a one-time code (OAuth PKCE — OpenRouter).
    """

    flow_id: str
    verification_uri: str
    expires_in: int
    interval: int
    user_code: str = ""
    kind: Literal["device", "browser"] = "device"


@dataclass
class ConnectedIdentity:
    """Who signed in — returned by an adapter once the provider hands over a token."""

    token: str = field(repr=False)
    external_id: str
    label: str


@dataclass
class PollOutcome:
    status: Literal["pending", "complete", "expired", "denied", "error"]
    identity: ConnectedIdentity | None = None
    message: str | None = None


class AccountAdapter(Protocol):
    provider: str
    name: str
    method: AuthMethod
    experimental: bool

    def unavailable_reason(self) -> str | None:
        """None when usable on this machine; otherwise why not (shown in the UI)."""

    async def start(self, callback_base: str) -> DeviceStart:
        """`callback_base` is Rafiq's local callback URL for this provider; browser flows
        append the flow id to it, device flows ignore it."""

    async def poll(self, flow_id: str) -> PollOutcome: ...

    async def check(self, token: str) -> None:
        """Raise AuthError if the token can't actually be used with this provider."""


# Token shapes from the providers we talk to. Used to scrub error text before it is stored
# or shown — a provider error that echoes a credential must never reach the UI or a log.
_SECRET_PATTERNS = re.compile(
    r"(gh[opsu]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_\-]{16,}|Bearer\s+[A-Za-z0-9._\-]{16,})"
)


def redact(text: str) -> str:
    return _SECRET_PATTERNS.sub("<redacted>", text)
