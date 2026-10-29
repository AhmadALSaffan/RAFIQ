"""find_files: search inside the user's own files by what they say (core/file_index.py).

The model turns «وين فاتورة شهر 3؟» into the words such a file would contain — in Arabic
and English, singular and plural — and a file matching any of them comes back, best first,
with a line from inside it. Only paths and short lines are returned; reading a file is then
an ordinary read the model asks for."""

import asyncio
from datetime import datetime
from typing import Any

from rafiq_agent.core import file_index
from rafiq_agent.tools.base import Tool, ToolResult


class FindFilesTool(Tool):
    name = "find_files"
    category = "read_only"
    description = (
        "Find the user's own files (Documents, Desktop, Downloads, or the folders they chose) by what is INSIDE them "
        "or in their names — invoices, contracts, CVs, reports, photos, anything. Use it whenever the user asks where "
        "a file is or refers to a document they have. Search by meaning: pass in `words` every way the thing might be "
        "written — Arabic AND English, singular and plural, synonyms, names, numbers and months in both forms "
        "(e.g. for «فاتورة شهر 3»: فاتورة, فواتير, invoice, bill, receipt, March, آذار, مارس, 03). A file matching "
        "any word is found; more matches rank higher. Then answer with the paths, or read the best one."
    )
    parameters = {
        "type": "object",
        "properties": {
            "words": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 30,
                "description": "Words and short phrases to look for, in every form and language the file might use.",
            },
            "kind": {
                "type": "string",
                "enum": ["any", "pdf", "doc", "sheet", "slides", "image", "video", "audio"],
                "description": "Only this kind of file. Default any.",
            },
            "modified_after": {"type": "string", "description": "Only files changed on or after this date (YYYY-MM-DD)."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 30, "description": "How many files (default 12)."},
        },
        "required": ["words"],
    }

    async def run(self, args: dict[str, Any]) -> ToolResult:
        words = [str(w).strip() for w in args.get("words") or [] if str(w).strip()]
        if not words:
            return ToolResult(False, "Give at least one word in `words`.")
        since = None
        if raw := args.get("modified_after"):
            try:
                since = datetime.fromisoformat(str(raw))
            except ValueError:
                return ToolResult(False, "modified_after must be YYYY-MM-DD.")
        kind = args.get("kind")
        status = file_index.status()
        hits = await asyncio.to_thread(
            file_index.search, words, None if kind in (None, "any") else str(kind), since, int(args.get("limit") or 12)
        )
        if hits:
            return ToolResult(True, file_index.describe(hits))
        if not status["files"]:
            note = "the index is still being built" if status["scanning"] else "the index is empty"
            return ToolResult(True, f"No files found — {note}. Tell the user, and that it fills in on its own in a few minutes.")
        return ToolResult(True, f"No file matched among {status['files']} indexed files. Try other words or forms, or a wider kind.")
