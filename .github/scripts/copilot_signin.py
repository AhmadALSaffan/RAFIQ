"""GitHub Copilot on a real Mac, through the frozen agent, the way the app does it.

Starts the agent, begins Copilot's device sign-in and prints the code for a person to enter at
github.com/login/device, waits for it, lists the account's models, saves one as an agent (which
makes it answer once), asks it a question in a chat, then signs out, which revokes the token
and deletes it from the keychain. No token is ever printed: the agent keeps it.

Usage: python3 copilot_signin.py <path to the frozen rafiq-agent>
"""

import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PORT = 8766
BASE = f"http://127.0.0.1:{PORT}"
TOKEN = secrets.token_urlsafe(32)


def call(method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept-Language", "en")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")


def summary(line):
    print(line, flush=True)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n\n")


def ask(chat_id, model_id, text):
    req = urllib.request.Request(
        f"{BASE}/chats/{chat_id}/messages",
        data=json.dumps({"content": text, "model_id": model_id, "no_route": True}).encode(),
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    reply, error = [], None
    with urllib.request.urlopen(req, timeout=300) as resp:
        for raw in resp:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            event = json.loads(line[5:])
            kind = event.get("type")
            if kind == "delta":
                reply.append(event["text"])
            elif kind == "error":
                error = event.get("message")
            elif kind in ("done", "stopped"):
                break
    return "".join(reply).strip(), error


def main():
    agent = sys.argv[1]
    print("::add-mask::" + TOKEN)
    data = tempfile.mkdtemp(prefix="rafiq-copilot-")
    env = {**os.environ, "RAFIQ_TOKEN": TOKEN, "RAFIQ_DATA_DIR": data, "RAFIQ_KEYRING_SERVICE": "rafiq-copilot-check"}
    proc = subprocess.Popen([agent, "--port", str(PORT)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    account_id = None
    try:
        for _ in range(120):
            try:
                if call("GET", "/health", timeout=5)[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise SystemExit("the agent didn't start")

        status, providers = call("GET", "/accounts/providers")
        copilot = next(p for p in providers if p["id"] == "github_copilot")
        if not copilot["available"]:
            raise SystemExit(f"Copilot isn't available: {copilot['unavailable_reason']}")

        status, flow = call("POST", "/accounts/github_copilot/connect")
        if status != 200:
            raise SystemExit(f"sign-in didn't start: {status} {flow}")
        summary(f"## Enter **{flow['user_code']}** at {flow['verification_uri']} (within {flow['expires_in'] // 60} minutes)")

        deadline = time.monotonic() + flow["expires_in"]
        while True:
            time.sleep(max(flow["interval"], 5))
            status, poll = call("POST", f"/accounts/connect/{flow['flow_id']}/poll", timeout=55)  # a Mac web view drops a request after a minute
            if status != 200:
                raise SystemExit(f"poll failed: {status} {poll}")
            if poll["status"] == "pending":
                if time.monotonic() > deadline:
                    raise SystemExit("nobody entered the code in time")
                continue
            if poll["status"] != "complete":
                raise SystemExit(f"sign-in ended: {poll['status']} {poll.get('message')}")
            account_id = poll["account"]["id"]
            summary(f"Signed in as **{poll['account']['label']}**" + (f" ({poll['message']})" if poll.get("message") else ""))
            if poll.get("kind") == "copilot_not_enabled":
                raise SystemExit("the account has no Copilot")
            break

        status, models = call("POST", "/models/discover", {"provider": "github_copilot", "account_id": account_id}, timeout=300)
        if status != 200 or not models:
            raise SystemExit(f"no models: {status} {models}")
        summary("Models: " + ", ".join(m["id"] for m in models))
        ids = [m["id"] for m in models]
        model = next((m for m in ("gpt-4.1", "gpt-5-mini", "gpt-4o") if m in ids), ids[0])

        status, saved = call(
            "POST",
            "/models",
            {"name": "Copilot check", "provider": "github_copilot", "model_id": model, "auth_method": "oauth", "account_id": account_id},
            timeout=300,
        )
        if status != 201:
            raise SystemExit(f"the agent wasn't saved: {status} {saved}")
        summary(f"Agent **{model}** saved (it answered the check)")

        status, chat = call("POST", "/chats", {"model_id": saved["id"]})
        reply, error = ask(chat["id"], saved["id"], "Reply with one word in Arabic: hello.")
        summary(f"Reply in a chat: **{reply or '(empty)'}**" + (f" — error: {error}" if error else ""))
        if not reply:
            raise SystemExit("no reply")
        summary("### Copilot works on this Mac")
    finally:
        if account_id:
            status, _ = call("DELETE", f"/accounts/{account_id}")
            print(f"signed out (revoked and deleted): {status}", flush=True)
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
