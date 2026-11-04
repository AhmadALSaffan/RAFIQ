"""Isolation for the commands the model runs (shell_run), enforced by the operating system.

Permissions decide *whether* a command runs; this decides what it can reach once it does.
Three levels, set in Settings → Permissions (`shell_sandbox`):

- **off**: the command runs as before.
- **contained** (the default): the command and everything it starts are one tree. When it
  times out or the task is stopped, the whole tree goes, not only the shell on top (before,
  a `npm run dev` left its server running after a timeout). Nothing else changes, so a
  command may still open an app that stays open.
- **strict**: the command can write only inside the working folder and a temp folder of its
  own; anywhere else is refused by the system, whatever the command tries. It still reads
  and still reaches the network. Anything it leaves running is stopped when it ends.
  - Windows: the command runs at Low integrity (see sandbox_run.py). The working folder is
    labelled Low the first time, which is what lets it write there; nothing else is touched.
    It also gets no clipboard, no shutdown, no display or system settings, at most 512
    processes and 8 GB of memory.
  - macOS: the command runs under `sandbox-exec` with a profile that refuses writes outside
    the folder, the temp folders and the usual tool caches.

With strict on, the user can let commands run without asking (`sandbox_auto_approve`): the
permission card exists to stop a command from damaging things, and the folder is the only
thing it can damage now — and on a git project every task works in its own copy anyway.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from rafiq_agent.config import DATA_DIR

log = logging.getLogger(__name__)

Mode = Literal["off", "contained", "strict"]
MODES: tuple[Mode, ...] = ("off", "contained", "strict")
WINDOWS = sys.platform == "win32"
MAC = sys.platform == "darwin"
CREATE_NO_WINDOW = 0x08000000
SANDBOX_EXEC = "/usr/bin/sandbox-exec"

# What the model is told when a strict command hits the wall, so it changes approach instead
# of retrying the same write.
BLOCKED_HINT = (
    "\n\n(sandbox: commands can write only inside the working folder and their own temp "
    "folder here. A write anywhere else is refused by the system — do it inside the folder, "
    "or ask the user to switch the command sandbox to «contained» in Settings → Permissions.)"
)
BLOCKED_MARKS = ("access is denied", "operation not permitted", "permission denied", "read-only file system", "eacces", "eperm")


class SandboxUnavailable(RuntimeError):
    """Strict isolation was asked for and can't be had here: the command must not run."""


def sandbox_root() -> Path:
    return DATA_DIR / "sandbox"


def strict_supported() -> bool:
    if WINDOWS:
        return launcher() is not None
    return MAC and Path(SANDBOX_EXEC).exists()


def effective_mode(mode: str) -> Mode:
    """Linux has neither mechanism yet; there "strict" means contained."""
    if mode not in MODES:
        return "contained"
    if mode == "strict" and not (WINDOWS or MAC):
        return "contained"
    return mode  # type: ignore[return-value]


def auto_approves(settings: Any) -> bool:
    """Whether shell commands may skip the permission card: only when they're boxed in."""
    return (
        getattr(settings, "sandbox_auto_approve", False)
        and effective_mode(getattr(settings, "shell_sandbox", "contained")) == "strict"
        and strict_supported()
    )


# ── Windows ──────────────────────────────────────────────────────────────────────────────


def launcher() -> list[str] | None:
    """How to start sandbox_run.py: its own executable next to the frozen agent, or this
    Python on the source file in development."""
    if getattr(sys, "frozen", False):
        exe = Path(sys.executable).with_name("rafiq-sandbox.exe")
        return [str(exe)] if exe.exists() else None
    return [sys.executable, str(Path(__file__).resolve().parent.parent / "sandbox_run.py")]


_ICACLS = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32" / "icacls.exe"
_LABELLED_FILE = "labelled.json"
_labelled: set[str] | None = None
_label_lock = asyncio.Lock()


def _labelled_set() -> set[str]:
    global _labelled
    if _labelled is None:
        try:
            _labelled = set(json.loads((sandbox_root() / _LABELLED_FILE).read_text(encoding="utf-8")))
        except (OSError, ValueError):
            _labelled = set()
    return _labelled


async def label_low(folder: Path) -> None:
    """Mark a folder (and what's in it, and what will be) as writable at Low integrity.

    Done once per folder and remembered: new files inherit the label, so it never needs
    redoing. Only the folder the user gave the task is labelled, never anything above it."""
    key = os.path.normcase(str(folder.resolve()))
    async with _label_lock:
        done = _labelled_set()
        if key in done:
            return
        process = await asyncio.create_subprocess_exec(
            str(_ICACLS), str(folder), "/setintegritylevel", "(OI)(CI)L", "/T", "/C", "/Q",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=CREATE_NO_WINDOW,
        )
        _, err = await process.communicate()
        if process.returncode != 0:
            raise SandboxUnavailable(f"couldn't prepare {folder} for the sandbox: {err.decode(errors='replace').strip()}")
        done.add(key)
        root = sandbox_root()
        root.mkdir(parents=True, exist_ok=True)
        (root / _LABELLED_FILE).write_text(json.dumps(sorted(done), ensure_ascii=False), encoding="utf-8")


