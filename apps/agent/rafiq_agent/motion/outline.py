"""Text as outlines for Lottie export: HarfBuzz (uharfbuzz) shapes each run the way it
reads — Arabic joining, lam-alef, marks — from the very font files the app draws with (the
kit's fonts, OFL, shipped in fonts/), and fontTools hands back each glyph's path.

Lottie players disagree about text layers, Arabic especially; paths look the same in all."""

import io
import re
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.basePen import BasePen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent / "fonts"
SLUG = {
    "IBM Plex Sans Arabic": "ibm-plex-sans-arabic",
    "Alexandria": "alexandria",
    "Cairo": "cairo",
    "Tajawal": "tajawal",
    "Readex Pro": "readex-pro",
    "Noto Kufi Arabic": "noto-kufi-arabic",
    "Inter": "inter",
    "Space Grotesk": "space-grotesk",
    "IBM Plex Mono": "ibm-plex-mono",
}
ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")


def _file(family: str, script: str, weight: int) -> Path | None:
    slug = SLUG.get(family)
    if not slug:
        return None
    variable = FONTS / f"{slug}-{script}-wght-normal.woff2"
    if variable.is_file():
        return variable
    weights = sorted(int(m.group(1)) for p in FONTS.glob(f"{slug}-{script}-*-normal.woff2") if (m := re.search(r"-(\d00)-normal", p.name)))
    if not weights:
        return None
    best = min(weights, key=lambda w: abs(w - weight))
    return FONTS / f"{slug}-{script}-{best}-normal.woff2"


@lru_cache(maxsize=64)
def _font(path: str, weight: int) -> tuple[hb.Font, TTFont]:
    tt = TTFont(path)  # reads WOFF2 (brotli) directly
    tt.flavor = None
    buf = io.BytesIO()
    tt.save(buf)
    data = buf.getvalue()
    face = hb.Face(data)
    font = hb.Font(face)
    if "fvar" in tt:
        font.set_variations({"wght": float(weight)})
    return font, TTFont(io.BytesIO(data))


class LottiePen(BasePen):
    """Collects contours as Lottie shape data: vertices with in/out tangents (cubic)."""

    def __init__(self, glyph_set) -> None:  # noqa: ANN001
        super().__init__(glyph_set)
        self.contours: list[dict] = []
        self._cur: dict | None = None
        self._last = (0.0, 0.0)

    def _moveTo(self, pt) -> None:  # noqa: ANN001
        self._cur = {"c": False, "v": [list(pt)], "i": [[0, 0]], "o": [[0, 0]]}
        self._last = pt

    def _lineTo(self, pt) -> None:  # noqa: ANN001
        self._cur["v"].append(list(pt))
        self._cur["i"].append([0, 0])
        self._cur["o"].append([0, 0])
        self._last = pt

    def _curveToOne(self, p1, p2, p3) -> None:  # noqa: ANN001
        last = self._last
        self._cur["o"][-1] = [p1[0] - last[0], p1[1] - last[1]]
        self._cur["v"].append(list(p3))
        self._cur["i"].append([p2[0] - p3[0], p2[1] - p3[1]])
        self._cur["o"].append([0, 0])
        self._last = p3

    def _qCurveToOne(self, p1, p2) -> None:  # noqa: ANN001
        last = self._last
        c1 = (last[0] + 2 / 3 * (p1[0] - last[0]), last[1] + 2 / 3 * (p1[1] - last[1]))
        c2 = (p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1]))
        self._curveToOne(c1, c2, p2)

    def _closePath(self) -> None:
        cur = self._cur
        if cur:
            first, end = cur["v"][0], cur["v"][-1]
            if len(cur["v"]) > 1 and abs(first[0] - end[0]) < 1e-6 and abs(first[1] - end[1]) < 1e-6:
                cur["i"][0] = cur["i"][-1]
                cur["v"].pop()
                cur["i"].pop()
                cur["o"].pop()
            cur["c"] = True
            self.contours.append(cur)
        self._cur = None

    def _endPath(self) -> None:
        if self._cur:
            self.contours.append(self._cur)
        self._cur = None


ARABIC_DIGIT = re.compile(r"[٠-٩۰-۹]")
ARABIC_MARK = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]")
NUMBER_SEPARATOR = re.compile(r"[.,:/]")


