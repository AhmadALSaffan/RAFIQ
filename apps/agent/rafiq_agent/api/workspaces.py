"""Workspaces: a project's folder, preferred model and standing instructions in one place.

Chats, tasks and designs carry a `workspace_id`; the app filters by it and new sessions
inherit the folder and model. Deleting a workspace leaves its sessions in place, just
unassigned.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from rafiq_agent.api.deps import require_token
from rafiq_agent.core.tasks_service import TaskCreateError, resolve_working_dir
from rafiq_agent.storage.db import get_session
from rafiq_agent.storage.models import Chat, Design, Task, Workspace

router = APIRouter(prefix="/workspaces", tags=["workspaces"], dependencies=[Depends(require_token)])


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    working_dir: str | None = None
    model_id: str | None = None
    instructions: str | None = Field(default=None, max_length=8000)
    color: str | None = Field(default=None, max_length=16)


class WorkspaceOut(WorkspaceIn):
    id: str
    created_at: datetime
    chats: int = 0
    tasks: int = 0
    designs: int = 0

    model_config = {"from_attributes": True}


def _folder(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        directory = resolve_working_dir(raw)
    except TaskCreateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return str(directory) if directory else None


async def _counts(session: AsyncSession) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for model, key in ((Chat, "chats"), (Task, "tasks"), (Design, "designs")):
        rows = await session.execute(
            select(model.workspace_id, func.count()).where(model.workspace_id.is_not(None)).group_by(model.workspace_id)
        )
        for workspace_id, count in rows.all():
            out.setdefault(workspace_id, {})[key] = int(count)
    return out


def _out(row: Workspace, counts: dict[str, int]) -> WorkspaceOut:
    return WorkspaceOut(
        id=row.id,
        name=row.name,
        working_dir=row.working_dir,
        model_id=row.model_id,
        instructions=row.instructions,
        color=row.color,
        created_at=row.created_at,
        chats=counts.get("chats", 0),
        tasks=counts.get("tasks", 0),
        designs=counts.get("designs", 0),
    )


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(session: AsyncSession = Depends(get_session)) -> list[WorkspaceOut]:
    rows = (await session.execute(select(Workspace).order_by(Workspace.created_at))).scalars().all()
    counts = await _counts(session)
    return [_out(row, counts.get(row.id, {})) for row in rows]


@router.post("", response_model=WorkspaceOut, status_code=201)
async def create_workspace(body: WorkspaceIn, session: AsyncSession = Depends(get_session)) -> WorkspaceOut:
    row = Workspace(
        name=body.name.strip(),
        working_dir=_folder(body.working_dir),
        model_id=body.model_id or None,
        instructions=(body.instructions or "").strip() or None,
        color=body.color or None,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _out(row, {})


@router.put("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(workspace_id: str, body: WorkspaceIn, session: AsyncSession = Depends(get_session)) -> WorkspaceOut:
    row = await session.get(Workspace, workspace_id)
    if not row:
        raise HTTPException(status_code=404, detail="workspace not found")
    row.name = body.name.strip()
    row.working_dir = _folder(body.working_dir)
    row.model_id = body.model_id or None
    row.instructions = (body.instructions or "").strip() or None
    row.color = body.color or None
    await session.commit()
    await session.refresh(row)
    return _out(row, (await _counts(session)).get(row.id, {}))


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(workspace_id: str, session: AsyncSession = Depends(get_session)) -> None:
    row = await session.get(Workspace, workspace_id)
    if not row:
        return
    # Its sessions stay; they just stop belonging to anything.
    for model in (Chat, Task, Design):
        await session.execute(update(model).where(model.workspace_id == workspace_id).values(workspace_id=None))
    await session.delete(row)
    await session.commit()


async def workspace_note(workspace_id: str | None) -> str:
    """The standing instructions of a workspace, for the system prompt."""
    if not workspace_id:
        return ""
    from rafiq_agent.storage.db import SessionLocal

    async with SessionLocal() as session:
        row = await session.get(Workspace, workspace_id)
    if not row or not row.instructions:
        return ""
    return f"تعليمات مساحة العمل «{row.name}»:\n{row.instructions}"
