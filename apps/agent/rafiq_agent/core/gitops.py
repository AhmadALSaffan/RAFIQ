"""Git plumbing for tasks: an isolated worktree per task, checkpoints, and reviewable changes.

When a task's folder is inside a git repository:

* **Worktree mode** (the default): the task gets its own checkout of the project, taken
  from a snapshot of the folder as it is right now — uncommitted and untracked (not
  ignored) files included, so it sees exactly what the user sees. Tasks in separate
  worktrees can't step on each other, so they run in parallel. When the task ends its work
  is committed, recorded under `refs/rafiq/tasks/<id>/…` (never a branch the user sees),
  and — if it completed — applied back onto the user's folder. A patch that no longer
  applies cleanly is left for the user to apply by hand instead of mangling their files.
* **In-place mode** (isolation off): the task edits the folder directly, bracketed by two
  snapshots, so its changes can still be reviewed and reverted.

Nothing here commits to the user's branch, moves HEAD, or touches their index: snapshots
are built in a throwaway index and live only under Rafiq's own refs.
"""

import asyncio
import contextlib
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from rafiq_agent.config import DATA_DIR

WORKTREES = (DATA_DIR / "worktrees").resolve()
IDENTITY = {
    "GIT_AUTHOR_NAME": "Rafiq",
    "GIT_AUTHOR_EMAIL": "rafiq@localhost",
    "GIT_COMMITTER_NAME": "Rafiq",
    "GIT_COMMITTER_EMAIL": "rafiq@localhost",
}
# Dependency folders a checkout doesn't have (they're ignored) but builds and tests need.
# They're linked, not copied, and only when git ignores them.
SHARED_DIRS = ("node_modules", ".venv", "venv")
MAX_DIFF_CHARS = 400_000


class GitError(Exception):
    pass


@dataclass
class Result:
    code: int
    out: str
    err: str


def available() -> bool:
    return shutil.which("git") is not None


