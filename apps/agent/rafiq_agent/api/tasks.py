import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import task_git
from rafiq_agent.core.manager import manager
from rafiq_agent.core.task_git import discard as discard_git
from rafiq_agent.core.tasks_service import TaskCreateError
from rafiq_agent.core.tasks_service import create_task as create_task_record
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.automation import TaskChangesOut
from rafiq_agent.schemas.tasks import TaskCreate, TaskDetailOut, TaskSummaryOut
from rafiq_agent.storage.db import SessionLocal, get_session
from rafiq_agent.storage.models import Task

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(require_token)])
# Browsers can't set custom headers on a WebSocket handshake, so the stream route lives
# on its own router (no header-based auth dependency) and checks the ?token= query param instead.
ws_router = APIRouter(prefix="/tasks", tags=["tasks"])


def _decorate(out: TaskSummaryOut, task: Task) -> TaskSummaryOut:
    out.needs_approval = manager.needs_approval(task.id)
    git = task.git or {}
    out.changes = git.get("state")
    out.isolated = git.get("planned") == "worktree" or git.get("mode") == "worktree"
    return out


def _summary(task: Task) -> TaskSummaryOut:
    return _decorate(TaskSummaryOut.model_validate(task), task)


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
    return _decorate(TaskDetailOut.model_validate(task), task)


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
    if manager.is_running(task_id):
        await manager.cancel(task_id)
        # Let the runtime unwind (it writes a final status) before the rows disappear.
        await asyncio.sleep(0.2)
    manager.forget(task_id)
    async with SessionLocal() as session:
        result = await session.execute(
            select(Task).where(Task.id == task_id).options(selectinload(Task.events))
        )
        task = result.scalar_one_or_none()
        if not task:
            raise HTTPException(status_code=404, detail="task not found")
        # Should it still start somehow, run_task finds no row and does nothing.
        git = task.git
        await session.delete(task)
        await session.commit()
    await discard_git(task_id, git)


@router.post("/{task_id}/cancel", status_code=202)
async def cancel_task(task_id: str) -> dict[str, bool]:
    return {"cancelled": await manager.cancel(task_id)}


async def _git_of(task_id: str) -> dict:
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="task not found")
        return dict(task.git or {})


@router.get("/{task_id}/changes", response_model=TaskChangesOut)
async def task_changes(task_id: str) -> TaskChangesOut:
    """What the task changed in its folder — when the folder is a git repository."""
    info = await _git_of(task_id)
    if not info.get("repo"):
        return TaskChangesOut(available=False, state=info.get("state"), error=info.get("error"))
    try:
        review = await task_git.review(info)
    except Exception as exc:  # noqa: BLE001 - e.g. the repository was moved or deleted
        return TaskChangesOut(available=False, mode=info.get("mode"), state=info.get("state"), error=str(exc))
    return TaskChangesOut(available=True, mode=info.get("mode"), state=info.get("state"), error=info.get("error"), **review)


@router.post("/{task_id}/changes/apply", response_model=TaskChangesOut)
async def apply_changes(task_id: str, three_way: bool = False) -> TaskChangesOut:
    info = await _git_of(task_id)
    if not info.get("result") or info.get("state") not in ("pending", "conflict", "reverted"):
        raise HTTPException(status_code=400, detail=tr("ما في تغييرات جاهزة للتطبيق."))
    try:
        await task_git.apply(task_id, info, three_way=three_way)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await task_changes(task_id)


@router.post("/{task_id}/changes/revert", response_model=TaskChangesOut)
async def revert_changes(task_id: str) -> TaskChangesOut:
    info = await _git_of(task_id)
    if not info.get("result") or info.get("state") != "applied":
        raise HTTPException(status_code=400, detail=tr("ما في تغييرات مطبّقة لأرجّعها."))
    if not await task_git.revert(task_id, info):
        raise HTTPException(
            status_code=409,
            detail=tr("ما قدرت أرجّع التغييرات لأن نفس الأماكن تعدّلت بعدها. رجّعها يدوياً أو من git."),
        )
    return await task_changes(task_id)


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
