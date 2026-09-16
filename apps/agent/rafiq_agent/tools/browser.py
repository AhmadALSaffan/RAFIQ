"""A real browser for the agent: Microsoft Edge (or Chrome), driven over the DevTools protocol.

No extra download — Edge ships with Windows. Rafiq starts it with its own profile (never
the user's cookies or logins), headless unless the user wants to watch, and every chat
turn or task gets its own tab, closed when the run ends. Clicks and typing are real input
events, so pages behave as they would for a person.
"""

import asyncio
import base64
import contextlib
import itertools
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx
import websockets

from rafiq_agent.config import DATA_DIR
from rafiq_agent.tools.base import Tool, ToolRegistry, ToolResult

PROFILE = DATA_DIR / "browser-profile"
READ_LIMIT = 15_000

_READ_JS = """
(() => {
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-rafiq]').forEach((e) => e.removeAttribute('data-rafiq'));
  const els = [...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],summary')]
    .filter(visible).slice(0, 150);
  els.forEach((e, i) => e.setAttribute('data-rafiq', String(i + 1)));
  const label = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder')
    || e.getAttribute('title') || e.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  return { title: document.title, url: location.href,
    text: (document.body ? document.body.innerText : '').slice(0, LIMIT),
    elements: els.map((e) => ({ i: +e.getAttribute('data-rafiq'), tag: e.tagName.toLowerCase(),
      type: e.getAttribute('type') || '', text: label(e), href: e.getAttribute('href') || '' })) };
})()
"""

_KEYS = {
    "enter": ("Enter", 13, "\r"),
    "tab": ("Tab", 9, ""),
    "escape": ("Escape", 27, ""),
    "backspace": ("Backspace", 8, ""),
    "arrowdown": ("ArrowDown", 40, ""),
    "arrowup": ("ArrowUp", 38, ""),
    "arrowleft": ("ArrowLeft", 37, ""),
    "arrowright": ("ArrowRight", 39, ""),
    "pagedown": ("PageDown", 34, ""),
    "pageup": ("PageUp", 33, ""),
    "space": (" ", 32, " "),
}


