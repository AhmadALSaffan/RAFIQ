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
    workspace_id: str | None = None


class ReplySettings(BaseModel):
    """How this chat's replies are generated. Every field maps to a real request knob."""

    length: str = "balanced"  # short | balanced | detailed
    language: str = "auto"  # auto | ar | en | ru
    temperature: float | None = None  # None = the provider's own default
    tools: bool = True  # off = don't send tool schemas at all (cheaper, read-only chat)
    # Whether this chat's model gets Rafiq's search tool. None = decide by the model: one
    # that searches the web itself (Copilot) uses its own, anything else gets Rafiq's.
    # True forces Rafiq's even on a model that has its own; False switches search off.
    web_search: bool | None = None
    reasoning: bool = True  # off = ask thinking models to skip it, and never show it
    reasoning_effort: str | None = None  # low | medium | high, when the model supports it
    auto_summarize: bool = True  # fold old turns into the summary once the chat gets long
    # The two heaviest tool groups, switchable per chat: MCP servers can add dozens of
    # schemas and the browser adds six, and most chats use neither.
    mcp: bool = True
    browser: bool = True
    # One switch for a cheap turn: no tools, no thinking, a short answer. What the model is
    # *told* shrinks to one system line and the conversation itself.
    economy: bool = False
    # Token saving. On: the skills are named and the model reads the ones it wants with
    # skill_list / skill_read. Off: every skill is described in the prompt, every time —
    # which is what you want when the skills themselves are the point of the chat, and so
    # what a new chat starts with unless Settings → التكلفة says otherwise.
    saver: bool = False

    model_config = {"extra": "ignore"}


DEFAULT_REPLY_SETTINGS = ReplySettings()
# Auto-summarising trims the history on the next send once it passes either line: enough
# messages, or enough weight in them. Tokens decide first — ten long messages cost more
# than thirty short ones.
AUTO_SUMMARIZE_AFTER = 30
AUTO_SUMMARIZE_TOKENS = 12_000
AUTO_SUMMARIZE_KEEP = 8


class ChatUpdate(BaseModel):
    title: str | None = None
    model_id: str | None = None
    pinned: bool | None = None
    # True archives the chat (and unpins it: a pinned chat nobody sees is a contradiction);
    # False brings it back to the list.
    archived: bool | None = None
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
    workspace_id: str | None = None
    working_dir: str | None = None
    settings: ReplySettings = DEFAULT_REPLY_SETTINGS
    summary: str | None = None
    summary_until: str | None = None
    pinned: bool = False
    archived_at: datetime | None = None
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


class SearchSnippetOut(BaseModel):
    message_id: str
    role: str
    text: str
    # [start, end) of each matched word inside `text`.
    marks: list[tuple[int, int]]


class ChatSearchOut(BaseModel):
    """One chat that matched a search: why, and the best place it matched."""

    chat_id: str
    title: str
    updated_at: datetime
    pinned: bool
    title_match: bool
    # Archived chats are still found; the list marks them.
    archived: bool = False
    # Messages in this chat containing every word of the search (up to the search's cap).
    matches: int
    snippet: SearchSnippetOut | None = None


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
