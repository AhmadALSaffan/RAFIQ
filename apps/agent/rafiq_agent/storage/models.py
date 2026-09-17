import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(UTC)


class LlmModel(Base):
    __tablename__ = "llm_models"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String)
    provider: Mapped[str] = mapped_column(String)
    model_id: Mapped[str] = mapped_column(String)
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # Opaque reference into the OS keyring — never the raw key.
    api_key_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    verify_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    verify_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    verify_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    supports_tools: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # How this agent signs in: "api_key" (api_key_ref above) or "oauth" (a connected account).
    # Each model carries its own binding, so two agents never share or overwrite a login.
    auth_method: Mapped[str] = mapped_column(String, default="api_key")
    account_id: Mapped[str | None] = mapped_column(String, ForeignKey("auth_accounts.id"), nullable=True)
    # Loaded with the model so resolving credentials never needs a second query.
    account: Mapped["AuthAccount | None"] = relationship(lazy="joined")
    # Another agent to hand a request to when this one's provider keeps failing.
    fallback_model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Non-secret provider settings: Azure's API version, Bedrock's region, Vertex's project
    # and location (see llm/presets.py). Secrets stay in the keychain under api_key_ref.
    options: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AuthAccount(Base):
    """A signed-in provider account (e.g. a GitHub login used for Copilot).

    Only non-secret facts live here; the token itself is in the OS keychain under
    `secret_ref`. Disconnecting deletes the token but keeps the row while an agent still
    points at it, so reconnecting the same login brings those agents back.
    """

    __tablename__ = "auth_accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    provider: Mapped[str] = mapped_column(String)
    method: Mapped[str] = mapped_column(String, default="oauth")
    # The provider's stable user id and a human label (e.g. GitHub login) — never a secret.
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    label: Mapped[str] = mapped_column(String)
    secret_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="connected")  # connected | disconnected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    title: Mapped[str] = mapped_column(String)
    prompt: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str] = mapped_column(String, ForeignKey("llm_models.id"))
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    attachments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Where the task came from, e.g. {"chat_id": "..."} when a chat model created it.
    origin: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Scheduling: the paths (inside working_dir) the task will change — none means the whole
    # folder — and the tasks that must finish first. See core.manager.
    paths: Mapped[list | None] = mapped_column(JSON, nullable=True)
    depends_on: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Its git record: worktree / checkpoints and whether its changes were applied (core.task_git).
    git: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # How it runs: "auto" (as before), "plan" (write a plan first and wait for approval),
    # or "step" (every write or command asks, whatever the permission policy says).
    mode: Mapped[str] = mapped_column(String, default="auto")
    plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    events: Mapped[list["TaskEvent"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskEvent.created_at"
    )


class McpServer(Base):
    """An MCP server the user connected. Its env values and HTTP headers (tokens, usually)
    are secrets: they live in the keychain under `mcp:<id>`, never here."""

    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String)
    transport: Mapped[str] = mapped_column(String, default="stdio")  # "stdio" | "http"
    command: Mapped[str | None] = mapped_column(String, nullable=True)
    args: Mapped[list | None] = mapped_column(JSON, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    secret_keys: Mapped[list | None] = mapped_column(JSON, nullable=True)  # names only
    # "none" (headers/env carry any token) or "oauth" (the user authorizes in the browser;
    # tokens live in the keychain under mcp-oauth:<id>, see mcp_oauth.py).
    auth: Mapped[str] = mapped_column(String, default="none")
    # The catalogue entry it was made from (lib/mcpCatalog.ts), so the UI shows its logo
    # and hides the command line; None for a custom server.
    preset: Mapped[str | None] = mapped_column(String, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TaskTemplate(Base):
    """A task you run often, saved to start again in one click."""

    __tablename__ = "task_templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String)
    prompt: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Schedule(Base):
    """A task that starts on its own: every N minutes, daily at a time, or on chosen weekdays."""

    __tablename__ = "schedules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    title: Mapped[str] = mapped_column(String)
    prompt: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str] = mapped_column(String)
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    kind: Mapped[str] = mapped_column(String, default="daily")  # "interval" | "daily" | "weekly"
    every_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    at_time: Mapped[str | None] = mapped_column(String, nullable=True)  # "HH:MM", local time
    weekdays: Mapped[list | None] = mapped_column(JSON, nullable=True)  # 0 = Monday
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Memory(Base):
    """One thing the user asked Rafiq to keep in mind across chats (see core/memory.py)."""

    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    text: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String, default="fact")  # preference | project | fact
    source_chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Workspace(Base):
    """A project: its folder, the model it prefers, and standing instructions. Chats,
    tasks and designs can belong to one so the app can be filtered down to it."""

    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String)
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UsageRecord(Base):
    """One model call: how many tokens it took and what it cost.

    Written after every request so the app can show spending per day and per agent, and
    stop calling once the user's budget is used up.
    """

    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    # The agent this went through, when it's one the user configured.
    model_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str] = mapped_column(String)
    # What the call was for: "chat" | "task" | "design" | "other", and which one.
    scope: Mapped[str] = mapped_column(String, default="other")
    scope_id: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # Prompt tokens that were served from the provider's cache (cheaper, already counted above).
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)


class TaskEvent(Base):
    __tablename__ = "task_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"))
    type: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    task: Mapped[Task] = relationship(back_populates="events")


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    title: Mapped[str] = mapped_column(String)
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    # Per-chat reply settings (length / temperature / language / tools) — see schemas.chats.ReplySettings.
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Pinned chats sort above the rest, whatever their last-activity time.
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    # "chat" or "design" — a design chat runs with the design skills and system prompt.
    mode: Mapped[str] = mapped_column(String, default="chat")
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # A condensed stand-in for every message up to `summary_until`, so long chats stop
    # resending their whole history to the model.
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_until: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    chat_id: Mapped[str] = mapped_column(String, ForeignKey("chats.id"))
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Ordered text / tool / permission / task parts of an assistant reply, for display.
    parts: Mapped[list | None] = mapped_column(JSON, nullable=True)
    attachments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    chat: Mapped[Chat] = relationship(back_populates="messages")


class Design(Base):
    """A design session: the brief, the conversation behind it, and the latest preview."""

    __tablename__ = "designs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    title: Mapped[str] = mapped_column(String)
    # Answers from `impeccable init`, keyed by question id.
    brief: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # The model's written decisions (its reply with the HTML block stripped out).
    spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The document the preview opens on (the last one the model touched).
    preview_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Every document of this design: [{"name": …, "html": …, "path": …}]. A design usually
    # has one; a model that answers with a second screen adds to the list instead of
    # replacing it, and the preview lets the user switch (core/designs.py::merge_files).
    files: Mapped[list | None] = mapped_column(JSON, nullable=True)
    chat_id: Mapped[str] = mapped_column(String)
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Where the user wants the design saved; every new preview is written here as .html.
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    saved_path: Mapped[str | None] = mapped_column(String, nullable=True)
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="draft")  # draft | ready | handed_off
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class IntegrationAccount(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    provider: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    # Non-secret connection fields (site url, email, base url…). The credential itself
    # lives in the OS keychain; only its reference is stored here.
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    secret_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    account_label: Mapped[str | None] = mapped_column(String, nullable=True)
    verify_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    verify_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # image | text | pdf | binary
    size: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SettingsRow(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
