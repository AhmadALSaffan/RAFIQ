"""knowledge_base_search: answers from the folders attached to this agent, with citation IDs."""

from collections.abc import Callable
from typing import Any

from rafiq_agent.core import agent_knowledge
from rafiq_agent.tools.base import Tool, ToolResult

CITE = (
    "\n\nAnswer ONLY from these passages. After each fact, cite the passage it came from by its ID in square "
    "brackets, exactly as given, like [kb-0123456789]. Never invent an ID. If the passages don't contain the "
    "answer, say plainly that the knowledge base doesn't have enough evidence for it; don't fill the gap from "
    "memory. Answer in the user's language even when the passages are in another one."
)
NOTE = (
    "This agent has a knowledge base: local folders the user attached to it. For a question those files might "
    "answer, call knowledge_base_search before answering. Answer only from the passages it returns and cite each "
    "fact with the passage's ID in square brackets, like [kb-0123456789]. If the passages don't answer the "
    "question, say there isn't enough evidence in the knowledge base instead of answering from memory."
)


class KnowledgeBaseSearchTool(Tool):
    name = "knowledge_base_search"
    category = "read_only"
    description = (
        "Search the knowledge base attached to this agent (the user's local Markdown and text files). Returns passages, "
        "each with a citation ID, its file, heading and lines. Pass the question as the user asked it in `query`, and in "
        "`words` every way the key terms might be written in the files: Arabic AND English, synonyms, singular and plural."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The question, in the user's own words."},
            "words": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 30,
                "description": "Key words and short phrases, in Arabic and English.",
            },
            "limit": {"type": "integer", "minimum": 1, "maximum": 12, "description": "How many passages (default 6)."},
        },
        "required": ["query", "words"],
    }

    def __init__(self, agent_id: str, on_found: Callable[[agent_knowledge.Retrieval], Any] | None = None) -> None:
        self.agent_id = agent_id
        self.on_found = on_found

    async def run(self, args: dict[str, Any]) -> ToolResult:
        query = str(args.get("query") or "").strip()
        words = [str(w).strip() for w in args.get("words") or [] if str(w).strip()]
        if not query and not words:
            return ToolResult(False, "Give the question in `query` and key words in `words`.")
        found = await agent_knowledge.retrieve(self.agent_id, query, words, int(args.get("limit") or 6))
        if found.reason == "no_access":
            return ToolResult(True, "This agent has no knowledge folders (any more). Tell the user it can't search them; don't answer from memory as if it had.")
        if found.reason == "empty":
            return ToolResult(True, "The knowledge folders have nothing indexed yet (still indexing, or no Markdown or text files). Tell the user.")
        if not found.passages:
            return ToolResult(True, f"Nothing matched in {found.sources} knowledge folder(s). Try other words once; if still nothing, tell the user the knowledge base doesn't have enough evidence to answer.")
        if self.on_found is not None:
            result = self.on_found(found)
            if hasattr(result, "__await__"):
                await result
        return ToolResult(True, agent_knowledge.describe(found.passages) + CITE)