async def _strict_env_windows(env: dict[str, str]) -> dict[str, str]:
    """Temp and package caches the command can write to: its usual ones (in AppData) are
    Medium and refused at Low."""
    root = sandbox_root()
    folders = {name: root / name for name in ("tmp", "cache")}
    for folder in folders.values():
        folder.mkdir(parents=True, exist_ok=True)
    await label_low(root)
    tmp, cache = str(folders["tmp"]), folders["cache"]
    env = {**env, "TEMP": tmp, "TMP": tmp}
    env.update(
        npm_config_cache=str(cache / "npm"),
        npm_config_store_dir=str(cache / "pnpm-store"),
        YARN_CACHE_FOLDER=str(cache / "yarn"),
        PIP_CACHE_DIR=str(cache / "pip"),
        UV_CACHE_DIR=str(cache / "uv"),
        PYTHONPYCACHEPREFIX=str(cache / "pycache"),
    )
    return env


def _terminate_job(name: str) -> None:
    import ctypes
    import ctypes.wintypes as w

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenJobObjectW.argtypes = [w.DWORD, w.BOOL, w.LPCWSTR]
    k32.OpenJobObjectW.restype = w.HANDLE
    k32.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
    k32.CloseHandle.argtypes = [w.HANDLE]
    handle = k32.OpenJobObjectW(0x8, False, name)  # JOB_OBJECT_TERMINATE
    if handle:
        k32.TerminateJobObject(handle, 1)
        k32.CloseHandle(handle)


# ── macOS ────────────────────────────────────────────────────────────────────────────────

# Later rules win: everything is allowed, then every write is refused, then writes are let
# back in for the working folder, the temp folders, devices and the tool caches.
MAC_PROFILE = """(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath (param "WORKDIR"))
  (subpath (param "TMPDIR"))
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath (string-append (param "HOME") "/Library/Caches"))
  (subpath (string-append (param "HOME") "/.npm"))
  (subpath (string-append (param "HOME") "/.cache"))
  (subpath (string-append (param "HOME") "/Library/pnpm"))
  (regex #"^/dev/"))
"""


def _mac_strict_prefix(working_dir: Path) -> list[str]:
    tmp = os.environ.get("TMPDIR") or "/private/tmp"
    return [
        SANDBOX_EXEC,
        "-D", f"WORKDIR={os.path.realpath(working_dir)}",
        "-D", f"TMPDIR={os.path.realpath(tmp)}",
        "-D", f"HOME={os.path.realpath(Path.home())}",
        "-p", MAC_PROFILE,
    ]


# ── Running ──────────────────────────────────────────────────────────────────────────────


@dataclass
class Launch:
    """How to start one command under a sandbox mode, and how to stop all of it."""

    mode: Mode
    argv: list[str]
    env: dict[str, str]
    kwargs: dict[str, Any] = field(default_factory=dict)
    job: str | None = None
    # A command line for the system shell as is (off on Windows: cmd.exe must get it raw,
    # not re-quoted as one argument).
    shell: str | None = None

    def kill(self, process: asyncio.subprocess.Process) -> None:
        """Stop the command and everything it started."""
        if self.job:
            with contextlib.suppress(OSError):
                _terminate_job(self.job)
        elif not WINDOWS and self.mode != "off":
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
        with contextlib.suppress(ProcessLookupError):
            process.kill()

    def explain(self, output: str, ok: bool) -> str:
        if self.mode == "strict" and not ok and any(mark in output.lower() for mark in BLOCKED_MARKS):
            return output + BLOCKED_HINT
        return output


def _shell_argv(command: str) -> list[str]:
    return ["/bin/sh", "-c", command]


def _unboxed(level: Mode, env: dict[str, str], command: str | None, argv: list[str] | None) -> Launch:
    if command is None:
        return Launch(level, list(argv or []), env)
    if WINDOWS:
        return Launch(level, [], env, shell=command)
    return Launch(level, _shell_argv(command), env)


async def prepare(
    mode: str,
    working_dir: Path,
    env: dict[str, str],
    *,
    command: str | None = None,
    argv: list[str] | None = None,
) -> Launch:
    """The launch for a shell `command` line or a program `argv` under `mode`.

    Raises SandboxUnavailable when strict isolation can't be set up: then the command must
    not run at all, rather than run without the protection the user chose."""
    level = effective_mode(mode)
    if level == "off":
        return _unboxed(level, env, command, argv)

    if WINDOWS:
        start = launcher()
        if start is None:
            if level == "strict":
                raise SandboxUnavailable("the sandbox launcher (rafiq-sandbox.exe) is missing from this install")
            return _unboxed("off", env, command, argv)
        if level == "strict":
            await label_low(working_dir)
            env = await _strict_env_windows(env)
        job = f"rafiq-sandbox-{uuid.uuid4().hex}"
        tail = ["--shell", command] if command is not None else ["--", *(argv or [])]
        return Launch(level, [*start, "--job", job, "--mode", level, *tail], env, {"creationflags": CREATE_NO_WINDOW}, job)

    target = _shell_argv(command) if command is not None else list(argv or [])
    if level == "strict":
        if not Path(SANDBOX_EXEC).exists():
            raise SandboxUnavailable("sandbox-exec isn't available on this Mac")
        target = [*_mac_strict_prefix(working_dir), *target]
    # Its own process group, so the whole tree can be stopped with one signal.
    return Launch(level, target, env, {"start_new_session": True})


def run_sync_check(mode: str, working_dir: Path, command: str) -> subprocess.CompletedProcess[str]:
    """Run one command under `mode` and wait (for tests and diagnostics)."""
    launch = asyncio.run(prepare(mode, working_dir, dict(os.environ), command=command))
    target: Any = launch.shell if launch.shell is not None else launch.argv
    return subprocess.run(
        target, shell=launch.shell is not None, cwd=working_dir, env=launch.env,
        capture_output=True, text=True, timeout=120, **launch.kwargs,
    )
