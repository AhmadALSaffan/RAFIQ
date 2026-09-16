"""A task's life in git: set up before it runs, settled after, reviewable and reversible.

`Task.git` holds the record:

    {"planned": "worktree"}                      — decided at creation (the folder is a repo
                                                   and isolation is on)
    {"mode": "worktree" | "inplace", "repo", "subdir", "base", "result",
     "worktree", "links", "paths", "state", "error"}

`state` is one of: running · applied · pending (finished without completing — not applied)
· conflict (didn't apply cleanly) · reverted · empty (changed nothing) · error.
"""

import contextlib
from pathlib import Path
from typing import Any

from rafiq_agent.core import gitops
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Task


async def _save(task_id: str, info: dict[str, Any] | None) -> None:
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        if task is not None:
            task.git = dict(info) if info is not None else None
            await session.commit()


async def plan(working_dir: str | None, isolate: bool) -> dict[str, Any] | None:
    """At creation: will this task get its own worktree?"""
    if isolate and await gitops.repo_root(working_dir):
        return {"planned": "worktree"}
    return None


async def prepare(
    task_id: str, title: str, working_dir: Path, paths: list[str], planned: dict[str, Any] | None
) -> tuple[Path, dict[str, Any] | None]:
    """Before the task runs. Returns the folder it should work in, and the git record."""
    repo = await gitops.repo_root(working_dir)
    if repo is None:
        return working_dir, None
    subdir = working_dir.resolve().relative_to(repo).as_posix() if working_dir.resolve() != repo else ""
    try:
        base = await gitops.snapshot(repo, f"rafiq: before «{title}»")
        await gitops.keep(repo, task_id, "base", base)
        info: dict[str, Any] = {
            "repo": str(repo),
            "subdir": subdir,
            "base": base,
            "result": None,
            "paths": [str(Path(subdir) / p) if subdir else p for p in paths] or None,
            "state": "running",
            "error": None,
        }
        if planned and planned.get("planned") == "worktree":
            tree, links = await gitops.add_worktree(repo, task_id, base, subdir)
            info.update(mode="worktree", worktree=str(tree), links=links)
            effective = tree / subdir if subdir else tree
        else:
            info.update(mode="inplace", worktree=None, links=[])
            effective = working_dir
    except gitops.GitError as exc:
        # Git trouble must not stop the task — it just runs without a safety net.
        await _save(task_id, {"mode": "none", "state": "error", "error": str(exc)})
        return working_dir, None
    await _save(task_id, info)
    return effective, info


async def _same_tree(repo: Path, a: str, b: str) -> bool:
    trees = await gitops.git(repo, "rev-parse", f"{a}^{{tree}}", f"{b}^{{tree}}")
    first, second = trees.split()
    return first == second


async def settle(task_id: str, title: str, info: dict[str, Any], completed: bool) -> dict[str, Any]:
    """After the task ran: record its work, and bring it home if it completed."""
    repo = Path(info["repo"])
    try:
        if info["mode"] == "worktree":
            result = await gitops.commit_worktree(Path(info["worktree"]), info["base"], f"rafiq: {title}")
            await gitops.keep(repo, task_id, "result", result)
            info["result"] = result
            await gitops.remove_worktree(repo, info["worktree"], info.get("links") or [])
            info.update(worktree=None, links=[])
            if await _same_tree(repo, info["base"], result):
                info["state"] = "empty"
            elif completed:
                info["state"] = "applied" if await gitops.apply(repo, info["base"], result) else "conflict"
            else:
                info["state"] = "pending"
        else:
            result = await gitops.snapshot(repo, f"rafiq: after «{title}»")
            await gitops.keep(repo, task_id, "result", result)
            info["result"] = result
            same = await _same_tree(repo, info["base"], result)
            info["state"] = "empty" if same else "applied"
    except gitops.GitError as exc:
        info.update(state="error", error=str(exc))
        if info.get("worktree"):
            with contextlib.suppress(Exception):
                await gitops.remove_worktree(repo, info["worktree"], info.get("links") or [])
            info.update(worktree=None, links=[])
    await _save(task_id, info)
    return info


async def review(info: dict[str, Any]) -> dict[str, Any]:
    repo, base, result = Path(info["repo"]), info.get("base"), info.get("result")
    if not base or not result:
        return {"files": [], "diff": "", "truncated": False}
    paths = info.get("paths") if info.get("mode") == "inplace" else None
    return await gitops.changes(repo, base, result, paths)


async def apply(task_id: str, info: dict[str, Any], three_way: bool = False) -> dict[str, Any]:
    ok = await gitops.apply(Path(info["repo"]), info["base"], info["result"], three_way=three_way)
    info["state"] = "applied" if ok else "conflict"
    info["error"] = None
    await _save(task_id, info)
    return info


async def revert(task_id: str, info: dict[str, Any]) -> bool:
    ok = await gitops.apply(Path(info["repo"]), info["base"], info["result"], reverse=True)
    if ok:
        info["state"] = "reverted"
        await _save(task_id, info)
    return ok


async def discard(task_id: str, info: dict[str, Any] | None) -> None:
    """The task is being deleted: drop its worktree (if any) and its refs."""
    if not info or not info.get("repo"):
        return
    repo = info["repo"]
    if info.get("worktree"):
        with contextlib.suppress(Exception):
            await gitops.remove_worktree(repo, info["worktree"], info.get("links") or [])
    with contextlib.suppress(Exception):
        await gitops.forget(repo, task_id)


async def cleanup_interrupted(task_id: str, info: dict[str, Any] | None) -> None:
    """After a restart: a worktree whose task died with the app is removed (the task failed;
    its refs stay, so nothing it did is lost)."""
    if not info or not info.get("worktree"):
        return
    repo = Path(info["repo"])
    with contextlib.suppress(Exception):
        result = await gitops.commit_worktree(Path(info["worktree"]), info["base"], "rafiq: interrupted")
        await gitops.keep(repo, task_id, "result", result)
        info["result"] = result
    with contextlib.suppress(Exception):
        await gitops.remove_worktree(repo, info["worktree"], info.get("links") or [])
    info.update(worktree=None, links=[], state="pending" if info.get("result") else "error")
    await _save(task_id, info)
