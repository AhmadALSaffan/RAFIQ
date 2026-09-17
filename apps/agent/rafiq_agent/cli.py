"""`rafiq` — the app from a terminal.

Talks to the running agent over its local API. The agent leaves a discovery file
(`<data dir>/agent.json`, with its port and the per-launch token) while it runs; nothing
else is needed. Standard library only, so the frozen build can run it as
`rafiq-agent.exe cli …` and the `rafiq.cmd` shim next to it makes that `rafiq …`.

    rafiq status
    rafiq models
    rafiq tasks [--all]
    rafiq task "prompt" [--title …] [--model NAME] [--dir FOLDER] [--mode auto|plan|step] [--wait]
    rafiq task-show ID
    rafiq chat "message" [--model NAME]
    rafiq memories
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DISCOVERY = "agent.json"


def data_dir() -> Path:
    base = os.environ.get("RAFIQ_DATA_DIR")
    if base:
        return Path(base)
    appdata = os.environ.get("APPDATA")
    return Path(appdata) / "Rafiq" if appdata else Path.home() / ".rafiq"


class Client:
    def __init__(self) -> None:
        path = data_dir() / DISCOVERY
        try:
            info = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            sys.exit(f"Rafiq isn't running (no {path}). Open the app first.")
        self.base = f"http://127.0.0.1:{info['port']}"
        self.token = info["token"]

    def call(self, method: str, path: str, body: Any = None, stream: bool = False) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept-Language": os.environ.get("RAFIQ_LANG", "ar"),
            },
        )
        try:
            response = urllib.request.urlopen(request, timeout=None if stream else 30)  # noqa: S310 - localhost only
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            with contextlib.suppress(ValueError):
                detail = json.loads(detail).get("detail", detail)
            sys.exit(f"error {exc.code}: {detail}")
        except urllib.error.URLError as exc:
            sys.exit(f"Rafiq isn't reachable at {self.base}: {exc.reason}")
        if stream:
            return response
        raw = response.read()
        return json.loads(raw) if raw else None


def _model_id(client: Client, name: str | None) -> str:
    models = client.call("GET", "/models")
    if not models:
        sys.exit("No models configured. Add one in the app first.")
    if not name:
        return models[0]["id"]
    for model in models:
        if name.lower() in (model["name"].lower(), model["model_id"].lower(), model["id"].lower()):
            return model["id"]
    sys.exit(f"No model named {name!r}. Known: " + ", ".join(m["name"] for m in models))


def cmd_status(client: Client, _: argparse.Namespace) -> None:
    info = client.call("GET", "/diagnostics")
    print(f"Rafiq {info.get('version', '?')} at {client.base}")
    tasks = client.call("GET", "/tasks")
    running = sum(1 for t in tasks if t["status"] == "running")
    waiting = sum(1 for t in tasks if t["status"] in ("queued", "pending", "planned"))
    print(f"tasks: {running} running, {waiting} waiting, {len(tasks)} total")


def cmd_models(client: Client, _: argparse.Namespace) -> None:
    for model in client.call("GET", "/models"):
        state = "✓" if model.get("verify_ok") else ("✗" if model.get("verify_ok") is False else "?")
        print(f"{state} {model['name']:<28} {model['provider']:<16} {model['model_id']}")


def cmd_tasks(client: Client, args: argparse.Namespace) -> None:
    tasks = client.call("GET", "/tasks")
    if not args.all:
        tasks = [t for t in tasks if t["status"] in ("queued", "pending", "running", "planned")] or tasks[:10]
    for task in tasks:
        print(f"{task['id']}  {task['status']:<10} {task['title']}")


def _wait(client: Client, task_id: str) -> dict[str, Any]:
    seen = 0
    while True:
        task = client.call("GET", f"/tasks/{task_id}")
        for event in task["events"][seen:]:
            _print_event(event)
        seen = len(task["events"])
        if task["status"] in ("completed", "failed", "cancelled", "planned"):
            return task
        time.sleep(1.5)


def _print_event(event: dict[str, Any]) -> None:
    kind, payload = event["type"], event["payload"]
    if kind == "message":
        print(payload.get("text", ""))
    elif kind == "tool_call":
        call = payload.get("call", {})
        print(f"  ▸ {call.get('tool')} {json.dumps(call.get('args', {}), ensure_ascii=False)[:160]}")
    elif kind == "tool_result":
        mark = "✓" if payload.get("ok") else "✗"
        print(f"  {mark} {payload.get('tool')}: {str(payload.get('output', ''))[:200].strip()}")
    elif kind == "permission_request":
        if payload.get("resolution") == "pending":
            print("  ⏸ waiting for approval in the app")
    elif kind == "plan":
        print(payload.get("text", ""))
    elif kind == "error":
        print(f"  ! {payload.get('message')}")


def cmd_task(client: Client, args: argparse.Namespace) -> None:
    body = {
        "title": args.title or "",
        "prompt": args.prompt,
        "model_id": _model_id(client, args.model),
        "working_dir": str(Path(args.dir).resolve()) if args.dir else None,
        "mode": args.mode,
    }
    task = client.call("POST", "/tasks", body)
    print(f"created {task['id']}  {task['title']}")
    if args.wait:
        final = _wait(client, task["id"])
        print(f"→ {final['status']}")
        if final["status"] == "planned":
            print("The plan is waiting for your approval in the app (or: rafiq approve ID).")


def cmd_task_show(client: Client, args: argparse.Namespace) -> None:
    task = client.call("GET", f"/tasks/{args.id}")
    print(f"{task['title']}  [{task['status']}]\n{task['prompt']}\n")
    for event in task["events"]:
        _print_event(event)


def cmd_approve(client: Client, args: argparse.Namespace) -> None:
    task = client.call("POST", f"/tasks/{args.id}/plan/approve", {})
    print(f"→ {task['status']}")


def cmd_chat(client: Client, args: argparse.Namespace) -> None:
    model_id = _model_id(client, args.model)
    chat = client.call("POST", "/chats", {"model_id": model_id})
    response = client.call(
        "POST", f"/chats/{chat['id']}/messages", {"content": args.message, "model_id": model_id, "attachment_ids": []}, stream=True
    )
    for raw in response:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[5:])
        except ValueError:
            continue
        kind = event.get("type")
        if kind == "delta":
            print(event.get("text", ""), end="", flush=True)
        elif kind == "tool_call":
            print(f"\n  ▸ {event.get('tool')}", flush=True)
        elif kind == "error":
            print(f"\n! {event.get('message')}")
        elif kind in ("done", "stopped"):
            print()
            break


def cmd_memories(client: Client, _: argparse.Namespace) -> None:
    for memory in client.call("GET", "/memories"):
        state = " " if memory.get("enabled", True) else "·"
        print(f"{state} {memory['id']}  {memory['text']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rafiq", description="Rafiq from the terminal")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="is the agent running, and what is it doing").set_defaults(fn=cmd_status)
    sub.add_parser("models", help="the configured models").set_defaults(fn=cmd_models)
    tasks = sub.add_parser("tasks", help="list tasks")
    tasks.add_argument("--all", action="store_true")
    tasks.set_defaults(fn=cmd_tasks)
    task = sub.add_parser("task", help="create a task")
    task.add_argument("prompt")
    task.add_argument("--title")
    task.add_argument("--model")
    task.add_argument("--dir", help="folder the task works in (default: none)")
    task.add_argument("--mode", choices=["auto", "plan", "step"], default="auto")
    task.add_argument("--wait", action="store_true", help="follow the task until it finishes")
    task.set_defaults(fn=cmd_task)
    show = sub.add_parser("task-show", help="a task's transcript")
    show.add_argument("id")
    show.set_defaults(fn=cmd_task_show)
    approve = sub.add_parser("approve", help="approve a planned task")
    approve.add_argument("id")
    approve.set_defaults(fn=cmd_approve)
    chat = sub.add_parser("chat", help="one message in a new chat")
    chat.add_argument("message")
    chat.add_argument("--model")
    chat.set_defaults(fn=cmd_chat)
    sub.add_parser("memories", help="what Rafiq remembers").set_defaults(fn=cmd_memories)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.fn(Client(), args)


if __name__ == "__main__":
    main()
