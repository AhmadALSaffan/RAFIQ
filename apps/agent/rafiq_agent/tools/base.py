import contextlib
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

ToolCategory = Literal["read_only", "write", "exec"]


@dataclass
class ToolResult:
    ok: bool
    output: str
    # Screenshots and the like, as data: URLs. Vision models get to see them; others get
    # the text only.
    images: list[str] | None = None


class Tool(ABC):
    name: str
    category: ToolCategory
    description: str
    parameters: dict[str, Any]

    @abstractmethod
    async def run(self, args: dict[str, Any]) -> ToolResult: ...

    async def preview(self, args: dict[str, Any]) -> str | None:  # noqa: ARG002
        """What approving this call would do, for the permission card (a diff, say).
        None means the arguments already say it all."""
        return None

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
        self._cleanup: list[Callable[[], Awaitable[None]]] = []

    def on_close(self, callback: Callable[[], Awaitable[None]]) -> None:
        """Something to release when the run ends (a browser tab, the desktop, …)."""
        self._cleanup.append(callback)

    async def aclose(self) -> None:
        for callback in reversed(self._cleanup):
            with contextlib.suppress(Exception):
                await callback()
        self._cleanup.clear()

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def schemas(self) -> list[dict[str, Any]]:
        return [t.schema() for t in self._tools.values()]