def _levels(text: str, rtl: bool) -> list[int]:
    """Bidi embedding levels for one line — the Unicode Bidi Algorithm's rules for plain text
    (no explicit embeddings): weak types W1–W7, neutrals N1–N2, implicit levels I1–I2."""
    types: list[str] = []
    for ch in text:
        if ARABIC_DIGIT.match(ch):
            types.append("AN")
        elif ARABIC_MARK.match(ch):
            types.append(types[-1] if types else ("R" if rtl else "L"))  # W1: a mark takes what it sits on
        elif ARABIC.match(ch):
            types.append("AL")
        elif "0" <= ch <= "9":
            types.append("EN")
        elif ch.isalpha():
            types.append("L")
        else:
            types.append("N")
    # W2: a European number after Arabic letters is an Arabic number; W3: AL → R
    last = "R" if rtl else "L"
    for i, t in enumerate(types):
        if t in ("L", "R", "AL"):
            last = t
        if t == "EN" and last == "AL":
            types[i] = "AN"
    types = ["R" if t == "AL" else t for t in types]
    # W4: one separator between two numbers of the same kind joins them
    for i in range(1, len(types) - 1):
        if types[i] == "N" and NUMBER_SEPARATOR.match(text[i]) and types[i - 1] == types[i + 1] and types[i - 1] in ("EN", "AN"):
            types[i] = types[i - 1]
    # W7: a European number after L (or at the start of an LTR line) is L
    last = "R" if rtl else "L"
    for i, t in enumerate(types):
        if t in ("L", "R"):
            last = t
        if t == "EN" and last == "L":
            types[i] = "L"
    # N1/N2: neutrals take the direction around them when both sides agree, else the line's
    base = "R" if rtl else "L"
    strong = lambda t: "R" if t in ("R", "EN", "AN") else t  # noqa: E731 — numbers count as R here
    i = 0
    while i < len(types):
        if types[i] != "N":
            i += 1
            continue
        j = i
        while j < len(types) and types[j] == "N":
            j += 1
        before = strong(types[i - 1]) if i > 0 else base
        after = strong(types[j]) if j < len(types) else base
        for k in range(i, j):
            types[k] = before if before == after else base
        i = j
    # I1/I2
    levels = []
    for t in types:
        if not rtl:
            levels.append(1 if t == "R" else 2 if t in ("AN", "EN") else 0)
        else:
            levels.append(1 if t == "R" else 2)
    # L1: whitespace at the end of the line goes back to the line's level
    for k in range(len(text) - 1, -1, -1):
        if not text[k].isspace():
            break
        levels[k] = 1 if rtl else 0
    return levels


def _runs(text: str, rtl: bool) -> list[tuple[str, bool, int]]:
    """The line cut where the level or the font changes, in visual order (left to right):
    (text, arabic font, level). Each run is then shaped in its own direction."""
    runs: list[list] = []
    for ch, level in zip(text, _levels(text, rtl), strict=True):
        arabic = bool(ARABIC.match(ch))  # the browser's font subsets split the same way
        if runs and runs[-1][1] == arabic and runs[-1][2] == level:
            runs[-1][0] += ch
        else:
            runs.append([ch, arabic, level])
    # L2: from the highest level down to the lowest odd one, reverse every stretch at or above it
    if runs:
        top = max(r[2] for r in runs)
        lowest_odd = min((r[2] for r in runs if r[2] % 2), default=top + 1)
        for level in range(top, lowest_odd - 1, -1):
            i = 0
            while i < len(runs):
                if runs[i][2] < level:
                    i += 1
                    continue
                j = i
                while j < len(runs) and runs[j][2] >= level:
                    j += 1
                runs[i:j] = runs[i:j][::-1]
                i = j
    return [(r[0], r[1], r[2]) for r in runs]


def outline_line(text: str, family: str, weight: int, px: float, direction: str = "rtl") -> dict:
    """One line as Lottie contours in px (origin at the left end of the baseline, y down), and its width."""
    shaped: list[tuple[list[dict], float]] = []
    for run, arabic, level in _runs(text, direction == "rtl"):
        path = _file(family, "arabic" if arabic else "latin", weight) or _file("IBM Plex Sans Arabic", "arabic" if arabic else "latin", weight)
        if path is None:
            shaped.append(([], 0.0))
            continue
        font, tt = _font(str(path), weight)
        upem = font.face.upem
        scale = px / upem
        buf = hb.Buffer()
        buf.add_str(run)
        buf.guess_segment_properties()
        buf.direction = "rtl" if level % 2 else "ltr"
        hb.shape(font, buf, {})
        glyph_set = tt.getGlyphSet(location={"wght": weight} if "fvar" in tt else None)
        names = tt.getGlyphOrder()
        x = 0
        contours: list[dict] = []
        # HarfBuzz returns glyphs in visual order (left to right) whatever the direction.
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=False):
            pen = LottiePen(glyph_set)
            # font units, y up → px, y down, placed at the pen position
            glyph_set[names[info.codepoint]].draw(TransformPen(pen, (scale, 0, 0, -scale, (x + pos.x_offset) * scale, -pos.y_offset * scale)))
            contours.extend(pen.contours)
            x += pos.x_advance
        shaped.append((contours, x * scale))
    cursor = 0.0
    out: list[dict] = []
    for contours, width in shaped:  # already left to right
        for c in contours:
            out.append({
                "c": c["c"],
                "v": [[round(x + cursor, 2), round(y, 2)] for x, y in c["v"]],
                "i": [[round(x, 2), round(y, 2)] for x, y in c["i"]],
                "o": [[round(x, 2), round(y, 2)] for x, y in c["o"]],
            })
        cursor += width
    return {"contours": out, "width": round(cursor, 3)}


