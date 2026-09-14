"""Where Rafiq keeps work that has no folder of its own.

Before this, a task without a working directory ran in the user's home folder and a design
without one was never written to disk at all — so the output either scattered across
`C:\\Users\\<name>` or vanished with the session. Everything unhomed now lands under one
visible folder (Documents/Rafiq by default) in a subfolder named after the session.
"""

import os
import re
from pathlib import Path

from rafiq_agent.config import DATA_DIR

_BAD = re.compile(r"[^\w\u0600-\u06FF -]+", re.UNICODE)
_SPACES = re.compile(r"\s+")


def _default_root() -> Path:
    override = os.environ.get("RAFIQ_WORKSPACE_DIR")
    if override:
        return Path(override).expanduser()
    # Documents is where a person looks for their files; fall back to the data dir on a
    # machine without one.
    documents = Path.home() / "Documents"
    return (documents if documents.is_dir() else DATA_DIR) / "Rafiq"


def workspace_root() -> Path:
    """The base folder. Created on first use so an unused install stays clean."""
    root = _default_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def slugify(title: str, fallback: str = "session") -> str:
    cleaned = _SPACES.sub(" ", _BAD.sub(" ", title or "")).strip()
    cleaned = cleaned.replace(" ", "-")
    return cleaned[:50].strip("-") or fallback


def session_dir(kind: str, identifier: str, title: str = "") -> Path:
    """A folder for one chat / task / design, e.g. `…/Rafiq/tasks/ترتيب-الملفات-a1b2c3`.

    The id is part of the name so two sessions with the same title never collide, and so a
    folder can always be traced back to its session.
    """
    folder = workspace_root() / kind / f"{slugify(title, kind)}-{identifier[:6]}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder
