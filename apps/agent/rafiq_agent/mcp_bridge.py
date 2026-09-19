"""MCP servers as agent tools.

Each enabled server gets one long-lived connection (a child process over stdio, or a
Streamable HTTP endpoint), started on first use and kept for the life of the app. Its tools
join every chat and task as `mcp__<server>__<tool>`, behind the "MCP" permission — the
server is software the user chose to run, but what the model does with it is still theirs
to approve.
"""

import asyncio
import contextlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select

from rafiq_agent.config import DATA_DIR
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import McpServer
from rafiq_agent.storage.secrets import delete_named_secret, get_named_secret, set_named_secret
from rafiq_agent.tools.base import Tool, ToolRegistry, ToolResult

CONNECT_TIMEOUT = 30
# A local server's first run downloads it (`npx -y firebase-tools@latest` pulls ~100MB),
# so stdio gets a much longer first breath than an HTTP endpoint that is either there or not.
STDIO_CONNECT_TIMEOUT = 120
# A server that just failed isn't retried for this long, so it can't slow every message down.
RETRY_AFTER = 120
CALL_TIMEOUT = 300
MAX_OUTPUT = 20_000
LOGS = DATA_DIR / "logs"


def secret_name(server_id: str) -> str:
    return f"mcp:{server_id}"


def load_secrets(server_id: str) -> dict[str, dict[str, str]]:
    raw = get_named_secret(secret_name(server_id))
    with contextlib.suppress(ValueError, TypeError):
        data = json.loads(raw or "{}")
        return {"env": dict(data.get("env") or {}), "headers": dict(data.get("headers") or {})}
    return {"env": {}, "headers": {}}


def save_secrets(server_id: str, env: dict[str, str], headers: dict[str, str]) -> list[str]:
    if env or headers:
        set_named_secret(secret_name(server_id), json.dumps({"env": env, "headers": headers}))
    else:
        with contextlib.suppress(Exception):
            delete_named_secret(secret_name(server_id))
    return sorted(env) + sorted(headers)


def slug(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_").lower()[:24] or "server"


@dataclass
class _Config:
    id: str
    name: str
    transport: str
    command: str | None
    args: list[str]
    url: str | None
    auth: str = "none"
    preset: str | None = None


# On Windows these are .cmd shims, not real executables. Handing one straight to
# CreateProcess starts something whose stdio never reaches the node process behind it, so
# the session hangs on initialize with no error at all (python-sdk #359, #395, #552, #1452).
WINDOWS_SHIMS = {"npx", "npm", "pnpm", "yarn", "bun", "bunx", "deno"}


def _launch(command: str, args: list[str]) -> tuple[str, list[str]]:
    """The command as the OS can actually start it."""
    if sys.platform == "win32" and Path(command).stem.lower() in WINDOWS_SHIMS:
        return "cmd", ["/c", command, *args]
    return command, args


async def _probe_status(url: str, headers: dict[str, str]) -> int | None:
    """One plain initialize request, to learn the HTTP status the SDK swallowed."""
    import httpx

    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "rafiq", "version": "probe"}},
    }
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.post(
                url,
                json=body,
                headers={**headers, "Accept": "application/json, text/event-stream", "Content-Type": "application/json"},
            )
            return response.status_code
    except Exception:  # noqa: BLE001 - the probe is best effort
        return None


def _normalized_headers(headers: dict[str, str]) -> dict[str, str]:
    """A bare token pasted into Authorization becomes a Bearer token — the form most
    remote servers (GitHub included) expect."""
    out = dict(headers)
    for key, value in headers.items():
        if key.lower() == "authorization" and value and " " not in value.strip():
            out[key] = f"Bearer {value.strip()}"
    return out


