"""The logs viewer: the tail of the right file, and never a secret on the way out."""

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import logs
from rafiq_agent.main import app
from rafiq_agent.storage.db import init_db

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def client():
    await init_db()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── Scrubbing ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("line", "leaked"),
    [
        ("Authorization: Bearer abcdef1234567890xyz", "abcdef1234567890xyz"),
        ('headers={"Authorization": "ghp_abcdefghijklmnop1234"}', "ghp_abcdefghijklmnop1234"),
        ("OPENAI_API_KEY=sk-proj-abcdefghijklmnop123456", "abcdefghijklmnop123456"),
        ("client_secret: s3cr3t-value-here", "s3cr3t-value-here"),
        ('{"access_token": "ya29.a0AfH6SMBx"}', "ya29.a0AfH6SMBx"),
        ("export NOTION_TOKEN=ntn_abcdefghijklmnopqrstu", "abcdefghijklmnopqrstu"),
        ("xoxb-1234567890-abcdefghij", "1234567890-abcdefghij"),
        ("key AIzaSyA1234567890abcdefghijklmnop", "SyA1234567890abcdefghijklmnop"),
        ("connecting to https://user:hunter2pass@db.example.com/x", "hunter2pass"),
        ("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "eyJzdWIiOiIxMjM0NTY3ODkwIn0"),
        ("using token 9f8e7d6c5b4a39281706f5e4d3c2b1a0", "9f8e7d6c5b4a39281706f5e4d3c2b1a0"),
    ],
)
def test_anything_shaped_like_a_secret_is_masked(line, leaked):
    out = logs.redact(line)
    assert leaked not in out and logs.MASK in out


@pytest.mark.parametrize(
    "line",
    [
        "prompt_tokens=100 completion_tokens=20",
        "author=Ahmad started the server",
        "Server started on port 3000",
        "GET /mcp 200 OK",
        "[rafiq-agent] starting on 127.0.0.1:53908",
        # Real errors from the MCP SDK: the word "token" alone isn't a secret.
        "ERROR: OAuth flow error: token exchange failed",
        "Token exchange failed (400): Client secret is required",
    ],
)
def test_ordinary_lines_are_left_as_they_are(line):
    assert logs.redact(line) == line


def test_known_secrets_are_masked_exactly_wherever_they_appear():
    secret = "plain-looking-value-7731"  # no prefix, no key= in front: only a list could know
    out = logs.redact(f"loaded config {secret} ok; again:{secret}", known=[secret, "on"])
    assert secret not in out and out.count(logs.MASK) == 2
    assert "ok" in out  # a tiny "known secret" like "on" isn't allowed to shred the log


# ── Reading ───────────────────────────────────────────────────────────────────


def test_the_tail_is_the_last_lines_and_says_when_it_left_some_out(tmp_path):
    path = tmp_path / "big.log"
    path.write_text("\n".join(f"line {i}" for i in range(2000)), encoding="utf-8")
    text, cut = logs.tail(path, 10)
    assert text.splitlines() == [f"line {i}" for i in range(1990, 2000)]
    assert cut is True

    small = tmp_path / "small.log"
    small.write_text("one\ntwo\n", encoding="utf-8")
    assert logs.tail(small, 10) == ("one\ntwo", False)


def test_a_huge_log_is_read_from_the_end_only(tmp_path):
    path = tmp_path / "huge.log"
    with open(path, "w", encoding="utf-8") as out:
        for i in range(60_000):
            out.write(f"{i:08d} " + "x" * 40 + "\n")
    text, cut = logs.tail(path, logs.MAX_LINES)
    rows = text.splitlines()
    assert cut is True and rows[-1].startswith("00059999")
    assert len(text.encode()) <= logs.MAX_BYTES
    assert all(len(r) == len(rows[-1]) for r in rows)  # no half line at the start


def test_logs_are_listed_and_only_listed_files_can_be_read(tmp_path, monkeypatch):
    monkeypatch.setattr(logs, "AGENT_LOG", tmp_path / "agent.log")
    monkeypatch.setattr(logs, "MCP_DIR", tmp_path / "logs")
    (tmp_path / "logs").mkdir()
    (tmp_path / "agent.log").write_text("hello", encoding="utf-8")
    (tmp_path / "logs" / "mcp-context7.log").write_text("ready", encoding="utf-8")
    (tmp_path / "logs" / "notes.txt").write_text("not a log", encoding="utf-8")

    listed = logs.list_logs({"context7": "Context7"})
    assert [(log.id, log.name, log.kind) for log in listed] == [
        ("agent", "Rafiq", "agent"),
        ("mcp-context7", "Context7", "mcp"),
    ]
    assert logs.find("mcp-context7") is not None
    for sneaky in ("notes", "../agent", "mcp-../../agent", "rafiq.db", ""):
        assert logs.find(sneaky) is None


# ── Through the API ───────────────────────────────────────────────────────────


async def test_an_mcp_servers_log_comes_back_without_its_own_secret(client):
    secret = "srv-secret-value-9913"
    r = await client.post(
        "/mcp",
        json={
            "name": "Logs Test",
            "transport": "stdio",
            "command": "node",
            "args": ["server.js"],
            "env": {"CONFIG_VALUE": secret},  # a name that no pattern would catch
            "headers": {},
            "enabled": False,
        },
        headers=AUTH,
    )
    assert r.status_code == 201, r.text
    server = r.json()
    path = logs.MCP_DIR / "mcp-logs_test.log"
    try:
        logs.MCP_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "\n".join(
                [
                    "server starting",
                    f"loaded CONFIG_VALUE={secret}",
                    f"echo {secret}",
                    f"agent token {AUTH_TOKEN}",
                    "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx",
                    "listening",
                ]
            ),
            encoding="utf-8",
        )

        listed = (await client.get("/logs", headers=AUTH)).json()
        entry = next(x for x in listed if x["id"] == "mcp-logs_test")
        assert entry["name"] == "Logs Test" and entry["kind"] == "mcp"

        out = (await client.get("/logs/mcp-logs_test", headers=AUTH)).json()
        assert "server starting" in out["text"] and "listening" in out["text"]
        assert secret not in out["text"]
        assert AUTH_TOKEN not in out["text"]
        assert "abcdefghijklmnopqrstuvwx" not in out["text"]
        assert out["lines"] == 6 and out["truncated"] is False
    finally:
        path.unlink(missing_ok=True)
        await client.delete(f"/mcp/{server['id']}", headers=AUTH)


async def test_asking_for_a_log_that_isnt_there_is_a_404(client):
    assert (await client.get("/logs/nope", headers=AUTH)).status_code == 404
    assert (await client.get("/logs/..%2Frafiq.db", headers=AUTH)).status_code == 404


async def test_the_logs_need_the_token(client):
    assert (await client.get("/logs")).status_code in (401, 403)
