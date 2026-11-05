"""`rafiq acp`: Rafiq as an agent inside code editors, over the Agent Client Protocol.

Editors that speak ACP (Zed, JetBrains, and others) start this program and talk JSON-RPC to it,
one JSON message per line on stdin/stdout. Each editor session is a Rafiq chat on the editor's
folder, run by the Rafiq app that's already open (through its local API, like the `rafiq`
command): the reply streams into the editor, every tool call shows there with its result, and
a step that needs permission asks in the editor, under the same rules as in the app.

Standard library only, so the frozen agent runs it as `rafiq-agent cli acp` (the `rafiq acp`
shim). Zed, for example:

    "agent_servers": { "Rafiq": { "command": "<path to rafiq.cmd>", "args": ["acp"] } }

The model is the first one configured, or the one named in RAFIQ_MODEL.
"""

from __future__ import annotations

import contextlib
import itertools
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from typing import IO, Any

PROTOCOL_VERSION = 1
MAX_TOOL_TEXT = 4000

TOOL_KINDS = {
    "filesystem_read": "read",
    "filesystem_list": "read",
    "image_view": "read",
    "excel_read": "read",
    "filesystem_write": "edit",
    "filesystem_edit": "edit",
    "word_write": "edit",
    "slides_write": "edit",
    "excel_write": "edit",
    "filesystem_delete": "delete",
    "shell_run": "execute",
    "process_kill": "execute",
    "web_fetch": "fetch",
    "web_search": "fetch",
    "find_files": "search",
    "knowledge_search": "search",
}


def tool_kind(name: str) -> str:
    if name in TOOL_KINDS:
        return TOOL_KINDS[name]
    if name.startswith("browser_"):
        return "fetch"
    return "other"


def tool_title(name: str, args: dict[str, Any]) -> str:
    """What the editor shows for a call: the tool and its most telling argument."""
    for key in ("command", "path", "url", "query", "pattern"):
        if args.get(key):
            return f"{name}: {str(args[key])[:120]}"
    if args.get("script"):
        return f"{name}: {args.get('language') or 'python'} script"
    return name


def prompt_text(blocks: list[dict[str, Any]]) -> str:
    """ACP content blocks as one message: text as is, files the user attached as fenced text."""
    parts: list[str] = []
    for block in blocks or []:
        kind = block.get("type")
        if kind == "text":
            parts.append(str(block.get("text", "")))
        elif kind == "resource_link":
            parts.append(f"[{block.get('name') or block.get('uri')}]({block.get('uri')})")
        elif kind == "resource":
            resource = block.get("resource") or {}
            if "text" in resource:
                parts.append(f"{resource.get('uri', '')}\n```\n{resource['text']}\n```")
            else:
                parts.append(str(resource.get("uri", "")))
    return "\n\n".join(p for p in parts if p).strip()


# ── The Rafiq app, through its local API ───────────────────────────────────────────────


class AgentApi:
    """The running Rafiq app (its discovery file says where)."""

    def __init__(self, lang: str | None = None) -> None:
        from rafiq_agent.cli import DISCOVERY, data_dir

        self.lang = lang or os.environ.get("RAFIQ_LANG", "en")

        path = data_dir() / DISCOVERY
        try:
            info = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("Rafiq isn't running. Open the Rafiq app, then try again.") from exc
        self.base = f"http://127.0.0.1:{info['port']}"
        self.token = info["token"]

    def _request(self, method: str, path: str, body: Any = None, stream: bool = False) -> Any:
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept-Language": self.lang,
            },
        )
        try:
            response = urllib.request.urlopen(request, timeout=None if stream else 60)  # noqa: S310 - localhost only
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            with contextlib.suppress(ValueError):
                detail = json.loads(detail).get("detail", detail)
            raise RuntimeError(f"Rafiq answered {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Rafiq isn't reachable: {exc.reason}") from exc
        if stream:
            return response
        raw = response.read()
        return json.loads(raw) if raw else None

    def models(self) -> list[dict[str, Any]]:
        return [m for m in self._request("GET", "/models") if m.get("verify_ok") is not False]

    def model_id(self) -> str:
        models = self.models()
        if not models:
            raise RuntimeError("No working model in Rafiq. Add one in the app first.")
        wanted = (os.environ.get("RAFIQ_MODEL") or "").lower()
        for model in models:
            if wanted and wanted in (model["name"].lower(), model["model_id"].lower(), model["id"].lower()):
                return model["id"]
        return models[0]["id"]

    def create_chat(self, cwd: str | None, model_id: str) -> str:
        return self._request("POST", "/chats", {"model_id": model_id, "working_dir": cwd or None})["id"]

    def send(self, chat_id: str, text: str, model_id: str) -> Iterator[dict[str, Any]]:
        response = self._request(
            "POST", f"/chats/{chat_id}/messages", {"content": text, "model_id": model_id, "attachment_ids": []}, stream=True
        )
        for raw in response:
            line = raw.decode("utf-8", errors="replace").strip()
            if line.startswith("data:"):
                with contextlib.suppress(ValueError):
                    yield json.loads(line[5:])

    def resolve(self, chat_id: str, request_id: str, resolution: str) -> None:
        self._request("POST", f"/chats/{chat_id}/permissions/{request_id}?resolution={resolution}")

    def stop(self, chat_id: str) -> None:
        with contextlib.suppress(RuntimeError):
            self._request("POST", f"/chats/{chat_id}/stop")