@dataclass
class Connection:
    config: _Config
    session: Any = None
    tools: list[Any] = field(default_factory=list)
    error: str | None = None
    failed_at: float = 0.0
    _task: asyncio.Task | None = None
    _ready: asyncio.Event = field(default_factory=asyncio.Event)
    _stop: asyncio.Event = field(default_factory=asyncio.Event)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def connected(self) -> bool:
        return self.session is not None

    async def start(self) -> None:
        async with self._lock:
            if self.connected:
                return
            self._ready, self._stop, self.error = asyncio.Event(), asyncio.Event(), None
            self._task = asyncio.create_task(self._run())
            budget = STDIO_CONNECT_TIMEOUT if self.config.transport == "stdio" else CONNECT_TIMEOUT
            try:
                await asyncio.wait_for(self._ready.wait(), budget)
            except TimeoutError:
                from rafiq_agent.i18n import tr

                self.error = (
                    tr("الخادم ما رد خلال وقت كافي. أول تشغيل ممكن ياخد وقت لأنه بينزّل الخادم — جرّب مرة تانية.")
                    if self.config.transport == "stdio"
                    else tr("الخادم ما رد خلال وقت كافي.")
                )
                await self.stop()
            if self.error:
                self.failed_at = asyncio.get_running_loop().time()
                raise RuntimeError(self.error)

    async def _run(self) -> None:
        from mcp import ClientSession

        errlog = None
        try:
            async with contextlib.AsyncExitStack() as stack:
                secrets = load_secrets(self.config.id)
                if self.config.transport == "http":
                    from mcp.client.streamable_http import streamable_http_client
                    from mcp.shared._httpx_utils import create_mcp_http_client

                    auth = None
                    if self.config.auth == "oauth":
                        from rafiq_agent import mcp_oauth

                        auth = mcp_oauth.provider(self.config.id, self.config.url or "", self.config.preset)
                    client = create_mcp_http_client(headers=_normalized_headers(secrets["headers"]) or None, auth=auth)
                    await stack.enter_async_context(client)
                    streams = await stack.enter_async_context(
                        streamable_http_client(self.config.url or "", http_client=client)
                    )
                else:
                    from mcp import StdioServerParameters
                    from mcp.client.stdio import stdio_client

                    LOGS.mkdir(parents=True, exist_ok=True)
                    errlog = open(LOGS / f"mcp-{slug(self.config.name)}.log", "a", encoding="utf-8")  # noqa: SIM115
                    command, args = _launch(self.config.command or "", list(self.config.args))
                    params = StdioServerParameters(
                        command=command,
                        args=args,
                        env=secrets["env"] or None,
                        encoding_error_handler="replace",
                    )
                    streams = await stack.enter_async_context(stdio_client(params, errlog=errlog))
                session = await stack.enter_async_context(ClientSession(streams[0], streams[1]))
                await session.initialize()
                tools, cursor = [], None
                while True:
                    from mcp.types import PaginatedRequestParams

                    listing = await session.list_tools(params=PaginatedRequestParams(cursor=cursor) if cursor else None)
                    tools += listing.tools
                    cursor = listing.next_cursor
                    if not cursor:
                        break
                self.tools, self.session = tools, session
                self._ready.set()
                await self._stop.wait()
        except BaseException as exc:  # noqa: BLE001 - reported to the user as the server's status
            from rafiq_agent.mcp_oauth import GENERIC_HTTP_ERRORS, describe_error, describe_status

            # start() may have already explained this (a timeout cancels the task, and
            # "CancelledError" would say nothing) — the first explanation is the true one.
            if self.error is None:
                self.error = describe_error(exc)
            if isinstance(exc, asyncio.CancelledError):
                raise
            if self.config.transport == "http" and self.config.auth != "oauth" and any(g in self.error for g in GENERIC_HTTP_ERRORS):
                status = await _probe_status(self.config.url or "", _normalized_headers(load_secrets(self.config.id)["headers"]))
                if status is not None and (explained := describe_status(status)):
                    self.error = explained
        finally:
            self.session = None
            self._ready.set()
            if errlog is not None:
                errlog.close()
            if self.config.auth == "oauth":
                from rafiq_agent import mcp_oauth

                mcp_oauth.end(self.config.id)

    async def call(self, name: str, arguments: dict[str, Any]) -> Any:
        if not self.connected:
            await self.start()
        return await self.session.call_tool(name, arguments, read_timeout_seconds=CALL_TIMEOUT)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._task, 10)
            self._task = None
        self.session = None


