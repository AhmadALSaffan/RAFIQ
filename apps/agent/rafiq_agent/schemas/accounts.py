from datetime import datetime

from pydantic import BaseModel


class AccountProviderOut(BaseModel):
    id: str
    name: str
    method: str
    experimental: bool
    available: bool
    unavailable_reason: str | None = None


class AccountOut(BaseModel):
    """What the UI may know about a connected account — never the token."""

    id: str
    provider: str
    method: str
    label: str
    status: str
    created_at: datetime
    verified_at: datetime | None = None
    # Names of the agents that sign in with this account.
    used_by: list[str] = []


class ConnectStartOut(BaseModel):
    flow_id: str
    verification_uri: str
    expires_in: int
    interval: int
    # "device": show `user_code`, the user types it at `verification_uri`.
    # "browser": open `verification_uri`; the provider redirects back to Rafiq by itself.
    user_code: str = ""
    kind: str = "device"


class ConnectPollOut(BaseModel):
    status: str  # pending | complete | expired | denied | error
    message: str | None = None
    account: AccountOut | None = None
