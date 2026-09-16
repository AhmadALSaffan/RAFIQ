"""Mouse, keyboard and screen on Windows, straight through user32 (no extra packages).

Typing uses Unicode key events, so Arabic and any other script type as-is. The process is
made DPI-aware so screen coordinates and screenshots are the same physical pixels.
"""

import ctypes
import ctypes.wintypes as wt
import time

user32 = ctypes.windll.user32  # type: ignore[attr-defined]
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001 - older Windows
    user32.SetProcessDPIAware()

ULONG_PTR = ctypes.c_size_t
INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 0x0002, 0x0004
MOUSE = {
    "left": (0x0002, 0x0004),
    "right": (0x0008, 0x0010),
    "middle": (0x0020, 0x0040),
}
MOUSEEVENTF_WHEEL = 0x0800


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wt.DWORD), ("wParamL", wt.WORD), ("wParamH", wt.WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("u", _INPUTUNION)]


def _send(*inputs: INPUT) -> None:
    array = (INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), array, ctypes.sizeof(INPUT))


def _mouse(flags: int, data: int = 0) -> INPUT:
    return INPUT(type=INPUT_MOUSE, u=_INPUTUNION(mi=MOUSEINPUT(0, 0, data, flags, 0, 0)))


def _key(vk: int = 0, scan: int = 0, flags: int = 0) -> INPUT:
    return INPUT(type=INPUT_KEYBOARD, u=_INPUTUNION(ki=KEYBDINPUT(vk, scan, flags, 0, 0)))


VK = {
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B, "windows": 0x5B,
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "backspace": 0x08,
    "delete": 0x2E, "del": 0x2E, "space": 0x20, "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22, "insert": 0x2D, "printscreen": 0x2C,
    **{f"f{n}": 0x6F + n for n in range(1, 13)},
}


def screen_size() -> tuple[int, int]:
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def move(x: int, y: int) -> None:
    user32.SetCursorPos(int(x), int(y))


def click(x: int, y: int, button: str = "left", count: int = 1) -> None:
    down, up = MOUSE.get(button, MOUSE["left"])
    move(x, y)
    for _ in range(max(1, count)):
        _send(_mouse(down), _mouse(up))
        time.sleep(0.05)


def scroll(amount: int) -> None:
    _send(_mouse(MOUSEEVENTF_WHEEL, ctypes.c_uint32(int(amount) * 120).value))


def type_text(text: str) -> None:
    units = text.encode("utf-16-le")
    for i in range(0, len(units), 2):
        code = int.from_bytes(units[i : i + 2], "little")
        _send(_key(scan=code, flags=KEYEVENTF_UNICODE), _key(scan=code, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))


def _vk(name: str) -> int:
    name = name.strip().lower()
    if name in VK:
        return VK[name]
    if len(name) == 1 and name.isalnum():
        return ord(name.upper())
    raise ValueError(f"زر مو معروف: {name}")


def press(combo: str) -> None:
    """e.g. "ctrl+s", "alt+tab", "enter"."""
    keys = [_vk(part) for part in combo.split("+") if part.strip()]
    if not keys:
        raise ValueError("ما في أزرار")
    _send(*[_key(vk=k) for k in keys])
    _send(*[_key(vk=k, flags=KEYEVENTF_KEYUP) for k in reversed(keys)])
