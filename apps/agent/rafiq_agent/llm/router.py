"""The smart route: a simple question goes to the cheap model the user picked; real work stays
with the model they chose. Decided by plain rules, never by a model call, so deciding costs
nothing and the reply says who answered.

When in doubt it stays with the strong model: a wrong "simple" gives a poor answer, a wrong
"heavy" only costs what the user already agreed to pay.
"""

from __future__ import annotations

import re
from typing import Any

MAX_SIMPLE_CHARS = 240
# A request to do something, not a question. Prefix matches, in the folded forms people write.
_WORK = re.compile(
    r"(^|\s)(?:و|ف)?(?:اعمل|اعملي|ابني|ابن|صلح|صلّح|عدل|عدّل|غير|غيّر|احذف|امسح|شغل|شغّل|ركب|ثبت|نزل|ارفع|انشر|رتب|رتّب|انقل|"
    r"حلل|حلّل|راجع|برمج|طور|طوّر|صمم|صمّم|لخص|لخّص|ترجم|اكتب|اكتبلي|اقرأ|افتح|دور|دوّر|"
    r"build|fix|create|write|edit|run|delete|deploy|refactor|implement|debug|install|analy[sz]e|review|summari[sz]e|translate|design|generate)",
    re.IGNORECASE,
)
# Carrying on from the last reply: only the model that wrote it should pick that up.
_FOLLOW_UP = re.compile(r"^\s*(?:كمل|كمّل|أكمل|اكمل|تابع|طيب|تمام|اوكي|نعم|ايوه|أيوه|لا|continue|go on|ok|okay|yes|no|do it)\b", re.IGNORECASE)
_TECHNICAL = re.compile(r"```|https?://|[\\/]\w+\.\w+|\b\w+\.(?:py|ts|tsx|js|json|md|pdf|docx|xlsx|csv)\b|^\s*[@/]", re.MULTILINE)


def is_simple(text: str, *, attachments: int = 0, used_tools_last: bool = False, has_folder: bool = False, mode: str = "chat") -> bool:
    """A short question that needs no tools, no files and no memory of the last turn's work."""
    text = text.strip()
    if not text or attachments or used_tools_last or has_folder or mode != "chat":
        return False
    if len(text) > MAX_SIMPLE_CHARS or len(text.splitlines()) > 3:
        return False
    return not (_WORK.search(text) or _FOLLOW_UP.match(text) or _TECHNICAL.search(text))


def used_tools(message: Any) -> bool:
    """Whether a stored reply did real work, so the next message is likely about that work."""
    return any(p.get("kind") in ("tool", "task", "studio") for p in (getattr(message, "parts", None) or []))
