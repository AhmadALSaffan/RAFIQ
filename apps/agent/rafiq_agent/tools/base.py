from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

ToolCategory = Literal["read_only", "write", "exec"]


@dataclass
class ToolResult:
    ok: bool
    output: str


class Tool(ABC):
    name: str
    category: ToolCategory
    description: str
    parameters: dict[str, Any]

    @abstractmethod
    async def run(self, args: dict[str, Any]) -> ToolResult: ...

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def schemas(self) -> list[dict[str, Any]]:
        return [t.schema() for t in self._tools.values()]
