from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

TaskStatus = Literal["queued", "pending", "running", "completed", "failed", "cancelled"]


class TaskCreate(BaseModel):
    title: str
    prompt: str
    model_id: str
    working_dir: str | None = None
    attachment_ids: list[str] = []


class TaskEventOut(BaseModel):
    id: str
    type: str
    payload: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskSummaryOut(BaseModel):
    id: str
    title: str
    model_id: str
    working_dir: str | None = None
    attachments: list[dict[str, Any]] | None = None
    origin: dict[str, Any] | None = None
    status: TaskStatus
    needs_approval: bool = False
    # Its changes in git (core.task_git): "running" · "applied" · "pending" · "conflict" ·
    # "reverted" · "empty" · "error" — None when the folder isn't a repository.
    changes: str | None = None
    # Works in its own git worktree (planned or running).
    isolated: bool = False
    created_at: datetime
    # Last time anything moved on the task — the UI reads it as "finished at" once the
    # task is no longer running, which is how it shows how long a run took.
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskDetailOut(TaskSummaryOut):
    prompt: str
    events: list[TaskEventOut] = []