# ── The protocol ───────────────────────────────────────────────────────────────────────


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


class Bridge:
    """One editor connection: JSON-RPC in, Rafiq chats behind it."""

    def __init__(self, out: IO[str], api_factory: Callable[[], Any] = AgentApi, version: str = "") -> None:
        self.out = out
        self.api_factory = api_factory
        self.api: Any = None
        self.version = version
        self.sessions: dict[str, dict[str, Any]] = {}
        self._write = threading.Lock()
        self._ids = itertools.count(1)
        self._waiting: dict[int, tuple[threading.Event, dict[str, Any]]] = {}

    # Writing ------------------------------------------------------------------------------

    def send(self, message: dict[str, Any]) -> None:
        with self._write:
            self.out.write(json.dumps({"jsonrpc": "2.0", **message}, ensure_ascii=False) + "\n")
            self.out.flush()

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"method": method, "params": params})

    def update(self, session_id: str, update: dict[str, Any]) -> None:
        self.notify("session/update", {"sessionId": session_id, "update": update})

    def ask(self, method: str, params: dict[str, Any], cancelled: threading.Event) -> dict[str, Any] | None:
        """A request to the editor; its result, or None when the turn is cancelled first."""
        request_id = next(self._ids) + 1_000_000  # never the same as the editor's own ids
        done, box = threading.Event(), {}
        self._waiting[request_id] = (done, box)
        self.send({"id": request_id, "method": method, "params": params})
        try:
            while not done.wait(0.2):
                if cancelled.is_set():
                    return None
            return box.get("result")
        finally:
            self._waiting.pop(request_id, None)

    # Reading ------------------------------------------------------------------------------

    def handle(self, message: dict[str, Any]) -> None:
        if "method" not in message:  # the editor answering one of our requests
            waiting = self._waiting.get(message.get("id"))  # type: ignore[arg-type]
            if waiting:
                waiting[1]["result"] = message.get("result")
                waiting[0].set()
            return
        method, params, msg_id = message["method"], message.get("params") or {}, message.get("id")
        handler = {
            "initialize": self.initialize,
            "authenticate": lambda _p: {},
            "session/new": self.new_session,
            "session/prompt": self.prompt,
            "session/cancel": self.cancel,
        }.get(method)
        if handler is None:
            if msg_id is not None:
                self.send({"id": msg_id, "error": {"code": -32601, "message": f"method not found: {method}"}})
            return
        if method == "session/prompt":
            # A reply takes a while and may ask the editor things: it runs beside the reader.
            threading.Thread(target=self._answer, args=(msg_id, handler, params), daemon=True).start()
        else:
            self._answer(msg_id, handler, params)

    def _answer(self, msg_id: Any, handler: Callable[[dict[str, Any]], Any], params: dict[str, Any]) -> None:
        try:
            result = handler(params)
        except RpcError as exc:
            if msg_id is not None:
                self.send({"id": msg_id, "error": {"code": exc.code, "message": str(exc)}})
            return
        except Exception as exc:  # noqa: BLE001 - the editor shows the message
            if msg_id is not None:
                self.send({"id": msg_id, "error": {"code": -32603, "message": str(exc)}})
            return
        if msg_id is not None:
            self.send({"id": msg_id, "result": result if result is not None else {}})

    # Methods ------------------------------------------------------------------------------

    def initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        version = params.get("protocolVersion")
        return {
            "protocolVersion": min(int(version), PROTOCOL_VERSION) if isinstance(version, int) else PROTOCOL_VERSION,
            "agentCapabilities": {
                "loadSession": False,
                "promptCapabilities": {"image": False, "audio": False, "embeddedContext": True},
            },
            "authMethods": [],
            "agentInfo": {"name": "rafiq", "title": "Rafiq", "version": self.version},
        }

    def _api(self) -> Any:
        if self.api is None:
            try:
                self.api = self.api_factory()
            except RuntimeError as exc:
                raise RpcError(-32603, str(exc)) from exc
        return self.api

    def new_session(self, params: dict[str, Any]) -> dict[str, Any]:
        api = self._api()
        model_id = api.model_id()
        chat_id = api.create_chat(params.get("cwd"), model_id)
        self.sessions[chat_id] = {"model_id": model_id, "cancelled": threading.Event()}
        return {"sessionId": chat_id}

    def cancel(self, params: dict[str, Any]) -> None:
        session = self.sessions.get(params.get("sessionId", ""))
        if session:
            session["cancelled"].set()
            self._api().stop(params["sessionId"])

    def prompt(self, params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("sessionId", "")
        session = self.sessions.get(session_id)
        if session is None:
            raise RpcError(-32602, f"unknown session: {session_id}")
        text = prompt_text(params.get("prompt") or [])
        if not text:
            return {"stopReason": "end_turn"}
        cancelled: threading.Event = session["cancelled"]
        cancelled.clear()
        api = self._api()
        for event in api.send(session_id, text, session["model_id"]):
            kind = event.get("type")
            if kind == "delta" and event.get("text"):
                self.update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": event["text"]}})
            elif kind == "reasoning" and event.get("text"):
                self.update(session_id, {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": event["text"]}})
            elif kind == "tool_call":
                name, args = event.get("tool", ""), event.get("args") or {}
                self.update(session_id, {
                    "sessionUpdate": "tool_call",
                    "toolCallId": event.get("id"),
                    "title": tool_title(name, args),
                    "kind": tool_kind(name),
                    "status": "in_progress",
                    "rawInput": args,
                })
            elif kind == "tool_result":
                self.update(session_id, {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": event.get("id"),
                    "status": "completed" if event.get("ok") else "failed",
                    "content": [{"type": "content", "content": {"type": "text", "text": str(event.get("output", ""))[:MAX_TOOL_TEXT]}}],
                })
            elif kind == "permission":
                self._permission(session_id, event, cancelled)
            elif kind == "error":
                message = event.get("message") or event.get("detail") or "error"
                self.update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"\n\n{message}"}})
            elif kind == "stopped":
                return {"stopReason": "cancelled"}
            elif kind == "done":
                break
        return {"stopReason": "cancelled" if cancelled.is_set() else "end_turn"}

    def _permission(self, session_id: str, event: dict[str, Any], cancelled: threading.Event) -> None:
        call = event.get("call") or {}
        name, args = call.get("tool", ""), call.get("args") or {}
        title = tool_title(name, args)
        if call.get("review"):
            title += f" — {call['review']}"
        result = self.ask(
            "session/request_permission",
            {
                "sessionId": session_id,
                "toolCall": {"toolCallId": event.get("id"), "title": title, "kind": tool_kind(name), "status": "pending", "rawInput": args},
                "options": [
                    {"optionId": "approved", "name": "Allow", "kind": "allow_once"},
                    {"optionId": "always", "name": "Always allow", "kind": "allow_always"},
                    {"optionId": "denied", "name": "Deny", "kind": "reject_once"},
                ],
            },
            cancelled,
        )
        outcome = (result or {}).get("outcome") or {}
        choice = outcome.get("optionId") if outcome.get("outcome") == "selected" else "denied"
        self._api().resolve(session_id, event.get("id", ""), choice if choice in ("approved", "always", "denied") else "denied")


def _version() -> str:
    from importlib import metadata

    try:
        return metadata.version("rafiq-agent")
    except metadata.PackageNotFoundError:
        return ""


def serve(stdin: IO[str], stdout: IO[str], api_factory: Callable[[], Any] = AgentApi) -> None:
    """Reads JSON-RPC lines until the editor closes the pipe."""
    bridge = Bridge(stdout, api_factory, _version())
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            bridge.send({"id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        if isinstance(message, dict):
            bridge.handle(message)


def main() -> None:
    # The editor reads our stdout as protocol only: anything else goes to stderr.
    stdin = open(sys.stdin.fileno(), encoding="utf-8", closefd=False) if sys.stdin else None  # noqa: SIM115
    stdout = open(sys.stdout.fileno(), "w", encoding="utf-8", newline="\n", closefd=False) if sys.stdout else None  # noqa: SIM115
    if stdin is None or stdout is None:
        sys.exit("rafiq acp needs to be started by an editor, with pipes for stdin and stdout")
    serve(stdin, stdout)
