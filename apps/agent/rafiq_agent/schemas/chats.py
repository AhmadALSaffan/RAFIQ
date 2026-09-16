"""Request and response shapes for the chat endpoints.

Split out from the routes so the service layer can depend on the schemas without importing
FastAPI routing, and so the contract with the desktop app is readable in one file.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


class ChatCreate(BaseModel):
    model_id: str | None = None
    working_dir: str | None = None


class ReplySettings(BaseModel):
    """How this chat's replies are generated. Every field maps to a real request knob."""

    length: str = "balanced"  # short | balanced | detailed
    language: str = "auto"  # auto | ar | en | ru
    temperature: float | None = None  # None = the provider's own default
    tools: bool = True  # off = don't send tool schemas at all (cheaper, read-only chat)
    reasoning: bool = True  # off = ask thinking models to skip it, and never show it
    reasoning_effort: str | None = None  # low | medium | high, when the model supports it
    auto_summarize: bool = True  # fold old turns into the summary once the chat gets long

    model_config = {"extra": "ignore"}


DEFAULT_REPLY_SETTINGS = ReplySettings()
# Once the history passes this many messages, auto-summarising trims it on the next send.
AUTO_SUMMARIZE_AFTER = 30
AUTO_SUMMARIZE_KEEP = 8


class ChatUpdate(BaseModel):
    title: str | None = None
    model_id: str | None = None
    pinned: bool | None = None
    working_dir: str | None = None  # "" clears the folder
    settings: ReplySettings | None = None


class ChatFork(BaseModel):
    """Copy the chat up to this message (None = all of it)."""

    until_message_id: str | None = None


class MessageCreate(BaseModel):
    content: str
    model_id: str
    attachment_ids: list[str] = []


class ChatMessageOut(BaseModel):
    id: str
    role: str
    content: str
    reasoning: str | None = None
    model_id: str | None = None
    parts: list[dict[str, Any]] | None = None
    attachments: list[dict[str, Any]] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSummaryOut(BaseModel):
    id: str
    title: str
    model_id: str | None
    working_dir: str | None = None
    settings: ReplySettings = DEFAULT_REPLY_SETTINGS
    summary: str | None = None
    summary_until: str | None = None
    pinned: bool = False
    message_count: int = 0
    # A reply is being written right now (the page can reattach to it).
    streaming: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("settings", mode="before")
    @classmethod
    def _fill_settings(cls, value: Any) -> Any:
        # Chats created before reply settings existed store NULL.
        return value or DEFAULT_REPLY_SETTINGS


class ChatDetailOut(ChatSummaryOut):
    messages: list[ChatMessageOut] = []


class SummarizeIn(BaseModel):
    model_id: str | None = None
    keep: int = 4  # recent messages left untouched


class SummarizeOut(BaseModel):
    summary: str
    summary_until: str
    folded_messages: int
    approx_tokens_before: int
    approx_tokens_after: int
