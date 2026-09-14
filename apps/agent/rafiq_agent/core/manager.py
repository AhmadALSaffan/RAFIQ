import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select

from rafiq_agent.i18n import tr
from rafiq_agent.storage.db import SessionLocal
from rafiq_agent.storage.models import Task, TaskEvent


class TaskManager:
    """Runs queued tasks one at a time, persists their transcripts, fans events out to
    WebSocket subscribers, and brokers permission approve/deny between runtime and UI."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._current_task_id: str | None = None
        self._current_asyncio_task: asyncio.Task | None = None
        self._subscribers: dict[str, set[WebSocket]] = {}
        self._pending_permissions: dict[str, asyncio.Future[str]] = {}
        self._pending_by_task: dict[str, set[str]] = {}

    # ---- queue ---------------------------------------------------------------------------

    def start(self, runner: Callable[[str], Awaitable[None]]) -> None:
        if self._worker is None:
            self._worker = asyncio.create_task(self._work(runner))

    async def _work(self, runner: Callable[[str], Awaitable[None]]) -> None:
        while True:
            task_id = await self._queue.get()
            self._current_task_id = task_id
            self._current_asyncio_task = asyncio.create_task(runner(task_id))
            try:
                await self._current_asyncio_task
            except asyncio.CancelledError:
                if self._worker is not None and self._worker.cancelling():
                    raise  # the worker itself is shutting down
            except Exception:  # noqa: BLE001 - one broken task must not stop the queue
                pass
            finally:
                self._pending_by_task.pop(task_id, None)
                self._current_task_id = None
                self._current_asyncio_task = None

    def enqueue(self, task_id: str) -> None:
        self._queue.put_nowait(task_id)

    @property
    def current_task_id(self) -> str | None:
        return self._current_task_id

    async def recover(self) -> None:
        """After a restart: tasks that were mid-run are lost; still-queued ones go back in line."""
        async with SessionLocal() as session:
            rows = (await session.execute(select(Task).order_by(Task.created_at))).scalars().all()
            interrupted = [t.id for t in rows if t.status in ("running", "pending")]
            queued = [t.id for t in rows if t.status == "queued"]
            for t in rows:
                if t.id in interrupted:
                    t.status = "failed"
            await session.commit()
        for task_id in interrupted:
            await self.emit_event(
                task_id, "error", {"message": tr("انقطعت المهمة لأن التطبيق انسكّر وهي شغّالة.")}
            )
        for task_id in queued:
            self.enqueue(task_id)

    async def cancel(self, task_id: str) -> bool:
        if self._current_task_id == task_id and self._current_asyncio_task:
            self._current_asyncio_task.cancel()
            return True
        # Not running yet: mark it so the worker skips it when its turn comes.
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
