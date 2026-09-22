"""Shapes for backing up and restoring Rafiq's data (see core/backup.py)."""

from pydantic import BaseModel


class BackupPath(BaseModel):
    """A file on this computer, picked in the app's own save/open dialog."""

    path: str


class BackupCounts(BaseModel):
    chats: int = 0
    messages: int = 0
    tasks: int = 0
    models: int = 0
    memories: int = 0
    skills: int = 0
    attachments: int = 0


class BackupManifest(BaseModel):
    version: str
    created_at: str
    counts: BackupCounts

    model_config = {"extra": "ignore"}


class BackupSaved(BaseModel):
    path: str
    manifest: BackupManifest


class RestoreOut(BaseModel):
    manifest: BackupManifest
    # Where the data that was replaced went — restoring is undoable by restoring this.
    safety_copy: str
    # Models and connections whose key isn't in this computer's credential store: a backup
    # carries no secrets, so on a new computer these need their key entered again.
    missing_secrets: int
