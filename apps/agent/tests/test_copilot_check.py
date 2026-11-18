"""`copilot.self_check`: what the Mac build runs to prove Copilot works in the frozen app."""

import asyncio

import pytest

from rafiq_agent.llm import copilot


class _Status:
    def __init__(self, signed_in: bool):
        self.isAuthenticated = signed_in


class _Client:
    def __init__(self, status=None, error=None):
        self.status, self.error, self.stopped = status, error, False

    async def get_auth_status(self):
        if self.error:
            raise RuntimeError(self.error)
        return self.status

    async def stop(self):
        self.stopped = True


def _with_client(monkeypatch, client):
    async def new_client(token, home):
        return client

    monkeypatch.setattr(copilot, "sdk_available", lambda: True)
    monkeypatch.setattr(copilot, "_new_client", new_client)


def test_a_started_runtime_passes_and_reports_the_sign_in(monkeypatch):
    client = _Client(status=_Status(False))
    _with_client(monkeypatch, client)
    report = asyncio.run(copilot.self_check("ghs_x"))
    assert report == {"sdk": True, "runtime": True, "authenticated": False}
    assert client.stopped


def test_an_auth_error_after_start_still_passes(monkeypatch):
    client = _Client(error="Not authenticated. Please authenticate first.")
    _with_client(monkeypatch, client)
    report = asyncio.run(copilot.self_check("ghs_x"))
    assert report["runtime"] is True and "Not authenticated" in report["auth_error"]
    assert client.stopped


def test_no_sdk_fails_without_starting_anything(monkeypatch):
    monkeypatch.setattr(copilot, "sdk_available", lambda: False)

    async def boom(token, home):
        raise AssertionError("must not start a runtime")

    monkeypatch.setattr(copilot, "_new_client", boom)
    assert asyncio.run(copilot.self_check("x")) == {"sdk": False, "runtime": False}


def test_a_runtime_that_cannot_start_raises(monkeypatch):
    monkeypatch.setattr(copilot, "sdk_available", lambda: True)

    async def broken(token, home):
        raise RuntimeError("download failed")

    monkeypatch.setattr(copilot, "_new_client", broken)
    with pytest.raises(RuntimeError, match="download failed"):
        asyncio.run(copilot.self_check("x"))
