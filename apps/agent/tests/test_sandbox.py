"""The command sandbox (core/sandbox.py): what the system lets a command reach.

The Windows tests run the real launcher at Low integrity, the macOS ones the real
sandbox-exec profile (the macOS build workflow runs this file on a Mac)."""

import asyncio
import shutil
import sys
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import psutil
import pytest

from rafiq_agent.core import sandbox
from rafiq_agent.core.agent_runtime import policy_decision
from rafiq_agent.schemas.settings import AppSettings
from rafiq_agent.tools.shell import ShellRunTool

WINDOWS = sys.platform == "win32"
MAC = sys.platform == "darwin"
real_os = pytest.mark.skipif(not (WINDOWS or MAC), reason="the sandbox is enforced on Windows and macOS")


_made: list[Path] = []


def folders(tmp_path: Path) -> tuple[Path, Path]:
    inside = tmp_path / "inside"
    # On a Mac the temp folders are among the places a sandboxed command may write, so the
    # forbidden one has to be somewhere else: the home folder.
    outside = Path.home() / f".rafiq-sandbox-test-{uuid.uuid4().hex[:8]}" if MAC else tmp_path / "outside"
    inside.mkdir()
    outside.mkdir()
    _made.append(outside)
    (inside / "existing.txt").write_text("old", encoding="utf-8")
    return inside, outside


@pytest.fixture(autouse=True)
def _clean_outside():
    yield
    while _made:
        shutil.rmtree(_made.pop(), ignore_errors=True)


def write(path: Path) -> str:
    """A command line that appends to `path` (the same Python, so it works on both systems)."""
    return f'"{sys.executable}" -c "open(r\'{path}\', \'a\').write(\'x\')"'


# ── Settings and permissions ─────────────────────────────────────────────────────────────


def test_defaults_contain_commands_but_still_ask():
    settings = AppSettings()
    assert settings.shell_sandbox == "contained"
    assert settings.sandbox_auto_approve is False
    assert not sandbox.auto_approves(settings)


def test_unknown_mode_falls_back_to_contained():
    assert sandbox.effective_mode("nonsense") == "contained"


@real_os
def test_auto_approve_only_counts_under_strict():
    on = SimpleNamespace(shell_sandbox="strict", sandbox_auto_approve=True)
    assert sandbox.auto_approves(on)
    assert not sandbox.auto_approves(SimpleNamespace(shell_sandbox="contained", sandbox_auto_approve=True))
    assert not sandbox.auto_approves(SimpleNamespace(shell_sandbox="strict", sandbox_auto_approve=False))


def test_sandboxed_commands_skip_the_card_but_never_a_deny():
    asking = {"shell": "ask", "filesystem_write": "ask"}
    assert policy_decision("shell_run", "exec", asking) == "ask"
    assert policy_decision("shell_run", "exec", asking, sandboxed=True) == "allow"
    # Only commands are boxed in; writes through the file tools still ask.
    assert policy_decision("filesystem_write", "write", asking, sandboxed=True) == "ask"
    assert policy_decision("shell_run", "exec", {"shell": "deny"}, sandboxed=True) == "deny"


# ── What the system enforces ─────────────────────────────────────────────────────────────


@real_os
def test_strict_writes_inside_the_folder_only(tmp_path):
    inside, outside = folders(tmp_path)
    for target in (inside / "new.txt", inside / "existing.txt"):
        done = sandbox.run_sync_check("strict", inside, write(target))
        assert done.returncode == 0, done.stderr
    assert (inside / "existing.txt").read_text(encoding="utf-8") == "oldx"

    blocked = sandbox.run_sync_check("strict", inside, write(outside / "escape.txt"))
    assert blocked.returncode != 0
    assert not (outside / "escape.txt").exists()


@real_os
def test_strict_children_are_boxed_in_too(tmp_path):
    """A command that starts another program can't get around it: the child is boxed in too."""
    inside, outside = folders(tmp_path)
    inner = write(outside / "child.txt").replace('"', '\\"')
    nested = f'"{sys.executable}" -c "import subprocess; raise SystemExit(subprocess.call(\\"{inner}\\", shell=True))"'
    sandbox.run_sync_check("strict", inside, nested)
    assert not (outside / "child.txt").exists()


@real_os
def test_off_and_contained_write_anywhere(tmp_path):
    inside, outside = folders(tmp_path)
    for mode in ("off", "contained"):
        done = sandbox.run_sync_check(mode, inside, write(outside / f"{mode}.txt"))
        assert done.returncode == 0, done.stderr
        assert (outside / f"{mode}.txt").exists()


@real_os
async def test_shell_tool_explains_a_blocked_write(tmp_path):
    inside, outside = folders(tmp_path)
    tool = ShellRunTool(inside, "strict")
    script = f"open(r'{outside / 'x.txt'}', 'w').write('x')"
    result = await tool.run({"script": script, "language": "python"})
    assert not result.ok
    assert "sandbox:" in result.output
    ok = await tool.run({"script": "open('fine.txt', 'w').write('x'); print('done')", "language": "python"})
    assert ok.ok and "done" in ok.output


@real_os
async def test_timeout_stops_the_whole_tree(tmp_path):
    """Before, a timeout killed the shell and left what it started running."""
    marker = f"rafiq-tree-{time.time_ns()}"
    script = (
        "import subprocess, sys, time\n"
        f"subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', {marker!r}])\n"
        "time.sleep(60)\n"
    )
    result = await ShellRunTool(tmp_path, "contained").run({"script": script, "language": "python", "timeout_seconds": 3})
    assert "timed out" in result.output
    await asyncio.sleep(1.5)
    left = [p for p in psutil.process_iter(["cmdline"]) if marker in " ".join(p.info.get("cmdline") or [])]
    for p in left:
        p.kill()
    assert not left, "a child of the timed-out command was still running"
