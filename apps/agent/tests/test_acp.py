"""Rafiq inside code editors (acp.py): the JSON-RPC conversation an ACP editor has with it."""

import io
import json
import queue
import threading

from rafiq_agent import acp


class FakeApi:
    """The Rafiq app behind the bridge: one scripted reply per message."""

    def __init__(self, events):
        self.events = events
        self.chats: list[tuple[str | None, str]] = []
        self.sent: list[str] = []
        self.resolved: list[tuple[str, str, str]] = []
        self.stopped: list[str] = []

    def model_id(self):
        return "m1"

    def create_chat(self, cwd, model_id):
        self.chats.append((cwd, model_id))
        return "chat-1"

    def send(self, chat_id, text, model_id):
        self.sent.append(text)
        yield from self.events(self)

    def resolve(self, chat_id, request_id, resolution):
        self.resolved.append((chat_id, request_id, resolution))

    def stop(self, chat_id):
        self.stopped.append(chat_id)


class Editor:
    """Plays the editor: sends lines, reads what Rafiq writes back."""

    def __init__(self, api):
        self.inbox: queue.Queue = queue.Queue()
        self.lines: list[dict] = []
        out = self

        class Out(io.StringIO):
            def write(self, text):
                for line in text.splitlines():
                    if line.strip():
                        message = json.loads(line)
                        out.lines.append(message)
                        out.inbox.put(message)
                return len(text)

        self.bridge = acp.Bridge(Out(), lambda: api, "test")

    def request(self, msg_id, method, params):
        self.bridge.handle({"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params})

    def wait_for(self, predicate, timeout=5):
        while True:
            message = self.inbox.get(timeout=timeout)
            if predicate(message):
                return message


def test_initialize_and_new_session_on_the_editor_folder():
    api = FakeApi(lambda _a: iter([{"type": "done"}]))
    editor = Editor(api)
    editor.request(1, "initialize", {"protocolVersion": 1, "clientCapabilities": {}})
    init = editor.wait_for(lambda m: m.get("id") == 1)["result"]
    assert init["protocolVersion"] == 1 and init["agentCapabilities"]["loadSession"] is False
    editor.request(2, "session/new", {"cwd": "C:/code/project", "mcpServers": []})
    assert editor.wait_for(lambda m: m.get("id") == 2)["result"] == {"sessionId": "chat-1"}
    assert api.chats == [("C:/code/project", "m1")]


def test_a_reply_streams_with_its_tool_calls():
    def reply(_api):
        yield {"type": "start"}
        yield {"type": "reasoning", "text": "thinking"}
        yield {"type": "delta", "text": "Running the tests. "}
        yield {"type": "tool_call", "id": "t1", "tool": "shell_run", "args": {"command": "pnpm test"}}
        yield {"type": "tool_result", "id": "t1", "ok": True, "output": "12 passed"}
        yield {"type": "delta", "text": "All green."}
        yield {"type": "done"}

    api = FakeApi(reply)
    editor = Editor(api)
    editor.request(1, "session/new", {"cwd": "/p"})
    editor.wait_for(lambda m: m.get("id") == 1)
    editor.request(2, "session/prompt", {"sessionId": "chat-1", "prompt": [
        {"type": "text", "text": "run the tests"},
        {"type": "resource", "resource": {"uri": "file:///p/a.py", "text": "print(1)"}},
    ]})
    result = editor.wait_for(lambda m: m.get("id") == 2)["result"]
    assert result == {"stopReason": "end_turn"}
    assert "run the tests" in api.sent[0] and "print(1)" in api.sent[0]
    updates = [m["params"]["update"] for m in editor.lines if m.get("method") == "session/update"]
    kinds = [u["sessionUpdate"] for u in updates]
    assert kinds == ["agent_thought_chunk", "agent_message_chunk", "tool_call", "tool_call_update", "agent_message_chunk"]
    call = updates[2]
    assert call["kind"] == "execute" and "pnpm test" in call["title"] and call["status"] == "in_progress"
    assert updates[3]["status"] == "completed" and "12 passed" in updates[3]["content"][0]["content"]["text"]


def run_with_permission(answer):
    def reply(_api):
        yield {"type": "permission", "id": "req-9", "call": {"tool": "filesystem_write", "args": {"path": "a.txt"}, "review": "edits a file you named"}}
        yield {"type": "done"}

    api = FakeApi(reply)
    editor = Editor(api)
    editor.request(1, "session/new", {"cwd": "/p"})
    editor.wait_for(lambda m: m.get("id") == 1)
    editor.request(2, "session/prompt", {"sessionId": "chat-1", "prompt": [{"type": "text", "text": "write a.txt"}]})
    asked = editor.wait_for(lambda m: m.get("method") == "session/request_permission")
    assert asked["params"]["toolCall"]["kind"] == "edit"
    assert "edits a file you named" in asked["params"]["toolCall"]["title"]
    assert {o["kind"] for o in asked["params"]["options"]} == {"allow_once", "allow_always", "reject_once"}
    editor.bridge.handle({"jsonrpc": "2.0", "id": asked["id"], "result": answer})
    editor.wait_for(lambda m: m.get("id") == 2)
    return api


def test_permission_is_asked_in_the_editor_and_passed_back():
    api = run_with_permission({"outcome": {"outcome": "selected", "optionId": "approved"}})
    assert api.resolved == [("chat-1", "req-9", "approved")]


def test_a_cancelled_permission_is_a_deny():
    api = run_with_permission({"outcome": {"outcome": "cancelled"}})
    assert api.resolved == [("chat-1", "req-9", "denied")]


def test_cancel_stops_the_reply():
    gate = threading.Event()

    def reply(_api):
        yield {"type": "delta", "text": "working"}
        gate.wait(5)
        yield {"type": "stopped"}

    api = FakeApi(reply)
    editor = Editor(api)
    editor.request(1, "session/new", {"cwd": "/p"})
    editor.wait_for(lambda m: m.get("id") == 1)
    editor.request(2, "session/prompt", {"sessionId": "chat-1", "prompt": [{"type": "text", "text": "go"}]})
    editor.wait_for(lambda m: m.get("method") == "session/update")
    editor.bridge.handle({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": "chat-1"}})
    gate.set()
    assert editor.wait_for(lambda m: m.get("id") == 2)["result"] == {"stopReason": "cancelled"}
    assert api.stopped == ["chat-1"]


def test_unknown_methods_and_rafiq_not_running_are_errors():
    editor = Editor(None)
    editor.request(1, "session/load", {})
    assert editor.wait_for(lambda m: m.get("id") == 1)["error"]["code"] == -32601

    def closed():
        raise RuntimeError("Rafiq isn't running. Open the Rafiq app, then try again.")

    editor.bridge.api_factory = closed
    editor.request(2, "session/new", {"cwd": "/p"})
    error = editor.wait_for(lambda m: m.get("id") == 2)["error"]
    assert "isn't running" in error["message"]


def test_serve_reads_lines_until_the_pipe_closes():
    out = io.StringIO()
    acp.serve(io.StringIO('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}\nnot json\n'), out, lambda: None)
    lines = [json.loads(line) for line in out.getvalue().splitlines()]
    assert lines[0]["result"]["protocolVersion"] == 1
    assert lines[1]["error"]["code"] == -32700
