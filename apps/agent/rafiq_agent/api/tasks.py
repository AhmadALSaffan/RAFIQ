import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core.manager import manager
from rafiq_agent.core.tasks_service import TaskCreateError
from rafiq_agent.core.tasks_service import create_task as create_task_record
from rafiq_agent.schemas.tasks import TaskCreate, TaskDetailOut, TaskSummaryOut
from rafiq_agent.storage.db import SessionLocal, get_session
from rafiq_agent.storage.models import Task

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_token)])
# Browsers can't set custom headers on a WebSocket handshake, so the stream route lives
# on its own router (no header-based auth dependency) and checks the ?token= query param instead.
ws_router = APIRouter(prefix="/tasks", tags=["tasks"])


def _summary(task: Task) -> TaskSummaryOut:
    out = TaskSummaryOut.model_validate(task)
    out.needs_approval = manager.needs_approval(task.id)
    return out


@router.get("", response_model=list[TaskSummaryOut])
async def list_tasks(session: AsyncSession = Depends(get_session)) -> list[TaskSummaryOut]:
    result = await session.execute(select(Task).order_by(Task.created_at.desc()))
    return [_summary(t) for t in result.scalars().all()]


@router.get("/{task_id}", response_model=TaskDetailOut)
async def get_task(task_id: str, session: AsyncSession = Depends(get_session)) -> TaskDetailOut:
    result = await session.execute(select(Task).where(Task.id == task_id).options(selectinload(Task.events)))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    out = TaskDetailOut.model_validate(task)
    out.needs_approval = manager.needs_approval(task.id)
    return out


@router.post("", response_model=TaskDetailOut, status_code=201)
async def create_task(body: TaskCreate) -> TaskDetailOut:
    try:
        task = await create_task_record(
            title=body.title,
            prompt=body.prompt,
            model_id=body.model_id,
            working_dir=body.working_dir,
            attachment_ids=body.attachment_ids,
        )
    except TaskCreateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return TaskDetailOut(**TaskSummaryOut.model_validate(task).model_dump(), prompt=task.prompt, events=[])


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str) -> None:
    if manager.current_task_id == task_id:
        await manager.cancel(task_id)
        # Let the runtime unwind (it writes a final status) before the rows disappear.
        await asyncio.sleep(0.2)
    async with SessionLocal() as session:
        result = await session.execute(
            select(Task).where(Task.id == task_id).options(selectinload(Task.events))
        )
        task = result.scalar_one_or_none()
        if not task:
            raise HTTPException(status_code=404, detail="task not found")
        # A queued task is skipped by the worker once its row is gone (run_task finds nothing).
        await session.delete(task)
        await session.commit()


@router.post("/{task_id}/cancel", status_code=202)
async def cancel_task(task_id: str) -> dict[str, bool]:
    return {"cancelled": await manager.cancel(task_id)}


@router.post("/{task_id}/permission", status_code=202)
async def resolve_permission(task_id: str, event_id: str, resolution: str) -> dict[str, bool]:
    if resolution not in ("approved", "denied"):
        raise HTTPException(status_code=400, detail="resolution must be 'approved' or 'denied'")
    return {"resolved": manager.resolve_permission(event_id, resolution)}


@ws_router.websocket("/{task_id}/stream")
async def stream_task(websocket: WebSocket, task_id: str, token: str = Query(...)) -> None:
    if token != AUTH_TOKEN:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await manager.subscribe(task_id, websocket)
    try:
        async with SessionLocal() as session:
            result = await session.execute(
                select(Task).where(Task.id == task_id).options(selectinload(Task.events))
            )
            task = result.scalar_one_or_none()
            if task:
                await websocket.send_json(
                    {
                        "kind": "snapshot",
                        "task": {
                            "id": task.id,
                            "status": task.status,
                            "events": [
                                {
                                    "id": e.id,
                                    "type": e.type,
                                    "payload": e.payload,
                                    "created_at": e.created_at.isoformat(),
                                }
                                for e in task.events
                            ],
                        },
                    }
                )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.unsubscribe(task_id, websocket)
