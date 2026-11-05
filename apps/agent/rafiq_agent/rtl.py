"""Arabic in a terminal that can't do right-to-left (Windows Terminal, most others): it joins
the letters itself but lays the line out left to right, so Arabic reads backwards. Each line
Rafiq prints (repl.py, tui.py) is put in display order before it's printed, one line at a
time after wrapping, so it reads right; Arabic paragraphs and the line being typed sit right.

The letters are left for the terminal to join: Windows Terminal does it well, and the joined
"presentation forms" some tools print instead are drawn too wide in its font (س ش ص ض
covered their neighbours). RAFIQ_SHAPE=1 prints those forms anyway, for a terminal that
doesn't join letters at all (the old Windows console).

On by default on Windows, except in a JetBrains IDE's terminal, which does right-to-left
itself (reordering here too would reverse it twice); RAFIQ_BIDI=1 turns it on anywhere,
RAFIQ_BIDI=0 off.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any

ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
STRONG = re.compile(r"[A-Za-zÀ-ɏ؀-ۿݐ-ݿࢠ-ࣿ]")


def enabled() -> bool:
    flag = os.environ.get("RAFIQ_BIDI")
    if flag in ("0", "1"):
        return flag == "1"
    # Terminals that lay out right-to-left themselves: reordering here would reverse it twice.
    # JetBrains IDEs (IntelliJ, Android Studio…) say so in TERMINAL_EMULATOR.
    if os.environ.get("TERMINAL_EMULATOR", "").startswith("JetBrains"):
        return False
    return sys.platform == "win32"


# Left-to-right mark: zero width. At the start of a line that mixes a drawing and Arabic it
# keeps a terminal that does right-to-left from flipping the whole line (the drawing moved).
LRM = "‎"


def has_arabic(text: str) -> bool:
    return bool(ARABIC.search(text))


def is_rtl(text: str) -> bool:
    """The paragraph's direction: that of its first letter."""
    match = STRONG.search(text)
    return bool(match and ARABIC.match(match.group(0)))


def shaping() -> bool:
    return os.environ.get("RAFIQ_SHAPE") == "1"


# Lam with an alef after it is one glyph (لا). Reversed, the lam would meet the alef *before*
# it (the ال of الاختبارات) and the terminal would join those instead, so the pair is written
# as its ligature first: (isolated, final) forms for لا لأ لإ لآ.
LAM_ALEF = {"ا": ("ﻻ", "ﻼ"), "أ": ("ﻷ", "ﻸ"), "إ": ("ﻹ", "ﻺ"), "آ": ("ﻵ", "ﻶ")}
# Letters that don't join the letter after them (and anything that isn't a letter).
NO_LEFT_JOIN = set("اأإآدذرزوؤةءٱ")


def ligate(text: str) -> tuple[str, list[int]]:
    """The text with each lam-alef as one character, and where each original index went."""
    out: list[str] = []
    where: list[int] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "ل" and i + 1 < len(text) and text[i + 1] in LAM_ALEF:
            prev = text[i - 1] if i else ""
            joined = bool(prev) and ARABIC.match(prev) is not None and prev not in NO_LEFT_JOIN
            out.append(LAM_ALEF[text[i + 1]][1 if joined else 0])
            where += [len(out) - 1, len(out) - 1]
            i += 2
            continue
        out.append(ch)
        where.append(len(out) - 1)
        i += 1
    return "".join(out), where


def visual(line: str, rtl: bool | None = None) -> str:
    """One display line in display order (unchanged when it has no Arabic). The marks
    (shadda, fatha…) are left out: once a line is reversed, a terminal puts them on the wrong
    letter."""
    if not has_arabic(line):
        return line
    from bidi.algorithm import get_display

    direction = "R" if (is_rtl(line) if rtl is None else rtl) else "L"
    line = HARAKAT.sub("", line)
    if shaping():
        import arabic_reshaper

        line = arabic_reshaper.reshape(line)
    else:
        line = ligate(line)[0]
    return get_display(line, base_dir=direction)


LATIN_RUN = re.compile(r"[A-Za-z0-9À-ɏ]")
MIRROR = str.maketrans("()[]{}<>«»", ")(][}{><»«")


def _shape_same_length(text: str) -> str:
    """Joined letter forms, one for one (no ligatures, marks kept), so positions still map;
    only with RAFIQ_SHAPE=1 (the terminal joins the letters itself otherwise)."""
    if not shaping():
        return text
    import arabic_reshaper

    shaped = arabic_reshaper.ArabicReshaper(
        configuration={"delete_harakat": False, "support_ligatures": False}
    ).reshape(text)
    return shaped if len(shaped) == len(text) else text


HARAKAT = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")