def _run(args: list[str], cwd: str | Path, stdin: bytes | None, env: dict[str, str] | None) -> Result:
    full_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C.UTF-8", **(env or {})}
    flags = 0x0800_0000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
    proc = subprocess.run(  # noqa: S603 - fixed executable, arguments built by us
        ["git", *args],
        cwd=str(cwd),
        input=stdin,
        capture_output=True,
        env=full_env,
        creationflags=flags,
        timeout=600,
    )
    return Result(proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace"))


async def git(
    cwd: str | Path, *args: str, stdin: bytes | None = None, env: dict[str, str] | None = None, check: bool = True
) -> str:
    result = await asyncio.to_thread(_run, list(args), cwd, stdin, env)
    if check and result.code != 0:
        raise GitError(result.err.strip() or result.out.strip() or f"git {args[0]} failed")
    return result.out


async def repo_root(directory: str | Path | None) -> Path | None:
    if not directory or not available() or not Path(directory).is_dir():
        return None
    result = await asyncio.to_thread(_run, ["rev-parse", "--show-toplevel"], directory, None, None)
    if result.code != 0:
        return None
    return Path(result.out.strip()).resolve()


async def _head(repo: Path) -> str | None:
    result = await asyncio.to_thread(_run, ["rev-parse", "--verify", "-q", "HEAD"], repo, None, None)
    return result.out.strip() if result.code == 0 else None


async def snapshot(repo: Path, message: str = "rafiq snapshot") -> str:
    """A commit of the folder exactly as it is now (tracked changes and new, non-ignored
    files), built in a throwaway index so the user's own index is never touched."""
    fd, index = tempfile.mkstemp(prefix="rafiq-index-")
    os.close(fd)
    os.unlink(index)  # git wants to create it itself
    env = {"GIT_INDEX_FILE": index, **IDENTITY}
    try:
        head = await _head(repo)
        if head:
            await git(repo, "read-tree", head, env=env)
        await git(repo, "add", "-A", env=env)
        tree = (await git(repo, "write-tree", env=env)).strip()
        args = ["commit-tree", tree, "-m", message] + (["-p", head] if head else [])
        return (await git(repo, *args, env=env)).strip()
    finally:
        with contextlib.suppress(OSError):
            os.unlink(index)


def _ref(task_id: str, name: str) -> str:
    return f"refs/rafiq/tasks/{task_id}/{name}"


async def keep(repo: Path, task_id: str, name: str, sha: str) -> None:
    await git(repo, "update-ref", _ref(task_id, name), sha)


async def forget(repo: str | Path, task_id: str) -> None:
    for name in ("base", "result"):
        with contextlib.suppress(GitError):
            await git(repo, "update-ref", "-d", _ref(task_id, name))


async def _ignored(repo: Path, relative: str) -> bool:
    result = await asyncio.to_thread(_run, ["check-ignore", "-q", relative], repo, None, None)
    return result.code == 0


def _link(link: Path, target: Path) -> bool:
    """A directory junction (no admin rights needed on Windows), or a symlink elsewhere."""
    if link.exists() or not target.is_dir():
        return False
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            flags = 0x0800_0000
            subprocess.run(  # noqa: S603, S607
                ["cmd", "/c", "mklink", "/J", str(link), str(target)],
                capture_output=True,
                check=True,
                creationflags=flags,
            )
        else:
            link.symlink_to(target, target_is_directory=True)
    except (OSError, subprocess.CalledProcessError):
        return False
    return True


def unlink_shared(links: list[str]) -> None:
    """Removes the junctions only — never what they point at."""
    for raw in links:
        path = Path(raw)
        with contextlib.suppress(OSError):
            if os.path.isjunction(path) or path.is_symlink():
                os.rmdir(path) if os.path.isjunction(path) else path.unlink()


async def add_worktree(repo: Path, task_id: str, base: str, subdir: str) -> tuple[Path, list[str]]:
    path = WORKTREES / task_id
    if path.exists():
        await remove_worktree(repo, path, [])
    path.parent.mkdir(parents=True, exist_ok=True)
    await git(repo, "worktree", "add", "--detach", str(path), base)
    if not await _is_worktree(path):
        raise GitError(f"the worktree wasn't created where expected: {path}")
    links: list[str] = []
    for rel in {Path(subdir) / name for name in SHARED_DIRS} | {Path(name) for name in SHARED_DIRS}:
        source = repo / rel
        if source.is_dir() and await _ignored(repo, rel.as_posix()) and _link(path / rel, source):
            links.append(str(path / rel))
    return path, links


def _ours(path: Path) -> bool:
    """A folder Rafiq made for a worktree — the only kind it will ever delete."""
    resolved = path.resolve()
    return resolved != WORKTREES and WORKTREES in resolved.parents


async def _is_worktree(path: Path) -> bool:
    """True only for a linked worktree whose top is exactly `path`. Guards every command
    that stages or deletes, so a missing folder can never send them into another repo."""
    if not path.is_absolute() or not path.is_dir() or not _ours(path):
        return False
    top = await asyncio.to_thread(_run, ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"], path, None, None)
    if top.code != 0:
        return False
    lines = top.out.strip().splitlines()
    if len(lines) < 3:
        return False
    toplevel, git_dir, common = (Path(x) if Path(x).is_absolute() else (path / x) for x in lines[:3])
    return toplevel.resolve() == path.resolve() and git_dir.resolve() != common.resolve()


async def remove_worktree(repo: str | Path, path: str | Path, links: list[str]) -> None:
    unlink_shared(links)
    # Anything still a junction here was linked by us; never let a recursive delete follow it.
    root = Path(path)
    if not root.is_absolute() or not _ours(root):
        return
    for name in SHARED_DIRS:
        for candidate in root.rglob(name):
            if os.path.isjunction(candidate):
                with contextlib.suppress(OSError):
                    os.rmdir(candidate)
    with contextlib.suppress(GitError):
        await git(repo, "worktree", "remove", "--force", str(root))
    with contextlib.suppress(GitError):
        await git(repo, "worktree", "prune")
    if root.exists():
        await asyncio.to_thread(shutil.rmtree, root, True)


async def commit_worktree(path: Path, base: str, message: str) -> str:
    """The task's work as one commit on top of its base (the worktree is detached)."""
    if not await _is_worktree(path):
        raise GitError(f"not a Rafiq worktree: {path}")
    await git(path, "add", "-A", env=IDENTITY)
    tree = (await git(path, "write-tree", env=IDENTITY)).strip()
    return (await git(path, "commit-tree", tree, "-p", base, "-m", message, env=IDENTITY)).strip()


async def _patch(repo: Path, base: str, result: str, paths: list[str] | None = None) -> bytes:
    args = ["diff", "--binary", base, result]
    if paths:
        args += ["--", *paths]
    return (await asyncio.to_thread(_run, args, repo, None, None)).out.encode("utf-8")


async def apply(repo: Path, base: str, result: str, reverse: bool = False, three_way: bool = False) -> bool:
    """Applies (or takes back) a task's changes on the user's folder. Returns False, and
    changes nothing, when they don't apply cleanly — unless `three_way` is asked for, which
    merges and leaves conflict markers where it can't."""
    patch = await _patch(repo, base, result)
    if not patch.strip():
        return True
    flags = ["-R"] if reverse else []
    if three_way:
        outcome = await asyncio.to_thread(_run, ["apply", "--3way", *flags], repo, patch, None)
        return outcome.code == 0
    check = await asyncio.to_thread(_run, ["apply", "--check", *flags], repo, patch, None)
    if check.code != 0:
        return False
    await git(repo, "apply", *flags, stdin=patch)
    return True


async def changes(repo: Path, base: str, result: str, paths: list[str] | None = None) -> dict:
    """What a task changed: per-file stats and the unified diff (clipped)."""
    scope = ["--", *paths] if paths else []
    numstat = await git(repo, "diff", "--numstat", base, result, *scope)
    statuses = await git(repo, "diff", "--name-status", base, result, *scope)
    kinds = {}
    for line in statuses.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            kinds[parts[-1]] = parts[0][0]
    files = []
    for line in numstat.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added, removed, name = parts[0], parts[1], parts[-1]
        files.append(
            {
                "path": name,
                "status": {"A": "added", "D": "deleted", "R": "renamed"}.get(kinds.get(name, "M"), "modified"),
                "additions": int(added) if added.isdigit() else 0,
                "deletions": int(removed) if removed.isdigit() else 0,
                "binary": added == "-",
            }
        )
    diff = await git(repo, "diff", base, result, *scope)
    truncated = len(diff) > MAX_DIFF_CHARS
    return {"files": files, "diff": diff[:MAX_DIFF_CHARS], "truncated": truncated}
