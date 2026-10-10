from pathlib import Path
from typing import Any

from rafiq_agent.tools.base import Tool, ToolResult

# How much of a write's diff the permission card gets to show.
PREVIEW_CHARS = 6_000
# How much of a file one read returns. The rest is still reachable — the model asks for the
# next page with `offset` — but nobody pays for 20k characters to answer one question.
READ_CHARS = 8_000


class PathEscapeError(Exception):
    pass


def _resolve(working_dir: Path, relative: str) -> Path:
    root = working_dir.resolve()
    candidate = (root / relative).resolve()
    if root not in candidate.parents and candidate != root:
        raise PathEscapeError(f"path '{relative}' escapes the task working directory")
    return candidate


class FilesystemListTool(Tool):
    name = "filesystem_list"
    category = "read_only"
    description = "List files and folders inside a directory relative to the task's working directory."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative path, '.' for the working dir root"}
        },
        "required": ["path"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target = _resolve(self.working_dir, args.get("path", "."))
            if not target.exists():
                return ToolResult(ok=False, output=f"path not found: {target}")
            entries = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())
            return ToolResult(ok=True, output="\n".join(entries) if entries else "(empty)")
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico"}


def _looks_binary(target: Path) -> bool:
    with target.open("rb") as f:
        head = f.read(4096)
    return b"\x00" in head


class FilesystemReadTool(Tool):
    name = "filesystem_read"
    category = "read_only"
    description = (
        f"Read a file, relative to the task's working directory. Text comes back as text (at "
        f"most {READ_CHARS} characters; pass `offset` to continue where the last read stopped). "
        "A picture (png, jpg, webp, gif…) comes back as the image itself, so you can look at "
        "it — no Python or other program needed. A PDF comes back as its text."
    )
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "offset": {"type": "integer", "description": "Characters to skip (default 0)"},
        },
        "required": ["path"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target = _resolve(self.working_dir, args["path"])
            if not target.is_file():
                return ToolResult(ok=False, output=f"file not found: {target}")
            suffix = target.suffix.lower()
            if suffix in IMAGE_SUFFIXES:
                return _read_image(target)
            if suffix == ".pdf":
                from rafiq_agent.core.attachments import pdf_text, truncate

                return ToolResult(ok=True, output=truncate(pdf_text(str(target))))
            if _looks_binary(target):
                size = target.stat().st_size
                return ToolResult(ok=False, output=f"{target.name} is a binary file ({size} bytes), not text — it can't be read as text.")
            content = target.read_text(encoding="utf-8", errors="replace")
            try:
                offset = max(0, int(args.get("offset") or 0))
            except (TypeError, ValueError):
                offset = 0
            page = content[offset : offset + READ_CHARS]
            rest = len(content) - (offset + len(page))
            if rest > 0:
                page += f"\n… ({rest} characters left — read again with offset={offset + len(page)})"
            return ToolResult(ok=True, output=page)
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))


def _read_image(target: Path) -> ToolResult:
    """The picture itself, sized down the same way an attachment is."""
    from rafiq_agent.core.attachments import image_data_url

    try:
        url = image_data_url(str(target))
    except Exception as exc:  # noqa: BLE001 - a broken or unusual image file
        return ToolResult(ok=False, output=f"couldn't open the image {target.name}: {exc}")
    from PIL import Image

    with Image.open(target) as img:
        width, height = img.size
    return ToolResult(ok=True, output=f"The image {target.name} ({width}×{height}) is shown below.", images=[url])


class FilesystemWriteTool(Tool):
    name = "filesystem_write"
    category = "write"
    description = "Create or overwrite a text file, relative to the task's working directory."
    parameters = {
        "type": "object",
        "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
        "required": ["path", "content"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def preview(self, args: dict[str, Any]) -> str | None:
        """A unified diff against what's on disk, so the user approves a change they can
        read rather than a filename."""
        import difflib

        try:
            target = _resolve(self.working_dir, str(args.get("path", "")))
        except PathEscapeError:
            return None
        new_text = str(args.get("content", ""))
        new_lines = new_text.splitlines(keepends=True)
        if target.is_file():
            try:
                old_lines = target.read_text(encoding="utf-8").splitlines(keepends=True)
            except (OSError, UnicodeDecodeError):
                return None
            label = args.get("path", target.name)
            diff = list(difflib.unified_diff(old_lines, new_lines, fromfile=f"a/{label}", tofile=f"b/{label}", n=2))
            if not diff:
                return "(no changes)"
        else:
            diff = [f"+++ {args.get('path', target.name)} (new file, {len(new_lines)} lines)\n", *(f"+{line}" for line in new_lines)]
        text = "".join(diff)
        if len(text) > PREVIEW_CHARS:
            text = text[:PREVIEW_CHARS] + "\n… (truncated)"
        return text

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target = _resolve(self.working_dir, args["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(args["content"], encoding="utf-8")
            return ToolResult(ok=True, output=f"wrote {len(args['content'])} bytes to {target.name}")
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))


class FilesystemDeleteTool(Tool):
    name = "filesystem_delete"
    category = "write"
    description = "Delete a file, relative to the task's working directory."
    parameters = {
        "type": "object",
        "properties": {"path": {"type": "string"}},
        "required": ["path"],
    }

    def __init__(self, working_dir: Path) -> None:
        self.working_dir = working_dir

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            target = _resolve(self.working_dir, args["path"])
            if not target.is_file():
                return ToolResult(ok=False, output=f"file not found: {target}")
            target.unlink()
            return ToolResult(ok=True, output=f"deleted {target.name}")
        except PathEscapeError as e:
            return ToolResult(ok=False, output=str(e))
