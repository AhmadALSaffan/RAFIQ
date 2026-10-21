"""The user's notes: plain Markdown files in a folder of their own.

Notes are files, not rows — Documents/Rafiq/notes by default, or a folder the user picked
(OneDrive, say) — so they open in any editor, sync and back up with everything else, and
outlive Rafiq. A note is any `.md` under the folder; sub-folders are the user's own
grouping. Pictures pasted into a note go to an `assets` folder next to it, and a deleted
note moves to `.trash` instead of disappearing.

A path is either relative to the notes folder (the user's notes) or absolute (a Markdown
file opened from elsewhere on the machine — "Open with Rafiq"). Relative paths can't climb
out of the folder; absolute ones are only ever Markdown or text files.
"""

import base64
import difflib
import re
import secrets
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from rafiq_agent.core.search import fold
from rafiq_agent.core.workspace import workspace_root
from rafiq_agent.i18n import tr

NOTE_SUFFIXES = (".md", ".markdown")
# Files from elsewhere that the editor may open and save: Markdown, and plain text.
OPEN_SUFFIXES = (*NOTE_SUFFIXES, ".txt")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
ASSETS = "assets"
TRASH = ".trash"
MAX_NOTES = 5000
MAX_BYTES = 5 * 1024 * 1024
MAX_IMAGE = 15 * 1024 * 1024
UNTITLED = "Untitled"

_BAD_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")
_DATA_URL = re.compile(r"^data:image/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,(.+)$", re.DOTALL)


class NoteError(ValueError):
    """A path or a request the notes can't take: the message is shown to the user."""


def default_root() -> Path:
    return workspace_root() / "notes"


def notes_root(configured: str | None) -> Path:
    """The folder notes live in, created on first use."""
    root = Path(configured).expanduser() if configured else default_root()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def is_external(path: str) -> bool:
    return Path(path).is_absolute()


def resolve(root: Path, path: str, *, suffixes: tuple[str, ...] = OPEN_SUFFIXES) -> Path:
    """The file a note path names. Relative paths stay inside the notes folder; absolute
    ones (a file opened from elsewhere) must be one of `suffixes`."""
    raw = (path or "").strip()
    if not raw:
        raise NoteError(tr("ما في مسار للملاحظة."))
    if is_external(raw):
        target = Path(raw).resolve()
        if target.suffix.lower() not in suffixes:
            raise NoteError(tr("هاد مش ملف ملاحظات: {0}", target.name))
        return target
    target = (root / raw).resolve()
    if target != root and root not in target.parents:
        raise NoteError(tr("المسار برا مجلد الملاحظات."))
    return target


def relative(root: Path, target: Path) -> str:
    """The path the app uses for a file: relative inside the notes folder, absolute outside."""
    try:
        return target.relative_to(root).as_posix()
    except ValueError:
        return str(target)


def clean_name(name: str, fallback: str = UNTITLED) -> str:
    """A file or folder name Windows accepts, from whatever the user typed."""
    cleaned = _BAD_NAME.sub(" ", name or "").strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:120] or fallback


def unique(path: Path) -> Path:
    """`path`, or `path (2)`, `path (3)`… — the first that doesn't exist yet."""
    if not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    for n in range(2, 1000):
        candidate = path.with_name(f"{stem} ({n}){suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{stem} {secrets.token_hex(3)}{suffix}")


def title_of(text: str, fallback: str) -> str:
    """A note's first heading, or its first line of text, or the file name."""
    in_fence = False
    for line in text.splitlines()[:60]:
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence or not stripped:
            continue
        heading = _HEADING.match(line)
        if heading:
            return heading.group(1).strip()[:120]
        return re.sub(r"^[>\-*+\d.\[\]\sx]+", "", stripped)[:120] or fallback
    return fallback


def excerpt_of(text: str, title: str) -> str:
    """The first line of prose after the title, without Markdown marks — the note's preview."""
    in_fence = False
    for line in text.splitlines()[:80]:
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence or not stripped or _HEADING.match(line) or set(stripped) <= set("-*_=|: "):
            continue
        plain = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", stripped)
        plain = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", plain)
        plain = re.sub(r"^([>\-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?", "", plain)
        plain = re.sub(r"[*_`~]|\[\[|\]\]", "", plain).strip()
        if plain and plain != title:
            return plain[:120]
    return ""


def _skip(rel: Path) -> bool:
    return any(part in (ASSETS, TRASH) or part.startswith(".") for part in rel.parts)


