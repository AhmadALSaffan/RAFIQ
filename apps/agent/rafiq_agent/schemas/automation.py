"""Shapes for templates, schedules, MCP servers and task change review."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1)
    model_id: str | None = None
    working_dir: str | None = None


class TemplateImportIn(BaseModel):
    # Either a URL to a JSON file ({"templates": [...]}, or a bare list) or the items.
    url: str | None = None
    templates: list[TemplateIn] = []


class CatalogTemplate(BaseModel):
    name: str
    prompt: str
    tags: list[str] = []


class CatalogOut(BaseModel):
    source: str  # "remote" | "bundled"
    templates: list[CatalogTemplate]


class McpRequirementsOut(BaseModel):
    node: bool
    npx: bool
    uvx: bool
    python: bool
    docker: bool


class TemplateOut(TemplateIn):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}


ScheduleKind = Literal["interval", "daily", "weekly"]


class ScheduleIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1)
    model_id: str
    working_dir: str | None = None
    kind: ScheduleKind = "daily"
    every_minutes: int | None = Field(default=None, ge=5, le=60 * 24 * 7)
    at_time: str | None = None
    weekdays: list[int] | None = None
    enabled: bool = True


class ScheduleOut(ScheduleIn):
    id: str
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_task_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class McpServerIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    transport: Literal["stdio", "http"] = "stdio"
    command: str | None = None
    args: list[str] = []
    url: str | None = None
    # Secret values: sent in, never sent back. On update, an empty value keeps the saved one;
    # a key left out is removed.
    env: dict[str, str] = {}
    headers: dict[str, str] = {}
    enabled: bool = True
    auth: Literal["none", "oauth"] = "none"
    preset: str | None = None


class McpConnectOut(BaseModel):
    # The page the user must open to authorize (OAuth), or nothing when already connected.
    authorize_url: str | None = None
    connected: bool = False
    error: str | None = None


class McpStatus(BaseModel):
    connected: bool = False
    tools: list[str] = []
    error: str | None = None


class McpServerOut(BaseModel):
    id: str
    name: str
    transport: str
    command: str | None
    args: list[str]
    url: str | None
    enabled: bool
    secret_keys: list[str] = []
    auth: str = "none"
    preset: str | None = None
    # OAuth servers: the browser step is done (tokens on file).
    authorized: bool = False
    status: McpStatus = McpStatus()


class ChangedFile(BaseModel):
    path: str
    status: str
    additions: int
    deletions: int
    binary: bool = False


class TaskChangesOut(BaseModel):
    available: bool
    mode: str | None = None
    state: str | None = None
    error: str | None = None
    files: list[ChangedFile] = []
    diff: str = ""
    truncated: bool = False


class WebSearchKeys(BaseModel):
    brave: bool = False
    tavily: bool = False


class WebSearchKeyIn(BaseModel):
    provider: Literal["brave", "tavily"]
    key: str = ""