def find_browser() -> str | None:
    candidates = []
    for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates += [
                Path(base) / "Microsoft/Edge/Application/msedge.exe",
                Path(base) / "Google/Chrome/Application/chrome.exe",
            ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which("msedge") or shutil.which("chrome") or shutil.which("chromium")


class BrowserError(Exception):
    pass


class _Browser:
    """The one browser process, started on first use and stopped with the app."""

    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.port: int | None = None
        self._lock = asyncio.Lock()

    async def endpoint(self, visible: bool) -> int:
        async with self._lock:
            if self.process is not None and self.process.poll() is None and self.port:
                return self.port
            exe = find_browser()
            if not exe:
                raise BrowserError("ما لقيت Microsoft Edge أو Chrome على الجهاز.")
            PROFILE.mkdir(parents=True, exist_ok=True)
            marker = PROFILE / "DevToolsActivePort"
            with contextlib.suppress(OSError):
                marker.unlink()
            args = [
                exe,
                "--remote-debugging-port=0",
                f"--user-data-dir={PROFILE}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-features=Translate",
                "about:blank",
            ]
            if not visible:
                args.insert(1, "--headless=new")
            flags = 0x0800_0000 if os.name == "nt" else 0
            self.process = subprocess.Popen(args, creationflags=flags)  # noqa: S603
            for _ in range(80):
                await asyncio.sleep(0.2)
                if marker.is_file():
                    with contextlib.suppress(OSError, ValueError):
                        self.port = int(marker.read_text().splitlines()[0])
                        return self.port
                if self.process.poll() is not None:
                    break
            raise BrowserError("المتصفح ما اشتغل.")

    def stop(self) -> None:
        if self.process is not None and self.process.poll() is None:
            with contextlib.suppress(Exception):
                self.process.terminate()
        self.process, self.port = None, None


BROWSER = _Browser()


class Tab:
    """One DevTools connection to one tab."""

    def __init__(self, port: int, target: dict[str, Any], ws: Any) -> None:
        self.port = port
        self.target_id = target["id"]
        self.ws = ws
        self._ids = itertools.count(1)
        self._waiting: dict[int, asyncio.Future] = {}
        self._reader = asyncio.create_task(self._read())

    @classmethod
    async def open(cls, visible: bool) -> "Tab":
        port = await BROWSER.endpoint(visible)
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.put(f"http://127.0.0.1:{port}/json/new?about:blank")
            if response.status_code >= 400:  # older browsers want GET
                response = await client.get(f"http://127.0.0.1:{port}/json/new?about:blank")
            target = response.json()
        ws = await websockets.connect(target["webSocketDebuggerUrl"], max_size=None)
        tab = cls(port, target, ws)
        await tab.call("Page.enable")
        await tab.call("Runtime.enable")
        return tab

    async def _read(self) -> None:
        with contextlib.suppress(Exception):
            async for raw in self.ws:
                message = json.loads(raw)
                future = self._waiting.pop(message.get("id", -1), None)
                if future and not future.done():
                    if "error" in message:
                        future.set_exception(BrowserError(message["error"].get("message", "CDP error")))
                    else:
                        future.set_result(message.get("result", {}))
        for future in self._waiting.values():
            if not future.done():
                future.set_exception(BrowserError("انقطع الاتصال بالمتصفح."))

    async def call(self, method: str, params: dict[str, Any] | None = None, timeout: float = 30) -> dict[str, Any]:
        call_id = next(self._ids)
        future = asyncio.get_running_loop().create_future()
        self._waiting[call_id] = future
        await self.ws.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
        return await asyncio.wait_for(future, timeout)

    async def evaluate(self, expression: str) -> Any:
        result = await self.call(
            "Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True}
        )
        if "exceptionDetails" in result:
            raise BrowserError(result["exceptionDetails"].get("text", "script error"))
        return result.get("result", {}).get("value")

    async def settle(self, seconds: float = 20) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds
        await asyncio.sleep(0.3)
        while loop.time() < deadline:
            with contextlib.suppress(Exception):
                if await self.evaluate("document.readyState") == "complete":
                    return
            await asyncio.sleep(0.25)

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            async with httpx.AsyncClient(timeout=5) as client:
                await client.get(f"http://127.0.0.1:{self.port}/json/close/{self.target_id}")
        with contextlib.suppress(Exception):
            await self.ws.close()
        self._reader.cancel()


class BrowserSession:
    """The tab one chat turn or task uses — opened on first use, closed with the run."""

    def __init__(self, visible: bool) -> None:
        self.visible = visible
        self.tab: Tab | None = None

    async def get(self) -> Tab:
        if self.tab is None:
            self.tab = await Tab.open(self.visible)
        return self.tab

    async def close(self) -> None:
        if self.tab is not None:
            await self.tab.close()
            self.tab = None


def _target_js(args: dict[str, Any]) -> str:
    element = args.get("element")
    selector = args.get("selector")
    if element:
        return f"document.querySelector('[data-rafiq=\"{int(element)}\"]')"
    if selector:
        return f"document.querySelector({json.dumps(str(selector))})"
    raise BrowserError("حدد element (رقم من browser_read) أو selector.")


async def _center(tab: Tab, args: dict[str, Any]) -> tuple[float, float]:
    box = await tab.evaluate(
        f"(() => {{ const e = {_target_js(args)}; if (!e) return null; e.scrollIntoView({{block: 'center'}});"
        " const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"
    )
    if not box:
        raise BrowserError("ما لقيت العنصر — استدعِ browser_read من جديد لتاخد الأرقام الحالية.")
    return float(box[0]), float(box[1])


class _BrowserTool(Tool):
    category = "exec"

    def __init__(self, session: BrowserSession) -> None:
        self.session = session

    async def run(self, args: dict[str, Any]) -> ToolResult:
        try:
            return await self.act(await self.session.get(), args)
        except (BrowserError, TimeoutError, OSError, httpx.HTTPError) as exc:
            return ToolResult(ok=False, output=f"المتصفح: {exc}")

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        raise NotImplementedError

    async def page(self, tab: Tab, limit: int = READ_LIMIT) -> str:
        data = await tab.evaluate(_READ_JS.replace("LIMIT", str(limit)))
        elements = "\n".join(
            f"[{e['i']}] <{e['tag']}{' ' + e['type'] if e['type'] else ''}> {e['text']}"
            + (f" → {e['href']}" if e["href"] and e["tag"] == "a" else "")
            for e in data["elements"]
        )
        return f"{data['title']}\n{data['url']}\n\n{data['text']}\n\nعناصر تقدر تتفاعل معها:\n{elements}"


class BrowserOpenTool(_BrowserTool):
    name = "browser_open"
    description = (
        "افتح رابط بالمتصفح (بيشتغل حتى مع صفحات JavaScript وسيرفرات localhost) وارجع بمحتوى الصفحة "
        "والعناصر المرقّمة اللي فيك تضغط عليها أو تكتب فيها."
    )
    parameters = {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        url = str(args.get("url", "")).strip()
        if not url.lower().startswith(("http://", "https://")):
            return ToolResult(ok=False, output="بس روابط http و https.")
        await tab.call("Page.navigate", {"url": url})
        await tab.settle()
        return ToolResult(ok=True, output=await self.page(tab))


class BrowserReadTool(_BrowserTool):
    name = "browser_read"
    category = "read_only"
    description = "اقرأ الصفحة المفتوحة حالياً من جديد (بعد ضغطة أو تحميل) مع عناصرها المرقّمة."
    parameters = {"type": "object", "properties": {"max_chars": {"type": "integer"}}, "required": []}

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        limit = min(max(int(args.get("max_chars") or READ_LIMIT), 1000), 60_000)
        return ToolResult(ok=True, output=await self.page(tab, limit))


class BrowserClickTool(_BrowserTool):
    name = "browser_click"
    description = "اضغط على عنصر بالصفحة: element = رقمه من browser_read/browser_open، أو selector CSS."
    parameters = {
        "type": "object",
        "properties": {"element": {"type": "integer"}, "selector": {"type": "string"}},
        "required": [],
    }

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        x, y = await _center(tab, args)
        for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
            await tab.call(
                "Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1}
            )
        await tab.settle(10)
        return ToolResult(ok=True, output="انضغط.\n\n" + await self.page(tab, 6000))


class BrowserTypeTool(_BrowserTool):
    name = "browser_type"
    description = (
        "اكتب نص بحقل: element (رقم) أو selector. clear=true بيمسح اللي فيه أول، submit=true بيضغط Enter بعدها."
    )
    parameters = {
        "type": "object",
        "properties": {
            "element": {"type": "integer"},
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "clear": {"type": "boolean"},
            "submit": {"type": "boolean"},
        },
        "required": ["text"],
    }

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        x, y = await _center(tab, args)
        for kind in ("mousePressed", "mouseReleased"):
            await tab.call("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1})
        if args.get("clear"):
            await tab.evaluate(
                f"(() => {{ const e = {_target_js(args)}; if (e && 'value' in e) {{ e.value = '';"
                " e.dispatchEvent(new Event('input', {bubbles: true})); }} }})()"
            )
        await tab.call("Input.insertText", {"text": str(args.get("text", ""))})
        if args.get("submit"):
            await _press(tab, "enter")
            await tab.settle(10)
        return ToolResult(ok=True, output="انكتب." + ("\n\n" + await self.page(tab, 6000) if args.get("submit") else ""))


async def _press(tab: Tab, name: str) -> None:
    key, code, text = _KEYS[name]
    down = {"type": "keyDown", "key": key, "code": key, "windowsVirtualKeyCode": code}
    if text:
        down["text"] = text
    await tab.call("Input.dispatchKeyEvent", down)
    await tab.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": key, "windowsVirtualKeyCode": code})


class BrowserPressTool(_BrowserTool):
    name = "browser_press"
    description = f"اضغط زر كيبورد بالصفحة: {', '.join(_KEYS)}."
    parameters = {"type": "object", "properties": {"key": {"type": "string"}}, "required": ["key"]}

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        name = str(args.get("key", "")).lower().replace(" ", "")
        if name not in _KEYS:
            return ToolResult(ok=False, output=f"الأزرار المتاحة: {', '.join(_KEYS)}")
        await _press(tab, name)
        await tab.settle(5)
        return ToolResult(ok=True, output="انضغط.")


class BrowserScreenshotTool(_BrowserTool):
    name = "browser_screenshot"
    category = "read_only"
    description = "صوّر الصفحة المفتوحة (للنماذج اللي بتشوف الصور — مفيدة لتتأكد من شكل واجهة)."
    parameters = {"type": "object", "properties": {}, "required": []}

    async def act(self, tab: Tab, args: dict[str, Any]) -> ToolResult:
        shot = await tab.call("Page.captureScreenshot", {"format": "png"})
        data = shot.get("data", "")
        size = len(base64.b64decode(data)) if data else 0
        return ToolResult(ok=bool(data), output=f"صورة الصفحة ({size // 1024} KB).", images=[f"data:image/png;base64,{data}"])


def register_browser_tools(registry: ToolRegistry, visible: bool) -> None:
    if not find_browser():
        return
    session = BrowserSession(visible)
    for cls in (BrowserOpenTool, BrowserReadTool, BrowserClickTool, BrowserTypeTool, BrowserPressTool, BrowserScreenshotTool):
        registry.register(cls(session))
    registry.on_close(session.close)
