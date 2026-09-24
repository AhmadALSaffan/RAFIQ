"""Search inside chats: every message, not only the titles.

An SQLite FTS5 index holds a *folded* copy of each message, so a search matches however the
words were written:

- Arabic: harakat and tatweel are dropped, أ إ آ ٱ become ا, ؤ becomes و, ئ and ى become ي,
  and ة becomes ه. A word that starts with the article — ال, or its و ف ب ك ل forms — is
  indexed twice, as written and without it, and a search word is looked for in both forms.
  So «الكتاب», «بالكتاب» and «كتاب» find each other, and «والد» still finds «والدي» (where
  cutting «وال» off would have left nothing to match). Every word also matches as a prefix,
  which covers the endings: «كتاب» finds «كتابها».
  The index goes one step further than the search does: a word that starts with ب ل ك ف is
  also stored without it, so «كتاب» finds «بكتاب» and «اسطنبول» finds «لإسطنبول». A search
  word is never cut that way — «كتاب» must not start looking for «تاب».
- Everything else: case and accents are folded, so "Resume" finds "résumé".

The index keeps itself up to date lazily. Messages are written in a few places and never
edited after, so before each search the rows that aren't indexed yet are added and the ones
whose message is gone are dropped. Nothing else in the app has to remember the index exists,
and an index missing from an old database or a restored backup simply fills itself in.

The snippet shown for a result is cut from the original message, not the folded copy, with
the matched words marked — the person sees their own words, harakat and all.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

# Bumped whenever the way a message is folded for the index changes: the new table starts
# empty and fills itself on the next search, and the old one is dropped.
INDEX_VERSION = 1
TABLE = f"chat_fts_v{INDEX_VERSION}"
CREATE = (
    f"CREATE VIRTUAL TABLE IF NOT EXISTS {TABLE} "
    "USING fts5(message_id UNINDEXED, chat_id UNINDEXED, body, tokenize='unicode61')"
)

# How many matching messages are considered before grouping them by chat. Enough for any
# real search; a term that matches more than this is too broad to read through anyway.
MAX_HITS = 500
SNIPPET_BEFORE = 50
SNIPPET_AFTER = 110
MIN_TERM = 2

_TATWEEL = "ـ"
_LETTERS = str.maketrans({"ى": "ي", "ة": "ه", "ٱ": "ا"})
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_WORD = re.compile(r"\w+")
# The article, alone or after و ف ب ك ل (and و before those) — and لل, the article after ل —
# when at least two letters are left, so short words like «الم» stay whole.
_ARTICLE = re.compile(r"\b(?:و?[فبكل]?ال|و?لل)(?=\w{2,})")
# The same prefixes, for marking a match inside the original text.
_PREFIX = r"(?:و?[فبكل]?ال|و?لل|و?[فبكل]|و)?"


async def create_index(conn: AsyncConnection) -> None:
    for old in ("chat_fts", *(f"chat_fts_v{v}" for v in range(1, INDEX_VERSION))):
        await conn.execute(text(f"DROP TABLE IF EXISTS {old}"))
    await conn.execute(text(CREATE))


def fold(original: str) -> tuple[str, list[int]]:
    """The text as the index sees it, and for each of its characters, where that character
    came from in the original — so a match can be marked in the words the user wrote."""
    out: list[str] = []
    where: list[int] = []
    for i, ch in enumerate(original):
        for part in unicodedata.normalize("NFKD", ch):
            if part == _TATWEEL or unicodedata.combining(part):
                continue
            for piece in part.casefold().translate(_LETTERS).translate(_DIGITS):
                out.append(piece)
                where.append(i)
    return "".join(out), where


def _bare(word: str) -> str:
    """The word without its article — or, with no article, without a leading و when the
    word is long enough for that to be a conjunction (the rule light Arabic stemmers use):
    «وكتاب» → «كتاب», while «ورد» stays «ورد». The word itself if neither applies."""
    bare = _ARTICLE.sub("", word, count=1)
    if bare == word and len(word) > 3 and word.startswith("و"):
        return word[1:]
    return bare


def _forms(word: str) -> list[str]:
    """The forms a *search* word is looked for in: as typed, and without its article or و."""
    bare = _bare(word)
    return [word] if bare == word else [word, bare]


def _index_forms(word: str) -> list[str]:
    """The forms a word is *stored* in: the search forms, plus each without one leading
    ب ل ك ف when at least three letters are left. Only the index does this — a stored form
    too many costs nothing, a search form too many finds the wrong words."""
    forms = _forms(word)
    for form in list(forms):
        if len(form) >= 4 and form[0] in "بلكف" and not _ARTICLE.match(form):
            forms.append(form[1:])
    return list(dict.fromkeys(forms))


def index_text(original: str) -> str:
    """What goes into the index for one message: the folded text, then the other forms of
    every word that has them."""
    folded = fold(original)[0]
    extra = [form for w in _WORD.findall(folded) for form in _index_forms(w)[1:]]
    return folded + ("\n" + " ".join(extra) if extra else "")


def terms(query: str) -> list[list[str]]:
    """The words of a search, folded like the index; each with the forms it may take."""
    groups = []
    for word in _WORD.findall(fold(query)[0]):
        forms = [f for f in _forms(word) if len(f) >= MIN_TERM or f.isdigit()]
        if forms:
            groups.append(forms)
    return groups


def match_expression(groups: list[list[str]]) -> str:
    """Every word must appear — in one of its forms, as a prefix. The forms come from
    `\\w+`, so they can't carry FTS syntax; they're quoted all the same."""
    # FTS5 wants an explicit AND between parenthesised groups.
    return " AND ".join("(" + " OR ".join(f'"{f}"*' for f in forms) + ")" for forms in groups)


# ── Keeping the index current ─────────────────────────────────────────────────


async def sync(session: AsyncSession) -> int:
    """Index what isn't indexed yet and forget what was deleted. Returns how many messages
    were added — 0 on every search but the first after a change."""
    await session.execute(
        text(f"DELETE FROM {TABLE} WHERE message_id NOT IN (SELECT id FROM chat_messages)")
    )
    rows = (
        await session.execute(
            text(
                "SELECT id, chat_id, content FROM chat_messages "
                f"WHERE content != '' AND id NOT IN (SELECT message_id FROM {TABLE})"
            )
        )
    ).all()
    if rows:
        await session.execute(
            text(f"INSERT INTO {TABLE} (message_id, chat_id, body) VALUES (:m, :c, :b)"),
            [{"m": r[0], "c": r[1], "b": index_text(r[2] or "")} for r in rows],
        )
    await session.commit()
    return len(rows)


# ── Searching ─────────────────────────────────────────────────────────────────


@dataclass
class Snippet:
    message_id: str
    role: str
    text: str
    # [start, end) of each matched word inside `text`.
    marks: list[tuple[int, int]]


@dataclass
class Result:
    chat_id: str
    title: str
    updated_at: datetime
    pinned: bool
    title_match: bool
    matches: int
    snippet: Snippet | None = None
    archived: bool = False
    rank: float = 0.0
    _best: str | None = field(default=None, repr=False)


def _occurrences(folded: str, words: list[str]) -> list[tuple[int, int]]:
    """Where each word starts a word in the folded text (a prefix match, as in the index),
    with the article allowed in front of it."""
    found: list[tuple[int, int]] = []
    for w in words:
        pattern = re.compile(rf"(?<!\w){_PREFIX}({re.escape(w)})\w*")
        for m in pattern.finditer(folded):
            found.append((m.start(1), m.end(1)))
    found.sort()
    merged: list[tuple[int, int]] = []
    for start, end in found:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def snippet(original: str, words: list[str]) -> tuple[str, list[tuple[int, int]]]:
    """A short piece of the original message around the first match, and where the matched
    words are inside it."""
    folded, where = fold(original)
    spots = _occurrences(folded, words)
    if not spots or not where:
        head = original[: SNIPPET_BEFORE + SNIPPET_AFTER].strip()
        return (head + ("…" if len(original) > len(head) else "")), []

    def original_span(span: tuple[int, int]) -> tuple[int, int]:
        start, end = span
        return where[start], where[end - 1] + 1

    first_start, first_end = original_span(spots[0])
    lo = max(0, first_start - SNIPPET_BEFORE)
    hi = min(len(original), first_end + SNIPPET_AFTER)
    # Don't start or end in the middle of a word.
    while lo > 0 and not original[lo - 1].isspace() and first_start - lo < SNIPPET_BEFORE + 20:
        lo -= 1
    while hi < len(original) and not original[hi].isspace() and hi - first_end < SNIPPET_AFTER + 20:
        hi += 1

    piece = original[lo:hi]
    lead = len(piece) - len(piece.lstrip())
    body = " ".join(piece.split())  # one line: newlines and runs of spaces collapse
    prefix = "…" if lo > 0 else ""
    suffix = "…" if hi < len(original) else ""

    # Map each match into the collapsed line by walking both strings together.
    marks: list[tuple[int, int]] = []
    source = piece[lead:]
    offsets: list[int] = []  # index in `body` for each index in `source`
    j = 0
    prev_space = False
    for ch in source:
        if ch.isspace():
            offsets.append(j)
            if not prev_space:
                j += 1
            prev_space = True
        else:
            offsets.append(j)
            j += 1
            prev_space = False
    for span in spots:
        start, end = original_span(span)
        if start < lo + lead or end > hi:
            continue
        s = offsets[start - lo - lead]
        e = offsets[end - lo - lead - 1] + 1
        marks.append((s + len(prefix), min(e, len(body)) + len(prefix)))
    return prefix + body + suffix, marks


async def search(
    session: AsyncSession,
    query: str,
    workspace_id: str | None = None,
    limit: int = 30,
) -> list[Result]:
    """Chats whose messages — or titles — contain every word of the query, best first:
    title matches, then the strength of the best message match, then the most recent."""
    groups = terms(query)
    if not groups:
        return []
    words = [form for forms in groups for form in forms]
    await sync(session)

    scope = "COALESCE(c.mode, 'chat') != 'design'" + (" AND c.workspace_id = :ws" if workspace_id else "")
    params: dict[str, Any] = {"ws": workspace_id} if workspace_id else {}

    hits = (
        await session.execute(
            text(
                f"SELECT f.message_id, f.chat_id, bm25({TABLE}) AS rank "
                f"FROM {TABLE} f JOIN chats c ON c.id = f.chat_id "
                f"WHERE {TABLE} MATCH :q AND {scope} ORDER BY rank LIMIT :n"
            ),
            {**params, "q": match_expression(groups), "n": MAX_HITS},
        )
    ).all()

    results: dict[str, Result] = {}
    chats = (
        await session.execute(
            text(f"SELECT c.id, c.title, c.updated_at, c.pinned, c.archived_at FROM chats c WHERE {scope}"),
            params,
        )
    ).all()
    by_id = {row[0]: row for row in chats}

    for message_id, chat_id, rank in hits:
        row = by_id.get(chat_id)
        if row is None:
            continue
        result = results.get(chat_id)
        if result is None:
            result = results[chat_id] = Result(
                chat_id, row[1], _as_datetime(row[2]), bool(row[3]), False, 0,
                rank=rank, archived=row[4] is not None, _best=message_id,
            )
        result.matches += 1

    # Titles count too: a chat can be found by its name alone.
    for chat_id, title, updated_at, pinned, archived_at in chats:
        title_words = [f for w in _WORD.findall(fold(title or "")[0]) for f in _index_forms(w)]
        if all(any(tw.startswith(f) for tw in title_words for f in forms) for forms in groups):
            result = results.get(chat_id)
            if result is None:
                result = results[chat_id] = Result(
                    chat_id, title, _as_datetime(updated_at), bool(pinned), True, 0,
                    rank=0.0, archived=archived_at is not None,
                )
            result.title_match = True

    # Archived chats are found too, after the ones still in use at the same level of match.
    ordered = sorted(
        results.values(),
        key=lambda r: (not r.title_match, r.archived, r.rank if r.matches else 0.0, -r.updated_at.timestamp()),
    )[:limit]

    best_ids = [r._best for r in ordered if r._best]
    if best_ids:
        marks = ",".join(f":m{i}" for i in range(len(best_ids)))
        messages = {
            row[0]: row
            for row in (
                await session.execute(
                    text(f"SELECT id, role, content FROM chat_messages WHERE id IN ({marks})"),
                    {f"m{i}": mid for i, mid in enumerate(best_ids)},
                )
            ).all()
        }
        for r in ordered:
            if r._best and r._best in messages:
                _, role, content = messages[r._best]
                piece, spans = snippet(content or "", words)
                r.snippet = Snippet(r._best, role, piece, spans)
    return ordered


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))
