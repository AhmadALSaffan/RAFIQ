"""knowledge_search: answers from the user's own documents, with the file and page."""

import asyncio
from typing import Any

from rafiq_agent.core import knowledge
from rafiq_agent.tools.base import Tool, ToolResult

CITE = "\n\nAnswer ONLY from these passages and cite each fact with its number, like [1]. If they don't contain the answer, say so plainly; don't fill the gap from memory."


class KnowledgeSearchTool(Tool):
    name = "knowledge_search"
    category = "read_only"
    description = (
        "Search the user's knowledge folder: the documents they chose so Rafiq can answer from them. Returns passages "
        "with the file name and page. Use it first for any question their documents might answer. Pass in `words` every "
        "way the thing might be written: Arabic AND English, singular and plural, synonyms. Then answer only from the "
        "passages and cite them by number, like [1]."
    )
    parameters = {
        "type": "object",
        "properties": {
            "words": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 30, "description": "Words and short phrases to look for."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 15, "description": "How many passages (default 8)."},
        },
        "required": ["words"],
    }

    def __init__(self) -> None:
        # Numbers run on across searches in one reply, so [1] always means the same passage.
        self.numbered = 0

    async def run(self, args: dict[str, Any]) -> ToolResult:
        words = [str(w).strip() for w in args.get("words") or [] if str(w).strip()]
        if not words:
            return ToolResult(False, "Give at least one word in `words`.")
        found = await asyncio.to_thread(knowledge.search, words, int(args.get("limit") or 8))
        if found:
            text = knowledge.describe(found, self.numbered + 1)
            self.numbered += len(found)
            return ToolResult(True, text + CITE)
        state = knowledge.status()
        if not state["files"]:
            return ToolResult(True, "The knowledge folder has nothing indexed yet. Tell the user it's still being read, or that no folder has readable files.")
        return ToolResult(True, f"Nothing matched in {state['files']} documents. Try other words, or tell the user their documents don't cover this.")
