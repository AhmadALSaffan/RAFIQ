"""Rate-limit handling, worktrees and change review, project instructions, web tools,
schedules, templates and MCP settings."""

import asyncio
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport

from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import gitops, task_git
from rafiq_agent.core.project_notes import project_instructions
from rafiq_agent.core.schedules import next_run
from rafiq_agent.llm.resilience import ResilientProvider, retryable
from rafiq_agent.main import app
from rafiq_agent.storage.db import SessionLocal, init_db
from rafiq_agent.storage.models import LlmModel, Task

AUTH = {"authorization": f"Bearer {AUTH_TOKEN}"}


@pytest.fixture()
async def db():
    await init_db()


@pytest.fixture()
async def client(db):
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _model() -> str:
    async with SessionLocal() as session:
        model = LlmModel(name="T", provider="custom", model_id="t", base_url="http://127.0.0.1:1")
        session.add(model)
        await session.commit()
        return model.id


# ── Provider limits ───────────────────────────────────────────────────────────────────


class RateLimited(Exception):
    status_code = 429


class Flaky:
    model = "openai/flaky"

    def __init__(self, failures: int, error: Exception | None = None) -> None:
        self.failures, self.calls = failures, 0
        self.error = error or RateLimited("rate limit")

    async def stream_chat(self, messages, tools):  # noqa: ANN001
        self.calls += 1
        if self.calls <= self.failures:
            raise self.error
        yield SimpleNamespace(text_delta="ok")

    async def complete(self, messages, max_tokens=None):  # noqa: ANN001
        self.calls += 1
        if self.calls <= self.failures:
            raise self.error
        return "ok"

    async def aclose(self) -> None:
        return None


async def _no_sleep(_: float) -> None:
    return None


async def test_rate_limits_are_retried():
    inner = Flaky(failures=2)
    provider = ResilientProvider(inner, key="k", sleep=_no_sleep)
    events = [e async for e in provider.stream_chat([], [])]
    assert [e.text_delta for e in events] == ["ok"] and inner.calls == 3


async def test_a_fallback_takes_over_when_retries_run_out():
    provider = ResilientProvider(Flaky(failures=99), key="k", fallback=Flaky(failures=0), attempts=2, sleep=_no_sleep)
    assert await provider.complete([]) == "ok"


async def test_bad_requests_are_not_retried():
    inner = Flaky(failures=1, error=ValueError("bad request"))
    provider = ResilientProvider(inner, key="k", sleep=_no_sleep)
    with pytest.raises(ValueError):
        await provider.complete([])
    assert inner.calls == 1 and not retryable(ValueError("bad request"))


async def test_requests_per_key_are_capped():
    from rafiq_agent.llm import resilience

    resilience.set_concurrency(2)
    active = peak = 0

    class Slow(Flaky):
        async def complete(self, messages, max_tokens=None):  # noqa: ANN001
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            return "ok"

    providers = [ResilientProvider(Slow(0), key="same") for _ in range(6)]
    await asyncio.gather(*(p.complete([]) for p in providers))
    resilience.set_concurrency(resilience.DEFAULT_CONCURRENCY)
    assert peak == 2


# ── Project instructions ──────────────────────────────────────────────────────────────


def test_project_instructions_are_found_up_to_the_repo(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "RAFIQ.md").write_text("شغّل pnpm test", encoding="utf-8")
    sub = tmp_path / "src"
    sub.mkdir()
    (sub / "AGENTS.md").write_text("use tabs", encoding="utf-8")
    notes = project_instructions(sub)
    assert notes and notes.index("pnpm test") < notes.index("use tabs")  # outermost first
    assert project_instructions(tmp_path / "missing") is None


