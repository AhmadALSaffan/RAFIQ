"""Full desktop control: screenshots, mouse and keyboard on any app — only after the user
turned it on in Settings, and every action still goes through the desktop permission.

There's one screen and one mouse, so one run holds the desktop at a time: the first desktop
action of a task or chat turn takes it, and it's released when that run ends. Other runs
keep working and only wait if they reach for the desktop too.
"""

import asyncio
import base64
import io
import os
from typing import Any

from rafiq_agent.tools.base import Tool, ToolRegistry, ToolResult

MAX_WIDTH = 1366
_desktop = asyncio.Lock()


class DesktopSession:
    def __init__(self) -> None:
        self.scale = 1.0
        self.held = False

    async def take(self) -> None:
        if not self.held:
            await _desktop.acquire()
            self.held = True

    async def release(self) -> None:
        if self.held:
            self.held = False
            _desktop.release()


def _adapter() -> Any:
    from rafiq_agent.tools.os_adapters import windows

    return windows


def _grab(session: DesktopSession) -> tuple[str, int, int, int, int]:
    from PIL import ImageGrab

    image = ImageGrab.grab()
    width, height = image.size
    session.scale = max(1.0, width / MAX_WIDTH)
    if session.scale > 1.0:
        image = image.resize((round(width / session.scale), round(height / session.scale)))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=70)
    shown_w, shown_h = image.size
    return base64.b64encode(buffer.getvalue()).decode(), width, height, shown_w, shown_h


class _DesktopTool(Tool):
    category = "exec"

    def __init__(self, session: DesktopSession) -> None:
        self.session = session

    async def run(self, args: dict[str, Any]) -> ToolResult:
        await self.session.take()
        try:
            return await self.act(args)
        except (ValueError, OSError) as exc:
            return ToolResult(ok=False, output=str(exc))

    def point(self, args: dict[str, Any]) -> tuple[int, int]:
        """Coordinates arrive in the last screenshot's pixels; the screen may be larger."""
        return round(float(args["x"]) * self.session.scale), round(float(args["y"]) * self.session.scale)

    async def act(self, args: dict[str, Any]) -> ToolResult:
        raise NotImplementedError


class DesktopScreenshotTool(_DesktopTool):
    name = "desktop_screenshot"
    description = (
        "صوّر الشاشة. الإحداثيات بأدوات الفأرة بتكون ببكسلات هالصورة (ممكن تكون مصغّرة عن الشاشة الحقيقية)."
    )
    parameters = {"type": "object", "properties": {}, "required": []}

    async def act(self, args: dict[str, Any]) -> ToolResult:
        data, w, h, sw, sh = await asyncio.to_thread(_grab, self.session)
        return ToolResult(
            ok=True,
            output=f"الشاشة {w}×{h}، الصورة {sw}×{sh} — استخدم إحداثيات الصورة.",
            images=[f"data:image/jpeg;base64,{data}"],
        )


class DesktopClickTool(_DesktopTool):
    name = "desktop_click"
    description = "اضغط بالفأرة على نقطة من آخر صورة شاشة. button: left/right/middle، double لضغطتين."
    parameters = {
        "type": "object",
        "properties": {
            "x": {"type": "number"},
            "y": {"type": "number"},
            "button": {"type": "string", "enum": ["left", "right", "middle"]},
            "double": {"type": "boolean"},
        },
        "required": ["x", "y"],
    }

    async def act(self, args: dict[str, Any]) -> ToolResult:
        x, y = self.point(args)
        await asyncio.to_thread(_adapter().click, x, y, str(args.get("button") or "left"), 2 if args.get("double") else 1)
        return ToolResult(ok=True, output=f"انضغط على ({x}, {y}).")


class DesktopTypeTool(_DesktopTool):
    name = "desktop_type"
    description = "اكتب نص بالتطبيق اللي فيه التركيز حالياً (بيدعم العربي)."
    parameters = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}

    async def act(self, args: dict[str, Any]) -> ToolResult:
        await asyncio.to_thread(_adapter().type_text, str(args.get("text", "")))
        return ToolResult(ok=True, output="انكتب.")


class DesktopKeyTool(_DesktopTool):
    name = "desktop_key"
    description = "اضغط زر أو اختصار، مثل enter أو ctrl+s أو alt+tab أو win+r."
    parameters = {"type": "object", "properties": {"keys": {"type": "string"}}, "required": ["keys"]}

    async def act(self, args: dict[str, Any]) -> ToolResult:
        await asyncio.to_thread(_adapter().press, str(args.get("keys", "")))
        return ToolResult(ok=True, output="انضغط.")


class DesktopScrollTool(_DesktopTool):
    name = "desktop_scroll"
    description = "مرّر عجلة الفأرة عند نقطة: amount موجب لفوق، سالب لتحت."
    parameters = {
        "type": "object",
        "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "amount": {"type": "integer"}},
        "required": ["amount"],
    }

    async def act(self, args: dict[str, Any]) -> ToolResult:
        adapter = _adapter()
        if "x" in args and "y" in args:
            x, y = self.point(args)
            await asyncio.to_thread(adapter.move, x, y)
        await asyncio.to_thread(adapter.scroll, int(args.get("amount") or -3))
        return ToolResult(ok=True, output="تمرّر.")


def register_desktop_tools(registry: ToolRegistry) -> None:
    if os.name != "nt":
        return
    session = DesktopSession()
    for cls in (DesktopScreenshotTool, DesktopClickTool, DesktopTypeTool, DesktopKeyTool, DesktopScrollTool):
        registry.register(cls(session))
    registry.on_close(session.release)
