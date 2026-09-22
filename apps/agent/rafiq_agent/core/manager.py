import asyncio
import contextlib
import json
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select

from rafiq_agent.i18n import tr
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Task, TaskEvent

MAX_PARALLEL = 100
TERMINAL = frozenset({"completed", "failed", "cancelled"})


def _norm(path: str) -> str:
    return os.path.normcase(os.path.abspath(path)) if path else ""


def _within(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


@dataclass(frozen=True)
class Claim:
    """What a task may change: its whole folder, or only some paths inside it. Two tasks
    whose claims overlap could edit the same files, so they never run at the same time."""

    root: str
    paths: tuple[str, ...] = ()

    @classmethod
    def of(cls, working_dir: str | None, paths: list[str] | None = None) -> "Claim":
        root = _norm(working_dir or "")
        inside: list[str] = []
        for raw in paths or []:
            full = _norm(os.path.join(root, str(raw)))
            if not _within(full, root):
                return cls(root)  # a path outside the folder: play safe, claim all of it
            inside.append(full)
        return cls(root, tuple(inside))

    def areas(self) -> tuple[str, ...]:
        return self.paths or (self.root,)

    def overlaps(self, other: "Claim") -> bool:
        if not (_within(self.root, other.root) or _within(other.root, self.root)):
            return False
        return any(_within(a, b) or _within(b, a) for a in self.areas() for b in other.areas())


async def statuses(task_ids: list[str] | set[str]) -> dict[str, str]:
    """Current status of each task that still exists (deleted ones are simply absent)."""
    if not task_ids:
        return {}
    async with SessionLocal() as session:
        rows = await session.execute(select(Task.id, Task.status).where(Task.id.in_(list(task_ids))))
        return dict(rows.all())


async def _no_limit() -> int:
    return MAX_PARALLEL


class TaskManager:
    """Runs tasks in parallel, up to the user's limit, persists their transcripts, fans
    events out to WebSocket subscribers, and brokers permission approve/deny between
    runtime and UI.

    Two tasks run at the same time unless they would edit the same files (their claims
    overlap) or one declared it depends on the other. Tasks held back that way start in the
    order they were created, so a plan split into steps on one folder still runs step by step.
    """

    def __init__(self) -> None:
        self._runner: Callable[[str], Awaitable[None]] | None = None
        self._limit: Callable[[], Awaitable[int]] = _no_limit
        self._waiting: list[str] = []  # creation order
        self._claims: dict[str, Claim] = {}
        self._depends: dict[str, tuple[str, ...]] = {}
        self._running: dict[str, asyncio.Task] = {}
        self._wake: asyncio.Event | None = None
        self._scheduler: asyncio.Task | None = None
        self._subscribers: dict[str, set[WebSocket]] = {}
        self._pending_permissions: dict[str, asyncio.Future[str]] = {}
        self._pending_by_task: dict[str, set[str]] = {}

    # ---- scheduling ----------------------------------------------------------------------

    def start(
        self, runner: Callable[[str], Awaitable[None]], limit: Callable[[], Awaitable[int]] | None = None
    ) -> None:
        self._runner = runner
        if limit is not None:
            self._limit = limit
        if self._scheduler is None:
            self._wake = asyncio.Event()
            self._scheduler = asyncio.create_task(self._schedule())
        self._poke()

    def _poke(self) -> None:
        if self._wake is not None:
            self._wake.set()

    async def _schedule(self) -> None:
        assert self._wake is not None
        while True:
            await self._wake.wait()
            self._wake.clear()
            with contextlib.suppress(Exception):  # a bad pass must never stop scheduling
                await self._fill()

    async def _fill(self) -> None:
        """Starts every waiting task that may run now."""
        if not self._waiting or self._runner is None:
            return
        limit = max(1, min(MAX_PARALLEL, await self._limit()))
        status = await statuses({d for t in self._waiting for d in self._depends.get(t, ())})
        held: list[Claim] = []  # earlier tasks still waiting — later overlapping ones queue behind
        for task_id in list(self._waiting):
            if len(self._running) >= limit:
                break
            claim = self._claims[task_id]
            deps = [d for d in self._depends.get(task_id, ()) if d in status]  # deleted = no longer blocks
            if any(status[d] in ("failed", "cancelled") for d in deps):
                self._drop(task_id)
                await self.emit_event(
                    task_id,
                    "error",
                    {"message": tr("ما اشتغلت المهمة لأن مهمة لازم تخلص قبلها فشلت أو انلغت.")},
                )
                await self.set_status(task_id, "failed")
                self._poke()  # tasks depending on this one fail the same way
                continue
            blocked = (
                any(status[d] != "completed" for d in deps)
                or any(claim.overlaps(self._claims[r]) for r in self._running)
                or any(claim.overlaps(h) for h in held)
            )
            if blocked:
                held.append(claim)
                continue
            self._waiting.remove(task_id)
            self._running[task_id] = asyncio.create_task(self._run(task_id))

    async def _run(self, task_id: str) -> None:
        assert self._runner is not None
        try:
            await self._runner(task_id)
        except (asyncio.CancelledError, Exception):  # noqa: BLE001 - the runner records the outcome
            pass
        finally:
            self._running.pop(task_id, None)
            self._claims.pop(task_id, None)
            self._depends.pop(task_id, None)
            self._pending_by_task.pop(task_id, None)
            self._poke()

    def _drop(self, task_id: str) -> None:
        with contextlib.suppress(ValueError):
            self._waiting.remove(task_id)
        self._claims.pop(task_id, None)
        self._depends.pop(task_id, None)

    def enqueue(
        self,
        task_id: str,
        working_dir: str | None = None,
        paths: list[str] | None = None,
        depends_on: list[str] | None = None,
        isolated: bool = False,
    ) -> None:
        if isolated and not paths:
            # Its own worktree: nothing it does touches the folder until it's done, so it
            # overlaps no one. (Declared paths still keep overlapping tasks apart, so their
            # changes apply back without conflicts.)
            self._claims[task_id] = Claim.of(os.path.join(working_dir or "", f".rafiq-worktree-{task_id}"))
        else:
            self._claims[task_id] = Claim.of(working_dir, paths)
        self._depends[task_id] = tuple(depends_on or ())
        self._waiting.append(task_id)
        self._poke()

    def is_running(self, task_id: str) -> bool:
        return task_id in self._running

    def busy(self) -> bool:
        """Any task running or waiting its turn."""
        return bool(self._running or self._waiting)

    def reschedule(self) -> None:
        """Look at the waiting tasks again (e.g. the parallel limit changed)."""
        self._poke()

    def forget(self, task_id: str) -> None:
        """A deleted task: take it out of line."""
        self._drop(task_id)
        self._poke()

    async def recover(self) -> None:
        """After a restart: tasks that were mid-run are lost; still-queued ones go back in line."""
        from rafiq_agent.core.task_git import cleanup_interrupted

        async with SessionLocal() as session:
            rows = (await session.execute(select(Task).order_by(Task.created_at))).scalars().all()
            interrupted = [(t.id, t.git) for t in rows if t.status in ("running", "pending")]
            queued = [t for t in rows if t.status == "queued"]
            for t in rows:
                if t.status in ("running", "pending"):
                    t.status = "failed"
            await session.commit()
        for task_id, git in interrupted:
            await cleanup_interrupted(task_id, git)
            await self.emit_event(
                task_id, "error", {"message": tr("انقطعت المهمة لأن التطبيق انسكّر وهي شغّالة.")}
            )
        for task in queued:
            isolated = bool(task.git and task.git.get("planned") == "worktree")
            self.enqueue(task.id, task.working_dir, task.paths, task.depends_on, isolated=isolated)

    async def cancel(self, task_id: str) -> bool:
        running = self._running.get(task_id)
        if running is not None:
            running.cancel()
            return True
        # Not running yet: take it out of line and mark it.
        self._drop(task_id)
        self._poke()
        async with SessionLocal() as session:
            task = await session.get(Task, task_id)
            if task and task.status == "queued":
                task.status = "cancelled"
                await session.commit()
                await self._broadcast(task_id, {"kind": "status", "status": "cancelled"})
                return True
        return False

    # ---- live updates --------------------------------------------------------------------

    async def subscribe(self, task_id: str, ws: WebSocket) -> None:
        self._subscribers.setdefault(task_id, set()).add(ws)

    def unsubscribe(self, task_id: str, ws: WebSocket) -> None:
        self._subscribers.get(task_id, set()).discard(ws)

    async def _broadcast(self, task_id: str, message: dict[str, Any]) -> None:
        for ws in list(self._subscribers.get(task_id, set())):
            try:
                await ws.send_text(json.dumps(message, ensure_ascii=False, default=str))
            except Exception:
                self.unsubscribe(task_id, ws)

    async def emit_event(self, task_id: str, event_type: str, payload: dict[str, Any]) -> TaskEvent:
        async with SessionLocal() as session:
            event = TaskEvent(task_id=task_id, type=event_type, payload=payload)
            session.add(event)
            await session.commit()
            await session.refresh(event)
        await self._broadcast(
            task_id,
            {
                "kind": "event",
                "event": {
                    "id": event.id,
                    "type": event.type,
                    "payload": event.payload,
                    "created_at": event.created_at.isoformat(),
                },
            },
        )
        return event

    async def update_event_payload(self, task_id: str, event_id: str, payload: dict[str, Any]) -> None:
        async with SessionLocal() as session:
            event = await session.get(TaskEvent, event_id)
            if not event:
                return
            event.payload = payload
            await session.commit()
        await self._broadcast(
            task_id,
            {"kind": "event_updated", "event": {"id": event_id, "type": event.type, "payload": payload}},
        )

    async def set_status(self, task_id: str, status: str) -> None:
        async with SessionLocal() as session:
            task = await session.get(Task, task_id)
            if task:
                task.status = status
                await session.commit()
        await self._broadcast(task_id, {"kind": "status", "status": status})

    # ---- permissions ---------------------------------------------------------------------

    def await_permission(self, task_id: str, event_id: str) -> asyncio.Future[str]:
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending_permissions[event_id] = future
        self._pending_by_task.setdefault(task_id, set()).add(event_id)
        future.add_done_callback(lambda _: self._pending_by_task.get(task_id, set()).discard(event_id))
        return future

    def resolve_permission(self, event_id: str, resolution: str) -> bool:
        future = self._pending_permissions.pop(event_id, None)
        if future and not future.done():
            future.set_result(resolution)
            return True
        return False

    def needs_approval(self, task_id: str) -> bool:
        return bool(self._pending_by_task.get(task_id))


manager = TaskManager()
