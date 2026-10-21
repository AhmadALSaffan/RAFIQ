"""The user's notes, for the model: find, read, write a new one, change one (with a diff
the user approves). The notes are the user's own Markdown files (core/notes.py)."""

from pathlib import Path
from typing import Any

from rafiq_agent.core import notes
from rafiq_agent.tools.base import Tool, ToolResult

PATH_HINT = (
    "A note's path is relative to the notes folder, e.g. `ideas/app.md` "
    "(from notes_list); `@note:<path>` in the user's message names one."
)


class NotesListTool(Tool):
    name = "notes_list"
    category = "read_only"
    description = (
        "List the user's notes (their own Markdown notes in Rafiq), or search them when `query` "
        "is given — by name and by text, Arabic spelling variants included. " + PATH_HINT
    )
    parameters = {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "words to look for; empty lists every note"}},
    }

    def __init__(self, root: Path) -> None:
        self.root = root

    async def run(self, args: dict[str, Any]) -> ToolResult:
        query = str(args.get("query") or "").strip()
        if query:
            hits = notes.search(self.root, query, limit=40)
            if not hits:
                return ToolResult(ok=True, output=f"no note matches “{query}”")
            return ToolResult(
                ok=True,
                output="\n".join(f"- {h.path} — {h.title}" + (f" (line {h.line}: {h.snippet})" if h.line else "") for h in hits),
            )
        entries = [e for e in notes.tree(self.root) if e.kind == "note"]
        if not entries:
            return ToolResult(ok=True, output="the user has no notes yet")
        entries.sort(key=lambda e: -e.mtime)
        return ToolResult(ok=True, output="\n".join(f"- {e.path} — {e.title}" for e in entries[:200]))


class NoteReadTool(Tool):
    name = "note_read"
    category = "read_only"
    description = "Read one of the user's notes in full. " + PATH_HINT
    parameters = {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}

    def __init__(self, root: Path) -> None:
        self.root = root

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target = notes.resolve(self.root, str(args.get("path") or ""), suffixes=notes.NOTE_SUFFIXES)
            return ToolResult(ok=True, output=notes.read(target))
        except (notes.NoteError, OSError) as e:
            return ToolResult(ok=False, output=str(e))


class NoteCreateTool(Tool):
    name = "note_create"
    category = "write"
    description = (
        "Save a new note for the user (Markdown) in their notes — when they ask you to write "
        "something down, keep it, or save an answer as a note. Never overwrites: a note with "
        "the same name gets a number. Start the content with a `# title` heading."
    )
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "the note's name (its file name)"},
            "content": {"type": "string", "description": "the whole note, in Markdown"},
            "folder": {"type": "string", "description": "a folder inside the notes, e.g. `work`; empty for the top"},
        },
        "required": ["title", "content"],
    }

    def __init__(self, root: Path) -> None:
        self.root = root

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            folder = str(args.get("folder") or "").strip()
            if folder:
                notes.make_folder(self.root, folder)
            target = notes.create(self.root, folder, str(args.get("title") or ""), str(args.get("content") or ""))
        except (notes.NoteError, OSError) as e:
            return ToolResult(ok=False, output=str(e))
        return ToolResult(ok=True, output=f"saved the note {notes.relative(self.root, target)}")


class NoteEditTool(Tool):
    name = "note_edit"
    category = "write"
    description = (
        "Change one of the user's existing notes. Either replace `find` with `replace` (an "
        "exact piece of the note, for a small change), or give the whole new `content`. The "
        "user sees the difference and approves it first. Read the note before changing it. " + PATH_HINT
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "find": {"type": "string", "description": "exact text in the note to replace"},
            "replace": {"type": "string", "description": "what goes in its place"},
            "content": {"type": "string", "description": "the whole new note, instead of find/replace"},
        },
        "required": ["path"],
    }

    def __init__(self, root: Path) -> None:
        self.root = root

    def _change(self, args: dict[str, Any]) -> tuple[Path, str, str]:
        target = notes.resolve(self.root, str(args.get("path") or ""), suffixes=notes.NOTE_SUFFIXES)
        before = notes.read(target)
        if args.get("content") is not None and args.get("find") is None:
            return target, before, str(args["content"])
        find = str(args.get("find") or "")
        if not find:
            raise notes.NoteError("give `find` and `replace`, or the whole `content`")
        count = before.count(find)
        if count == 0:
            raise notes.NoteError("`find` isn't in the note — read it again and copy the text exactly")
        if count > 1:
            raise notes.NoteError(f"`find` appears {count} times — include more of the text around it")
        return target, before, before.replace(find, str(args.get("replace") or ""), 1)

    async def preview(self, args: dict[str, Any]) -> str | None:
        try:
            target, before, after = self._change(args)
        except (notes.NoteError, OSError):
            return None
        return notes.diff(before, after, target.name)

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target, before, after = self._change(args)
            if before == after:
                return ToolResult(ok=True, output="nothing to change")
            notes.write(target, after)
        except (notes.NoteError, OSError) as e:
            return ToolResult(ok=False, output=str(e))
        return ToolResult(ok=True, output=f"changed the note {notes.relative(self.root, target)}")


def note_tools(root: Path) -> list[Tool]:
    return [NotesListTool(root), NoteReadTool(root), NoteCreateTool(root), NoteEditTool(root)]
