"""The tool a model uses to ask Rafiq to remember something.

Category "write" so it goes through the "memory" permission: the user sees the exact
sentence on a card and approves it before it is stored.
"""

from typing import Any

from rafiq_agent.core.memory import MAX_TEXT, remember
from rafiq_agent.tools.base import Tool, ToolResult


class MemorySaveTool(Tool):
    name = "memory_save"
    category = "write"
    description = (
        "احفظ معلومة قصيرة عشان تتذكّرها بالمحادثات الجاية: تفضيل للمستخدم، حقيقة عن مشروعه، أو قرار. "
        "استخدمها لما المستخدم يطلب صراحةً إنك تتذكّر شي، أو لما يذكر تفضيل واضح وثابت (مو معلومة عابرة). "
        "جملة وحدة واضحة بكل مرة."
    )
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": f"الجملة اللي بدك تتذكّرها (حتى {MAX_TEXT} حرف)"},
            "kind": {"type": "string", "enum": ["preference", "project", "fact"], "description": "نوعها"},
        },
        "required": ["text"],
    }

    def __init__(self, chat_id: str | None = None) -> None:
        self.chat_id = chat_id

    async def run(self, args: dict[str, Any]) -> ToolResult:
        text = str(args.get("text") or "").strip()
        if not text:
            return ToolResult(ok=False, output="النص فاضي.")
        row = await remember(text, str(args.get("kind") or "fact"), self.chat_id)
        return ToolResult(ok=True, output=f"انحفظت: {row.text}")