@dataclass
class Entry:
    path: str
    name: str
    kind: str  # "dir" | "note"
    mtime: float
    size: int
    title: str
    # The first line of text under the title, for the list.
    excerpt: str = ""


def tree(root: Path) -> list[Entry]:
    """Every folder and note under the notes folder (not assets or the trash)."""
    out: list[Entry] = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if _skip(rel):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if path.is_dir():
            out.append(Entry(rel.as_posix(), path.name, "dir", stat.st_mtime, 0, path.name))
        elif path.suffix.lower() in NOTE_SUFFIXES:
            try:
                head = path.read_text(encoding="utf-8", errors="replace")[:4000]
            except OSError:
                head = ""
            title = title_of(head, path.stem)
            out.append(Entry(rel.as_posix(), path.name, "note", stat.st_mtime, stat.st_size, title, excerpt_of(head, title)))
        if len(out) >= MAX_NOTES:
            break
    return out


@dataclass
class Hit:
    path: str
    title: str
    line: int
    snippet: str


def search(root: Path, query: str, limit: int = 60) -> list[Hit]:
    """Notes whose name or text has the query — Arabic folded, so «اسامة» finds «أسامة»
    and «مدرسه» finds «مدرسة». The name matches first; then each matching line."""
    needle = fold(query.strip())[0]
    if not needle:
        return []
    hits: list[Hit] = []
    for entry in tree(root):
        if entry.kind != "note":
            continue
        target = root / entry.path
        try:
            text = target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if needle in fold(entry.name)[0] or needle in fold(entry.title)[0]:
            hits.append(Hit(entry.path, entry.title, 0, text.strip().splitlines()[0][:160] if text.strip() else ""))
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if needle in fold(line)[0]:
                hits.append(Hit(entry.path, entry.title, number, line.strip()[:200]))
                break
        if len(hits) >= limit:
            break
    return hits


def read(target: Path) -> str:
    if not target.is_file():
        raise NoteError(tr("الملاحظة مش موجودة: {0}", target.name))
    if target.stat().st_size > MAX_BYTES:
        raise NoteError(tr("الملف {0} أكبر من إنه ينفتح هون.", target.name))
    return target.read_text(encoding="utf-8", errors="replace")


def write(target: Path, content: str) -> float:
    """Saves a note (creating its folder) and returns its new modification time."""
    if len(content.encode("utf-8")) > MAX_BYTES:
        raise NoteError(tr("الملاحظة أكبر من المسموح (5 ميغا)."))
    target.parent.mkdir(parents=True, exist_ok=True)
    # Through a temporary file, so a crash mid-save never leaves half a note.
    temp = target.with_name(f".{target.name}.{secrets.token_hex(3)}.tmp")
    temp.write_text(content, encoding="utf-8", newline="\n")
    temp.replace(target)
    return target.stat().st_mtime


def create(root: Path, folder: str, title: str, content: str = "") -> Path:
    """A new note in `folder` named after `title` (made unique). Its text starts with the
    title as a heading unless `content` is given."""
    base = resolve(root, folder or ".", suffixes=()) if folder else root
    if not (base == root or root in base.parents):
        raise NoteError(tr("المسار برا مجلد الملاحظات."))
    name = clean_name(title)
    target = unique(base / f"{name}.md")
    write(target, content if content else f"# {title.strip() or name}\n\n")
    return target


def make_folder(root: Path, path: str) -> Path:
    parts = [clean_name(p, "folder") for p in path.replace("\\", "/").split("/") if p.strip()]
    if not parts:
        raise NoteError(tr("اكتب اسم للمجلد."))
    target = root.joinpath(*parts)
    if root not in target.resolve().parents:
        raise NoteError(tr("المسار برا مجلد الملاحظات."))
    target.mkdir(parents=True, exist_ok=True)
    return target


