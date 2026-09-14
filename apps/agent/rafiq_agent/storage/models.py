import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
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
    status: Mapped[str] = mapped_column(String, default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    events: Mapped[list["TaskEvent"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskEvent.created_at"
    )


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
    # The latest self-contained HTML document, rendered in the preview pane.
    preview_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    chat_id: Mapped[str] = mapped_column(String)
    model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Where the user wants the design saved; every new preview is written here as .html.
    working_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    saved_path: Mapped[str | None] = mapped_column(String, nullable=True)
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
