from typing import Literal

from pydantic import BaseModel, Field

PermissionMode = Literal["auto", "ask", "deny"]

PermissionKey = Literal[
    "filesystem_write",
    "shell",
    "process",
    "browser_navigate",
    "desktop_control",
    "issue_write",
    "mcp",
    "memory",
]

DEFAULT_PERMISSIONS: dict[PermissionKey, PermissionMode] = {
    "filesystem_write": "ask",
    "shell": "ask",
    "process": "ask",
    "browser_navigate": "ask",
    "desktop_control": "ask",
    "issue_write": "ask",
    "mcp": "ask",
    "memory": "ask",
}

WebSearchProvider = Literal["none", "brave", "tavily", "searxng"]


class AppSettings(BaseModel):
    permissions: dict[PermissionKey, PermissionMode] = DEFAULT_PERMISSIONS
    desktop_control_enabled: bool = False
    # How many tasks may run at once (tasks that would edit the same files still take turns).
    max_parallel_tasks: int = Field(default=100, ge=1, le=100)
    # Requests to one provider credential in flight at once; the rest wait instead of
    # collecting rate-limit errors.
    provider_concurrency: int = Field(default=6, ge=1, le=50)
    # Tasks on a git repository work in their own worktree, so they can all run at once.
    task_isolation: bool = True
    # The model that carries out tasks a chat creates (None = the chat's own model) — plan
    # with a strong model, execute with a fast, cheaper one.
    task_model_id: str | None = None
    # Rafiq's own housekeeping — folding a long chat into a summary, writing a commit
    # message from a diff — runs on this model instead of the expensive one you chat with.
    helper_model_id: str | None = None
    # Which service answers `web_search` ("none" = the tool is off). Keys live in the keychain.
    web_search_provider: WebSearchProvider = "none"
    searxng_url: str | None = None
    # The browser tool opens a visible Edge window (off = it works headless).
    browser_visible: bool = False
    # Closing the window keeps Rafiq running in the tray, so tasks and schedules go on.
    run_in_background: bool = True
    # Stop calling providers once this much has been spent today / this month (0 = no limit).
    daily_budget_usd: float = Field(default=0.0, ge=0)
    monthly_budget_usd: float = Field(default=0.0, ge=0)
    # Turns speech into text for the microphone in the composer (a Whisper-compatible model).
    transcribe_model: str = "whisper-1"
    # Rafiq keeps short facts the user asked it to remember (core/memory.py) and offers them
    # to every chat. Off = nothing remembered and nothing offered.
    memory_enabled: bool = True
    # What a new chat's "توفير التوكنز" starts at: on names the skills and lets the model
    # read the ones it wants, off describes every skill in every message. Off by default —
    # the skills are worth their tokens until the user says otherwise. Each chat can still
    # flip its own copy from /إعدادات.
    token_saver: bool = False

    def model_post_init(self, __context: object) -> None:
        # Settings saved before a permission existed get its default, not a validation error.
        self.permissions = {**DEFAULT_PERMISSIONS, **self.permissions}