def move(root: Path, src: str, dst: str) -> Path:
    """Renames or moves a note or folder inside the notes folder. A note keeps `.md`."""
    source = resolve(root, src, suffixes=())
    if is_external(src) or not source.exists() or source == root:
        raise NoteError(tr("الملاحظة مش موجودة: {0}", src))
    parts = [clean_name(p, "note") for p in dst.replace("\\", "/").split("/") if p.strip()]
    if not parts:
        raise NoteError(tr("اكتب اسم."))
    target = root.joinpath(*parts)
    if source.is_file() and target.suffix.lower() not in NOTE_SUFFIXES:
        target = target.with_name(target.name + ".md")
    target = target.resolve()
    if root not in target.parents:
        raise NoteError(tr("المسار برا مجلد الملاحظات."))
    if source.is_dir() and (target == source or source in target.parents):
        raise NoteError(tr("ما بينفع تحط مجلد جوا حاله."))
    if target == source:
        return source
    target = unique(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    return target


def trash(root: Path, path: str) -> Path:
    """Moves a note or folder into `.trash` (never deletes it)."""
    source = resolve(root, path, suffixes=())
    if is_external(path) or not source.exists() or source == root:
        raise NoteError(tr("الملاحظة مش موجودة: {0}", path))
    bin_dir = root / TRASH
    bin_dir.mkdir(exist_ok=True)
    target = unique(bin_dir / f"{time.strftime('%Y%m%d-%H%M%S')} {source.name}")
    shutil.move(str(source), str(target))
    return target


def save_image(root: Path, note: str, name: str, data_url: str) -> str:
    """Saves a pasted or dropped picture next to its note and returns the link the note
    uses for it (`assets/…`, relative to the note)."""
    match = _DATA_URL.match(data_url or "")
    if not match:
        raise NoteError(tr("هاد مش ملف صورة."))
    data = base64.b64decode(match.group(2), validate=False)
    if len(data) > MAX_IMAGE:
        raise NoteError(tr("الصورة كبيرة كتير (الحد 15 ميغا)."))
    kind = match.group(1).replace("jpeg", "jpg").replace("svg+xml", "svg")
    note_file = resolve(root, note)
    folder = note_file.parent / ASSETS
    folder.mkdir(parents=True, exist_ok=True)
    stem = clean_name(Path(name or "image").stem, "image").replace(" ", "-")[:40]
    target = unique(folder / f"{stem}.{kind}")
    target.write_bytes(data)
    return f"{ASSETS}/{target.name}"


def image_file(root: Path, note: str, src: str) -> Path:
    """The picture a note links to (`assets/x.png`, relative to the note)."""
    note_file = resolve(root, note)
    target = (note_file.parent / src).resolve()
    if target.suffix.lower() not in IMAGE_SUFFIXES:
        raise NoteError(tr("هاد مش ملف صورة."))
    # A picture belongs to its note's folder (for an outside file, to that file's folder).
    base = note_file.parent
    if base != target.parent and base not in target.parents:
        raise NoteError(tr("الصورة برا مجلد الملاحظة."))
    if not target.is_file():
        raise NoteError(tr("الصورة مش موجودة: {0}", src))
    return target


def diff(before: str, after: str, name: str) -> str:
    """A unified diff between two versions of a note, for the permission card."""
    lines = difflib.unified_diff(
        before.splitlines(keepends=True), after.splitlines(keepends=True), fromfile=f"a/{name}", tofile=f"b/{name}"
    )
    return "".join(lines)


def headings(text: str) -> list[tuple[int, str]]:
    """The note's outline: (level, text) for each heading outside code blocks."""
    out: list[tuple[int, str]] = []
    in_fence = False
    for line in text.splitlines():
        if line.strip().startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            out.append((len(match.group(1)), match.group(2)))
    return out


# ── Notes named in a chat message ──────────────────────────────────────────────────────────
# The composer's @ menu inserts `@note:<path>` (no `.md`, spaces written as `_`, since a
# mention ends at a space). The note's text rides along with the message, for the model.

MENTION = re.compile(r"@note:([^\s⁦-⁩]+)")
MENTION_CHARS = 30_000


def _mentioned(root: Path, token: str) -> Path | None:
    names = (token, token.replace("_", " "))
    for candidate in (*names, *(f"{n}.md" for n in names)):
        try:
            target = resolve(root, candidate, suffixes=NOTE_SUFFIXES)
        except NoteError:
            continue
        if target.is_file():
            return target
    return None


def with_mentions(text: str, root: Path) -> str:
    """The message with the text of each note it mentions added after it."""
    if "@note:" not in (text or ""):
        return text
    added: list[str] = []
    seen: set[Path] = set()
    for token in MENTION.findall(text):
        target = _mentioned(root, token.rstrip(".,،؛;:!?)"))
        if target is None or target in seen:
            continue
        seen.add(target)
        try:
            body = read(target)
        except (NoteError, OSError):
            continue
        if len(body) > MENTION_CHARS:
            body = body[:MENTION_CHARS] + "\n… (cut here; note_read has the rest)"
        added.append(f"[The user's note `{relative(root, target)}`:]\n```markdown\n{body}\n```")
    return "\n\n".join([text, *added]) if added else text
