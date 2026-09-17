import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from rafiq_agent.api.deps import require_token
from rafiq_agent.config import AUTH_TOKEN
from rafiq_agent.core import gitops, task_git
from rafiq_agent.core.git_describe import describe_changes
from rafiq_agent.core.manager import manager
from rafiq_agent.core.task_git import discard as discard_git
from rafiq_agent.core.tasks_service import TaskCreateError
from rafiq_agent.core.tasks_service import create_task as create_task_record
from rafiq_agent.i18n import tr
from rafiq_agent.schemas.automation import TaskChangesOut
from rafiq_agent.schemas.tasks import (
    CommitIn,
    CommitOut,
    DescribeOut,
    TaskCreate,
    TaskDetailOut,
    TaskPlanIn,
    TaskSummaryOut,
)
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
async def list_tasks(
    workspace_id: str | None = Query(None), session: AsyncSession = Depends(get_session)
) -> list[TaskSummaryOut]:
    query = select(Task).order_by(Task.created_at.desc())
    if workspace_id:
        query = query.where(Task.workspace_id == workspace_id)
    result = await session.execute(query)
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
            mode=body.mode,
            workspace_id=body.workspace_id,
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


async def _planned(task_id: str) -> Task:
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.status != "planned":
        raise HTTPException(status_code=400, detail=tr("هالمهمة مش بانتظار موافقة على خطة."))
    return task


@router.post("/{task_id}/plan/approve", response_model=TaskSummaryOut)
async def approve_plan(task_id: str, body: TaskPlanIn) -> TaskSummaryOut:
    """The user approved (maybe edited) the plan: the task goes back in line and runs it."""
    await _planned(task_id)
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        assert task is not None
        if body.plan and body.plan.strip():
            task.plan = body.plan.strip()
        task.status = "queued"
        await session.commit()
        await session.refresh(task)
        out = _summary(task)
    await manager.emit_event(task_id, "plan_approved", {"text": task.plan or ""})
    manager.enqueue(
        task.id, task.working_dir, task.paths, task.depends_on, isolated=bool((task.git or {}).get("planned"))
    )
    return out


@router.post("/{task_id}/plan/reject", response_model=TaskSummaryOut)
async def reject_plan(task_id: str) -> TaskSummaryOut:
    await _planned(task_id)
    await manager.set_status(task_id, "cancelled")
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        assert task is not None
        return _summary(task)


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


async def _committable(task_id: str) -> tuple[dict, list[str]]:
    info = await _git_of(task_id)
    if not info.get("repo") or info.get("state") != "applied":
        raise HTTPException(status_code=400, detail=tr("ما في تغييرات مطبّقة بالمجلد لأعمل لها commit."))
    review = await task_git.review(info)
    files = [f["path"] for f in review.get("files", [])]
    if not files:
        raise HTTPException(status_code=400, detail=tr("ما في ملفات متغيّرة."))
    return info, files


@router.post("/{task_id}/changes/describe", response_model=DescribeOut)
async def describe_task_changes(task_id: str) -> DescribeOut:
    """A commit message and a pull-request description for the task's changes, written by
    the task's model from the diff."""
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    info, _ = await _committable(task_id)
    review = await task_git.review(info)
    try:
        return DescribeOut(**await describe_changes(task.model_id, task.title, task.prompt, review["diff"]))
    except Exception as exc:  # noqa: BLE001 - the model's failure is the answer
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{task_id}/changes/commit", response_model=CommitOut)
async def commit_task_changes(task_id: str, body: CommitIn) -> CommitOut:
    """Commits the task's applied changes (only its files) on the user's current branch."""
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail=tr("اكتب رسالة للـ commit."))
    info, files = await _committable(task_id)
    try:
        sha = await gitops.commit_paths(Path(info["repo"]), files, message)
    except gitops.GitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    async with SessionLocal() as session:
        task = await session.get(Task, task_id)
        if task is not None:
            git = dict(task.git or {})
            git["committed"] = sha
            task.git = git
            await session.commit()
    return CommitOut(sha=sha, files=len(files))


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
