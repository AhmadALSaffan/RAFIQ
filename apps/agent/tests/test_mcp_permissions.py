"""Permissions per MCP tool: a server can let its read-only tools run, ask before the rest,
and override any single tool — on top of the global "MCP" permission."""

from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport
from mcp.types import ToolAnnotations

from rafiq_agent import mcp_bridge
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.agent_runtime import policy_decision
from rafiq_agent.main import app
from rafiq_agent.mcp_bridge import is_read_only, resolve_mode
from rafiq_agent.storage.db import init_db

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}
GLOBAL_ASK = {"mcp": "ask"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _tool(name: str, read_only: bool | None = None, destructive: bool | None = None):
    hints = ToolAnnotations(readOnlyHint=read_only, destructiveHint=destructive) if read_only is not None else None
    return SimpleNamespace(name=name, title=None, description=f"{name} tool", input_schema={}, annotations=hints)


def test_only_tools_marked_read_only_count_as_reading():
    assert is_read_only(_tool("list", read_only=True))
    assert not is_read_only(_tool("write", read_only=False))
    assert not is_read_only(_tool("unknown"))  # no hints: it may change things
    assert not is_read_only(_tool("odd", read_only=True, destructive=True))
    # Older SDKs kept the protocol's camelCase attribute names.
    assert is_read_only(SimpleNamespace(annotations=SimpleNamespace(readOnlyHint=True)))


def test_a_tool_mode_beats_the_read_and_write_modes():
    perms = {"read": "auto", "write": "ask", "tools": {"delete_file": "deny", "list_files": "ask"}}
    assert resolve_mode(perms, "search", read_only=True) == "auto"
    assert resolve_mode(perms, "create_file", read_only=False) == "ask"
    assert resolve_mode(perms, "delete_file", read_only=False) == "deny"
    assert resolve_mode(perms, "list_files", read_only=True) == "ask"
    # Nothing set, or nonsense: the global setting decides.
    assert resolve_mode(None, "search", read_only=True) is None
    assert resolve_mode({"read": "sometimes", "tools": {"x": "maybe"}}, "x", read_only=True) is None


async def test_the_decision_follows_the_server_then_the_global_setting():
    config = mcp_bridge._Config(
        "srv1", "Files", "stdio", "npx", [], None,
        permissions={"read": "auto", "tools": {"remove": "deny"}},
    )
    conn = mcp_bridge.Connection(config)
    conn.session = object()  # connected
    conn.tools = [_tool("read_file", read_only=True), _tool("write_file", read_only=False), _tool("remove", read_only=False)]

    manager = mcp_bridge.McpManager()
    manager.connections["srv1"] = conn

    async def enabled():
        return [config]

    manager._enabled = enabled
    names = {t.remote_name: t.name for t in await manager.tools(budget=0)}

    assert policy_decision(names["read_file"], "exec", GLOBAL_ASK) == "allow"
    assert policy_decision(names["write_file"], "exec", GLOBAL_ASK) == "ask"  # unset: global
    assert policy_decision(names["write_file"], "exec", {"mcp": "auto"}) == "allow"
    assert policy_decision(names["remove"], "exec", {"mcp": "auto"}) == "deny"


async def test_permissions_are_saved_reported_and_checked(client):
    body = {"name": "perm-test", "transport": "stdio", "command": "npx", "args": [], "env": {}, "headers": {}, "enabled": False}
    server = (await client.post("/mcp", json=body, headers=AUTH)).json()
    try:
        assert server["permissions"] == {"read": None, "write": None, "tools": {}}

        r = await client.put(
            f"/mcp/{server['id']}/permissions",
            json={"read": "auto", "write": "ask", "tools": {"delete_file": "deny"}},
            headers=AUTH,
        )
        assert r.status_code == 200, r.text
        assert r.json()["permissions"] == {"read": "auto", "write": "ask", "tools": {"delete_file": "deny"}}

        listed = {s["id"]: s for s in (await client.get("/mcp", headers=AUTH)).json()}
        assert listed[server["id"]]["permissions"]["tools"] == {"delete_file": "deny"}

        # Editing the server keeps what its tools may do.
        await client.put(f"/mcp/{server['id']}", json={**body, "name": "perm-test-2"}, headers=AUTH)
        listed = {s["id"]: s for s in (await client.get("/mcp", headers=AUTH)).json()}
        assert listed[server["id"]]["permissions"]["read"] == "auto"

        bad = await client.put(f"/mcp/{server['id']}/permissions", json={"read": "always"}, headers=AUTH)
        assert bad.status_code == 422
        assert (await client.put("/mcp/nope/permissions", json={}, headers=AUTH)).status_code == 404
    finally:
        await client.delete(f"/mcp/{server['id']}", headers=AUTH)
