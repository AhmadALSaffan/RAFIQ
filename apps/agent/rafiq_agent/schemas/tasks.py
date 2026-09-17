from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

TaskStatus = Literal["queued", "pending", "running", "planned", "completed", "failed", "cancelled"]
# "auto" runs straight through; "plan" writes a plan and waits for approval; "step" asks
# before every write or command.
TaskMode = Literal["auto", "plan", "step"]


class TaskCreate(BaseModel):
    title: str
    prompt: str
    model_id: str
    working_dir: str | None = None
    attachment_ids: list[str] = []
    mode: TaskMode = "auto"
    workspace_id: str | None = None


class TaskPlanIn(BaseModel):
    # The plan as the user edited it; None keeps the model's.
    plan: str | None = None


class CommitIn(BaseModel):
    message: str


class CommitOut(BaseModel):
    sha: str
    files: int


class DescribeOut(BaseModel):
    commit_message: str
    pr_title: str
    pr_body: str


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
    mode: str = "auto"
    plan: str | None = None
    workspace_id: str | None = None
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