# ── Git: worktrees, apply, revert ─────────────────────────────────────────────────────


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture()
def repo(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "t@t")
    _git(root, "config", "user.name", "t")
    (root / "a.txt").write_text("one\n", encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    (root / "draft.txt").write_text("not committed\n", encoding="utf-8")  # the task must see this
    return root


async def _task_row(model_id: str, folder: Path) -> str:
    async with SessionLocal() as session:
        task = Task(title="edit", prompt="p", model_id=model_id, working_dir=str(folder), status="running")
        session.add(task)
        await session.commit()
        return task.id


pytestmark_git = pytest.mark.skipif(not gitops.available(), reason="git not installed")


@pytestmark_git
async def test_a_worktree_task_sees_uncommitted_work_and_its_changes_come_home(db, repo):
    task_id = await _task_row(await _model(), repo)
    folder, info = await task_git.prepare(task_id, "edit", repo, [], {"planned": "worktree"})
    assert folder != repo and (folder / "draft.txt").read_text(encoding="utf-8") == "not committed\n"
    (folder / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
    (folder / "new.txt").write_text("hi\n", encoding="utf-8")
    assert (repo / "a.txt").read_text(encoding="utf-8") == "one\n"  # isolated until done

    info = await task_git.settle(task_id, "edit", info, completed=True)
    assert info["state"] == "applied" and not folder.exists()
    assert (repo / "a.txt").read_text(encoding="utf-8") == "one\ntwo\n" and (repo / "new.txt").exists()
    assert _git(repo, "log", "--oneline").count("\n") == 1  # nothing committed on the user's branch

    review = await task_git.review(info)
    assert {f["path"] for f in review["files"]} == {"a.txt", "new.txt"}

    assert await task_git.revert(task_id, info)
    assert (repo / "a.txt").read_text(encoding="utf-8") == "one\n" and not (repo / "new.txt").exists()


@pytestmark_git
async def test_changes_that_no_longer_apply_are_left_for_the_user(db, repo):
    task_id = await _task_row(await _model(), repo)
    folder, info = await task_git.prepare(task_id, "edit", repo, [], {"planned": "worktree"})
    (folder / "a.txt").write_text("task version\n", encoding="utf-8")
    (repo / "a.txt").write_text("user version\n", encoding="utf-8")  # edited meanwhile
    info = await task_git.settle(task_id, "edit", info, completed=True)
    assert info["state"] == "conflict"
    assert (repo / "a.txt").read_text(encoding="utf-8") == "user version\n"  # untouched


@pytestmark_git
async def test_an_unfinished_task_is_not_applied(db, repo):
    task_id = await _task_row(await _model(), repo)
    folder, info = await task_git.prepare(task_id, "edit", repo, [], {"planned": "worktree"})
    (folder / "a.txt").write_text("half done\n", encoding="utf-8")
    info = await task_git.settle(task_id, "edit", info, completed=False)
    assert info["state"] == "pending" and (repo / "a.txt").read_text(encoding="utf-8") == "one\n"
    info = await task_git.apply(task_id, info)
    assert info["state"] == "applied" and (repo / "a.txt").read_text(encoding="utf-8") == "half done\n"


@pytestmark_git
async def test_in_place_tasks_get_checkpoints_too(db, repo):
    task_id = await _task_row(await _model(), repo)
    folder, info = await task_git.prepare(task_id, "edit", repo, [], None)
    assert folder == repo and info["mode"] == "inplace"
    (repo / "a.txt").write_text("changed\n", encoding="utf-8")
    info = await task_git.settle(task_id, "edit", info, completed=True)
    assert info["state"] == "applied"
    assert await task_git.revert(task_id, info)
    assert (repo / "a.txt").read_text(encoding="utf-8") == "one\n"


@pytestmark_git
async def test_staging_never_runs_outside_a_rafiq_worktree(repo):
    base = _git(repo, "rev-parse", "HEAD").strip()
    for wrong in (repo, Path("relative/worktree"), repo.parent / "missing"):
        with pytest.raises(gitops.GitError):
            await gitops.commit_worktree(wrong, base, "x")
    assert _git(repo, "diff", "--cached", "--name-only") == ""  # the user's index is untouched


async def test_a_folder_outside_git_runs_as_before(db, tmp_path):
    task_id = await _task_row(await _model(), tmp_path)
    folder, info = await task_git.prepare(task_id, "edit", tmp_path, [], {"planned": "worktree"})
    assert folder == tmp_path and info is None


# ── Web ───────────────────────────────────────────────────────────────────────────────


async def test_web_fetch_refuses_local_addresses():
    from rafiq_agent.tools.web import WebFetchTool

    for url in ("http://127.0.0.1:8765/settings", "http://localhost/", "file:///C:/Windows"):
        result = await WebFetchTool().run({"url": url})
        assert not result.ok


def test_html_becomes_readable_text():
    from rafiq_agent.tools.web import _Text

    parser = _Text("https://example.com/docs/")
    parser.feed(
        "<html><head><title>Docs</title><style>x{}</style></head><body><h1>Intro</h1>"
        "<p>Hello <a href='guide'>guide</a></p><script>evil()</script><ul><li>one</li></ul></body></html>"
    )
    text = parser.text()
    assert "# Intro" in text and "Hello guide" in text and "- one" in text and "evil" not in text
    assert parser.title == "Docs" and parser.links == [("guide", "https://example.com/docs/guide")]


# ── Schedules, templates, MCP ─────────────────────────────────────────────────────────


def test_next_run_for_each_kind():
    now = datetime(2026, 9, 14, 10, 0, tzinfo=UTC)  # a Monday
    interval = SimpleNamespace(kind="interval", every_minutes=30, at_time=None, weekdays=None)
    assert next_run(interval, now) == now + timedelta(minutes=30)
    daily = SimpleNamespace(kind="daily", every_minutes=None, at_time="09:00", weekdays=None)
    later = next_run(daily, now)
    assert later is not None and later > now and later - now <= timedelta(days=1)
    weekly = SimpleNamespace(kind="weekly", every_minutes=None, at_time="09:00", weekdays=[4])  # Friday
    friday = next_run(weekly, now)
    assert friday is not None and friday.astimezone().weekday() == 4


async def test_templates_round_trip(client):
    made = (await client.post("/templates", headers=AUTH, json={"name": "مراجعة", "prompt": "راجع الكود"})).json()
    assert any(t["id"] == made["id"] for t in (await client.get("/templates", headers=AUTH)).json())
    assert (await client.delete(f"/templates/{made['id']}", headers=AUTH)).status_code == 204


async def test_schedules_validate_and_start_tasks(client):
    model_id = await _model()
    bad = await client.post("/schedules", headers=AUTH, json={"title": "x", "prompt": "p", "model_id": model_id, "kind": "weekly", "at_time": "09:00"})
    assert bad.status_code == 400
    made = (
        await client.post(
            "/schedules",
            headers=AUTH,
            json={"title": "تقرير", "prompt": "لخّص", "model_id": model_id, "kind": "interval", "every_minutes": 60},
        )
    ).json()
    assert made["next_run_at"]
    run = (await client.post(f"/schedules/{made['id']}/run", headers=AUTH)).json()
    async with SessionLocal() as session:
        task = await session.get(Task, run["task_id"])
        assert task.origin == {"schedule_id": made["id"]}


async def test_mcp_servers_keep_their_secrets_out_of_responses(client):
    made = (
        await client.post(
            "/mcp",
            headers=AUTH,
            json={"name": "files", "transport": "stdio", "command": "npx", "args": ["-y", "x"], "env": {"TOKEN": "s3cret"}},
        )
    ).json()
    assert made["secret_keys"] == ["TOKEN"] and "s3cret" not in str(made)
    kept = (
        await client.put(
            f"/mcp/{made['id']}",
            headers=AUTH,
            json={"name": "files", "transport": "stdio", "command": "npx", "args": [], "env": {"TOKEN": ""}},
        )
    ).json()
    from rafiq_agent.mcp_bridge import load_secrets

    assert kept["secret_keys"] == ["TOKEN"] and load_secrets(made["id"])["env"] == {"TOKEN": "s3cret"}
    assert (await client.delete(f"/mcp/{made['id']}", headers=AUTH)).status_code == 204
    assert (await client.post("/mcp", headers=AUTH, json={"name": "x", "transport": "http", "url": "ftp://x"})).status_code == 400


async def test_new_permissions_default_for_old_settings(client):
    from rafiq_agent.schemas.settings import AppSettings

    old = AppSettings.model_validate({"permissions": {"shell": "auto"}})
    assert old.permissions["mcp"] == "ask" and old.permissions["shell"] == "auto"
