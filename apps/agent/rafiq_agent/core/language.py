"""The language a reply has to be in — decided here, not left to the model.

"Answer in the user's language" in the system prompt isn't enough: the prompt itself is in
Arabic, and a small model that sees a short Russian message under it answers in Arabic. So
every message the model gets carries one explicit line: the language of that message (by its
letters: Arabic, Cyrillic or Latin), or, when it has no letters to go by (a number, an emoji,
a file), the language of the app's interface. A language the user picked for the chat wins
over both.

The line is added to what the model reads, never to the stored message.
"""

from __future__ import annotations

import re
from typing import Any

ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
CYRILLIC = re.compile(r"[Ѐ-ӿ]")
LATIN = re.compile(r"[A-Za-zÀ-ɏ]")
# What isn't the user's own writing: code, links, file paths, @mentions.
NOT_PROSE = re.compile(r"```.*?```|`[^`]*`|https?://\S+|[\w.-]*[\\/][\w./\\-]+|@\S+", re.S)

NAMES = {"ar": "Arabic", "en": "English", "ru": "Russian"}


def detect(text: str) -> str | None:
    """"ar", "ru", "latin" (English or another Latin-script language), or None when the text
    has too few letters to tell."""
    prose = NOT_PROSE.sub(" ", text or "")
    counts = {
        "ar": len(ARABIC.findall(prose)),
        "ru": len(CYRILLIC.findall(prose)),
        "latin": len(LATIN.findall(prose)),
    }
    if sum(counts.values()) < 2:
        return None
    # Arabic or Russian with a few English words in it (a product name) is still Arabic or
    # Russian: those scripts win over Latin unless Latin clearly dominates.
    script = max(counts, key=lambda k: counts[k] * (1 if k == "latin" else 1.5))
    return script


def reply_language(text: str, interface: str | None, chosen: str | None = None) -> str:
    """"ar", "en", "ru" or "latin" — what the reply to `text` must be written in."""
    if chosen in NAMES:
        return chosen
    found = detect(text)
    if found:
        return found
    return interface if interface in NAMES else "ar"


def instruction(language: str) -> str:
    if language == "latin":
        return (
            "[Reply in the same language this message is written in. Do not answer in Arabic or "
            "any other language unless asked to.]"
        )
    name = NAMES[language]
    return f"[Reply in {name} — the language of this message. Write the whole reply in {name}; do not switch languages.]"


def with_instruction(content: Any, language: str) -> Any:
    """The user's message as the model reads it: the same, plus the language line."""
    note = instruction(language)
    if isinstance(content, str):
        return f"{content}\n\n{note}" if content else note
    if isinstance(content, list):
        return [*content, {"type": "text", "text": note}]
    return content