def visual_map(text: str) -> tuple[str, list[int]]:
    """visual_map_plain without the marks (shadda, fatha…): a terminal can't place them once
    the line is reversed, so they're left out of the display and share their letter's column.
    The text itself keeps them."""
    if not has_arabic(text):
        return text, list(range(len(text) + 1))
    # Each source index → its place in the text without marks → in the ligated text.
    kept: list[str] = []
    to_kept: list[int] = []
    for ch in text:
        if HARAKAT.match(ch):
            to_kept.append(max(len(kept) - 1, 0))
        else:
            to_kept.append(len(kept))
            kept.append(ch)
    plain = "".join(kept)
    ligated, to_lig = ligate(plain) if not shaping() else (plain, list(range(len(plain))))
    visual, at_lig = visual_map_plain(ligated)
    at = [at_lig[to_lig[k]] if k < len(to_lig) else at_lig[-1] for k in to_kept]
    at.append(at_lig[len(ligated)])
    return visual, at


def visual_map_plain(text: str) -> tuple[str, list[int]]:
    """One line in display order with where each source position lands on screen.

    For the line being typed (repl.py): the cursor has to follow the text, so this keeps a
    map that get_display doesn't give. Right-to-left lines: the line is reversed, but each run
    of Latin letters and digits keeps its own order. Returns (visual, at) where at[i] is the
    display column of source index i, and at[len(text)] is where the cursor goes at the end."""
    n = len(text)
    if not has_arabic(text):
        return text, list(range(n + 1))
    rtl = is_rtl(text)
    shaped = _shape_same_length(text)
    # Units: a run of Latin (with the spaces inside it) stays together; everything else is a
    # unit of its own. A right-to-left line reverses the units; a left-to-right one reverses
    # each run of Arabic instead.
    units: list[list[int]] = []
    i = 0
    while i < n:
        if LATIN_RUN.match(text[i]):
            j = i + 1
            while j < n and (LATIN_RUN.match(text[j]) or (text[j] in " .-_/:" and j + 1 < n and LATIN_RUN.match(text[j + 1]))):
                j += 1
            units.append(list(range(i, j)))
            i = j
        else:
            units.append([i])
            i += 1
    if rtl:
        order = [idx for unit in reversed(units) for idx in unit]
    else:
        order, k = [], 0
        while k < len(units):
            if not LATIN_RUN.match(text[units[k][0]]) and ARABIC.match(text[units[k][0]]):
                m = k
                while m + 1 < len(units) and not LATIN_RUN.match(text[units[m + 1][0]]):
                    m += 1
                while m > k and not ARABIC.match(text[units[m][0]]):
                    m -= 1  # trailing spaces stay after the run
                order += [idx for unit in reversed(units[k : m + 1]) for idx in unit]
                k = m + 1
            else:
                order += units[k]
                k += 1
    at = [0] * (n + 1)
    chars = []
    for col, idx in enumerate(order):
        at[idx] = col
        ch = shaped[idx]
        chars.append(ch.translate(MIRROR) if rtl and not LATIN_RUN.match(text[idx]) else ch)
    # The cursor sits on the character it comes before. At the end of a right-to-left line
    # the next letter lands left of the last one, so that's where it goes (one column before
    # the line: the caller leaves room for it).
    # After Latin (an English word being typed) the cursor carries on to its right.
    if rtl and not LATIN_RUN.match(text[n - 1]):
        at[n] = min(at[:n]) - 1
    else:
        at[n] = at[n - 1] + 1
    return "".join(chars), at


_FENCE = re.compile(r"^\s*```")
_HEADING = re.compile(r"^\s*#{1,6}\s+")
_BULLET = re.compile(r"^(\s*)[-*+]\s+")
_INLINE = re.compile(r"\*\*|__|`")


class Paragraphs:
    """A rich renderable for text with Arabic: a light Markdown (headings, bullets, code
    blocks) wrapped to the terminal's width, then each line put in display order, Arabic
    paragraphs to the right."""

    def __init__(self, text: str, style: str = "") -> None:
        self.text = text
        self.style = style

    def __rich_console__(self, console: Any, options: Any):
        from rich.text import Text

        width = max(10, options.max_width)
        in_code = False
        for raw in self.text.split("\n"):
            if _FENCE.match(raw):
                in_code = not in_code
                continue
            if in_code:
                yield Text("  " + raw, style="dim", no_wrap=True, overflow="ellipsis")
                continue
            style = self.style
            body = raw
            if _HEADING.match(body):
                body, style = _HEADING.sub("", body), f"{style} bold".strip()
            body = _BULLET.sub(lambda m: m.group(1) + "• ", body)
            body = _INLINE.sub("", body)
            if not body.strip():
                yield Text("")
                continue
            rtl = is_rtl(body)
            for part in Text(body).wrap(console, width):
                yield Text(
                    visual(part.plain.rstrip(), rtl),
                    style=style,
                    justify="right" if rtl else "left",
                    no_wrap=True,
                    overflow="crop",
                )
