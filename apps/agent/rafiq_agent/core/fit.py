"""Making the tools fit the model's window.

Every tool is described to the model on every message, and some groups are huge: ten MCP
servers can add 60,000 tokens of schemas — more than a local model reads in one request, and
a minute of prompt reading before the first word even when it fits. Two things keep that in
check:

- A local model starts from the lean groups (files, web, skills).
- Whatever the model, if the instructions and the tools take more than half of its window,
  the heaviest groups go, one at a time, until they fit; the chat or task says which.
"""

from __future__ import annotations

from collections.abc import Callable

from rafiq_agent.core.context import tokens, total_tokens
from rafiq_agent.i18n import tr

# What a local model gets unless the user asks for more: what most chats use.
LEAN_GROUPS = frozenset({"files", "web", "skills"})
# …and from those groups, the documents and notes tools stay out too: on a local model
# every schema is read again at a few dozen tokens a second (word/excel/slides alone are
# ~1,000 tokens).
LOCAL_SKIP = frozenset({
    "word_write", "slides_write", "excel_read", "excel_write", "image_view",
    "notes_list", "note_read", "note_create", "note_edit",
})
# Instructions + tool schemas may take this share of the window; the rest is the conversation
# and the reply.
SHARE = 0.5

DROP_ORDER: list[tuple[str, Callable[[str], bool]]] = [
    ("mcp", lambda n: n.startswith("mcp__")),
    ("browser", lambda n: n.startswith("browser_")),
    ("desktop", lambda n: n.startswith("desktop_")),
    ("issues", lambda n: n.startswith("issue_")),
    ("admin", lambda n: n in {"design_start", "motion_start", "task_list", "task_cancel"} or n.startswith("schedule_")),
    ("web", lambda n: n.startswith("web_")),
    ("skills", lambda n: n.startswith("skill_")),
    ("all", lambda n: True),
]


def _label(group: str) -> str:
    return {
        "mcp": tr("خوادم MCP"),
        "browser": tr("المتصفح"),
        "desktop": tr("التحكم بالشاشة"),
        "issues": tr("المتتبّعات"),
        "admin": tr("إدارة المهام والتصاميم"),
        "web": tr("البحث بالنت"),
        "skills": tr("المهارات"),
        "all": tr("كل الأدوات"),
    }[group]


def fit_tools(registry, instructions: str, window: int, share: float = SHARE) -> list[str]:
    """Drops tool groups, heaviest first, until the instructions and the schemas fit `share`
    of the window. Returns the groups dropped (empty when everything fit)."""
    budget = int(window * share)
    base = tokens(instructions)
    dropped: list[str] = []
    for group, belongs in DROP_ORDER:
        if base + total_tokens([], registry.schemas()) <= budget:
            break
        names = [n for n in registry.names() if belongs(n)]
        if names:
            registry.drop(names)
            dropped.append(group)
    return dropped


def trimmed_note(dropped: list[str], window: int) -> str:
    return tr(
        "خفّفت الأدوات لأن ذاكرة الموديل ({0} توكن) ما بتتسع لوصفها كلها: شلت {1}.",
        f"{window:,}",
        "، ".join(_label(g) for g in dropped),
    )
