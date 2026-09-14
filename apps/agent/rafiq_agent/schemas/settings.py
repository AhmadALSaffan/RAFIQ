from typing import Literal

from pydantic import BaseModel

PermissionMode = Literal["auto", "ask", "deny"]

PermissionKey = Literal[
    "filesystem_write",
    "shell",
    "process",
    "browser_navigate",
    "desktop_control",
    "issue_write",
]

DEFAULT_PERMISSIONS: dict[PermissionKey, PermissionMode] = {
    "filesystem_write": "ask",
    "shell": "ask",
    "process": "ask",
    "browser_navigate": "ask",
    "desktop_control": "ask",
    "issue_write": "ask",
}


class AppSettings(BaseModel):
    permissions: dict[PermissionKey, PermissionMode] = DEFAULT_PERMISSIONS
    desktop_control_enabled: bool = False
