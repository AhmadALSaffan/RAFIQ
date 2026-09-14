import contextlib
import uuid

import keyring

from rafiq_agent.config import KEYRING_SERVICE


def store_api_key(api_key: str) -> str:
    """Stores a raw API key in the OS credential store and returns an opaque reference."""
    ref = uuid.uuid4().hex
    keyring.set_password(KEYRING_SERVICE, ref, api_key)
    return ref


def get_api_key(ref: str | None) -> str | None:
    if not ref:
        return None
    return keyring.get_password(KEYRING_SERVICE, ref)


def delete_api_key(ref: str | None) -> None:
    if not ref:
        return
    with contextlib.suppress(keyring.errors.PasswordDeleteError):
        keyring.delete_password(KEYRING_SERVICE, ref)
