"""Long secrets in a credential store that only holds 1,280 characters per entry."""

import pytest

from rafiq_agent.storage import secrets


@pytest.fixture
def windows_vault(monkeypatch):
    """Behaves like Windows Credential Manager: a value past 2,560 UTF-16 bytes is refused
    with the same error Rafiq users saw on Figma's sign-in."""
    vault: dict[tuple[str, str], str] = {}

    def set_password(service: str, name: str, value: str) -> None:
        if len(value.encode("utf-16-le")) > 2560:
            raise OSError(1783, "CredWrite", "The stub received bad data")
        vault[(service, name)] = value

    def delete_password(service: str, name: str) -> None:
        if (service, name) not in vault:
            raise secrets.keyring.errors.PasswordDeleteError(name)
        del vault[(service, name)]

    monkeypatch.setattr("keyring.set_password", set_password)
    monkeypatch.setattr("keyring.get_password", lambda s, k: vault.get((s, k)))
    monkeypatch.setattr("keyring.delete_password", delete_password)
    return vault


def test_a_sign_in_bigger_than_one_entry_round_trips(windows_vault):
    big = '{"tokens": "' + "ey" * 2600 + '", "note": "عربي ✓ 𝄞"}'
    secrets.set_named_secret("mcp-oauth:figma", big)
    assert secrets.get_named_secret("mcp-oauth:figma") == big
    assert len(windows_vault) > 2  # spread over several entries


def test_shrinking_and_deleting_leave_no_parts_behind(windows_vault):
    secrets.set_named_secret("s", "x" * 3000)
    secrets.set_named_secret("s", "y" * 1300)
    assert secrets.get_named_secret("s") == "y" * 1300
    assert len(windows_vault) == 1 + 3  # head + three parts, the old fifth gone
    secrets.set_named_secret("s", "short")
    assert secrets.get_named_secret("s") == "short"
    assert len(windows_vault) == 1
    secrets.set_named_secret("s", "z" * 2000)
    secrets.delete_named_secret("s")
    assert windows_vault == {}
    assert secrets.get_named_secret("s") is None


def test_a_missing_part_reads_as_nothing(windows_vault):
    secrets.set_named_secret("s", "x" * 2000)
    del windows_vault[(secrets.KEYRING_SERVICE, "named:s#2")]
    assert secrets.get_named_secret("s") is None


def test_long_api_keys_too(windows_vault):
    service_account = "{" + "a" * 2400 + "}"  # a Vertex AI service-account JSON is ~2.3 KB
    ref = secrets.store_api_key(service_account)
    assert secrets.get_api_key(ref) == service_account
    secrets.delete_api_key(ref)
    assert windows_vault == {}
