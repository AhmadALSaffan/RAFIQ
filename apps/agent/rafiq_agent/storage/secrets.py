import contextlib
import uuid

import keyring

from rafiq_agent.config import KEYRING_SERVICE

# Windows Credential Manager holds at most 2,560 bytes per entry, stored as UTF-16 — 1,280
# characters. Anything longer fails with (1783, 'CredWrite', 'The stub received bad data').
# OAuth sign-ins (tokens + the server's metadata + the registered client) and service-account
# JSON run past that, so a long value is split over several entries: `<name>#1`, `<name>#2`…
# and the entry under the name itself only says how many parts there are. Short values are
# stored as they always were.
PART_CHARS = 600  # ≤ 2,400 bytes even if every character took two UTF-16 units
_CHUNKED = "rafiq-chunked:v1:"


def _read(username: str) -> str | None:
    head = keyring.get_password(KEYRING_SERVICE, username)
    if head is None or not head.startswith(_CHUNKED):
        return head
    try:
        count = int(head[len(_CHUNKED) :])
    except ValueError:
        return None
    parts = [keyring.get_password(KEYRING_SERVICE, f"{username}#{i}") for i in range(1, count + 1)]
    if any(part is None for part in parts):
        return None  # a part went missing: no value beats a corrupt one
    return "".join(parts)  # type: ignore[arg-type]


def _part_count(username: str) -> int:
    head = keyring.get_password(KEYRING_SERVICE, username)
    if head is None or not head.startswith(_CHUNKED):
        return 0
    try:
        return int(head[len(_CHUNKED) :])
    except ValueError:
        return 0


def _delete_parts(username: str, start: int, end: int) -> None:
    for i in range(start, end + 1):
        with contextlib.suppress(keyring.errors.PasswordDeleteError):
            keyring.delete_password(KEYRING_SERVICE, f"{username}#{i}")


def _write(username: str, value: str) -> None:
    before = _part_count(username)
    if len(value) <= PART_CHARS:
        keyring.set_password(KEYRING_SERVICE, username, value)
        _delete_parts(username, 1, before)
        return
    parts = [value[i : i + PART_CHARS] for i in range(0, len(value), PART_CHARS)]
    # Parts first, then the head that points at them: a reader never finds a head whose
    # parts aren't written yet.
    for i, part in enumerate(parts, start=1):
        keyring.set_password(KEYRING_SERVICE, f"{username}#{i}", part)
    keyring.set_password(KEYRING_SERVICE, username, f"{_CHUNKED}{len(parts)}")
    _delete_parts(username, len(parts) + 1, before)


def _delete(username: str) -> None:
    count = _part_count(username)
    with contextlib.suppress(keyring.errors.PasswordDeleteError):
        keyring.delete_password(KEYRING_SERVICE, username)
    _delete_parts(username, 1, count)


def store_api_key(api_key: str) -> str:
    """Stores a raw API key in the OS credential store and returns an opaque reference."""
    ref = uuid.uuid4().hex
    _write(ref, api_key)
    return ref


def get_api_key(ref: str | None) -> str | None:
    if not ref:
        return None
    return _read(ref)


def delete_api_key(ref: str | None) -> None:
    if not ref:
        return
    _delete(ref)


# Named entries, for app-level secrets that belong to no single row (e.g. an experimental
# integration's per-app credential). Same keychain, same service — just a fixed name.
def set_named_secret(name: str, value: str) -> None:
    _write(f"named:{name}", value)


def get_named_secret(name: str) -> str | None:
    return _read(f"named:{name}")


def delete_named_secret(name: str) -> None:
    _delete(f"named:{name}")