class McpManager:
    def __init__(self) -> None:
        self.connections: dict[str, Connection] = {}

    async def _enabled(self) -> list[_Config]:
        async with SessionLocal() as session:
            rows = (await session.execute(select(McpServer).where(McpServer.enabled.is_(True)))).scalars().all()
        return [
            _Config(r.id, r.name, r.transport, r.command, list(r.args or []), r.url, r.auth or "none", r.preset)
            for r in rows
        ]

    def status(self, server_id: str) -> dict[str, Any]:
        conn = self.connections.get(server_id)
        if conn is None:
            return {"connected": False, "tools": [], "error": None}
        return {"connected": conn.connected, "tools": [t.name for t in conn.tools], "error": conn.error}

    async def connect(self, server: McpServer) -> Connection:
        config = _Config(
            server.id, server.name, server.transport, server.command, list(server.args or []), server.url,
            server.auth or "none", server.preset,
        )
        await self.disconnect(server.id)
        conn = Connection(config)
        self.connections[server.id] = conn
        await conn.start()
        return conn

    def begin(self, server: McpServer) -> Connection:
        """Like connect(), but returns at once: the connection keeps going in the background
        (an OAuth server is waiting for the user's browser)."""
        config = _Config(
            server.id, server.name, server.transport, server.command, list(server.args or []), server.url,
            server.auth or "none", server.preset,
        )
        conn = Connection(config)
        self.connections[server.id] = conn
        conn._ready, conn._stop, conn.error = asyncio.Event(), asyncio.Event(), None
        conn._task = asyncio.create_task(conn._run())
        return conn

    async def disconnect(self, server_id: str) -> None:
        conn = self.connections.pop(server_id, None)
        if conn is not None:
            await conn.stop()

    async def tools(self) -> list["McpTool"]:
        """Tools of every enabled server, connecting the ones not up yet (in parallel)."""
        configs = await self._enabled()
        for config in configs:
            if config.id not in self.connections:
                self.connections[config.id] = Connection(config)

        now = asyncio.get_running_loop().time()

        async def ensure(conn: Connection) -> None:
            if conn.connected or (conn.failed_at and now - conn.failed_at < RETRY_AFTER):
                return
            with contextlib.suppress(Exception):
                await conn.start()

        await asyncio.gather(*(ensure(self.connections[c.id]) for c in configs))
        out: list[McpTool] = []
        for config in configs:
            conn = self.connections[config.id]
            for tool in conn.tools if conn.connected else []:
                out.append(McpTool(conn, tool))
        return out

    async def shutdown(self) -> None:
        for server_id in list(self.connections):
            await self.disconnect(server_id)


MANAGER = McpManager()


def _schema(raw: Any) -> dict[str, Any]:
    schema = dict(raw or {})
    schema.setdefault("type", "object")
    schema.setdefault("properties", {})
    return schema


class McpTool(Tool):
    category = "exec"

    def __init__(self, conn: Connection, tool: Any) -> None:
        self.conn = conn
        self.remote_name = tool.name
        self.name = f"mcp__{slug(conn.config.name)}__{re.sub(r'[^a-zA-Z0-9_-]', '_', tool.name)}"[:64]
        title = getattr(tool, "title", None) or tool.name
        self.description = f"[MCP · {conn.config.name}] {title}: {tool.description or ''}".strip()[:1024]
        self.parameters = _schema(tool.input_schema)

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            result = await self.conn.call(self.remote_name, args)
        except Exception as exc:  # noqa: BLE001 - a server failure is the tool's answer
            return ToolResult(ok=False, output=f"خادم MCP «{self.conn.config.name}»: {exc}")
        texts, images = [], []
        for item in result.content or []:
            kind = getattr(item, "type", "")
            if kind == "text":
                texts.append(item.text)
            elif kind == "image":
                images.append(f"data:{item.mime_type};base64,{item.data}")
            elif kind == "resource":
                resource = item.resource
                texts.append(getattr(resource, "text", None) or f"[resource {getattr(resource, 'uri', '')}]")
            else:
                texts.append(json.dumps(item.model_dump(mode="json"), ensure_ascii=False)[:2000])
        if not texts and result.structured_content:
            texts.append(json.dumps(result.structured_content, ensure_ascii=False))
        output = "\n".join(texts) or "(ما رجع شي)"
        if len(output) > MAX_OUTPUT:
            output = output[:MAX_OUTPUT] + "\n… (مقطوع)"
        return ToolResult(ok=not result.is_error, output=output, images=images or None)


async def register_mcp_tools(registry: ToolRegistry) -> None:
    with contextlib.suppress(Exception):
        for tool in await MANAGER.tools():
            registry.register(tool)
