"""Brand kits: the only colours, fonts and sizes a scene may use. One per workspace, shared
with the design sessions; a few templates for workspaces that don't have one yet."""

import re
from typing import Any

# Fonts that ship with the app (all OFL). A kit may only name these.
FONTS = [
    "IBM Plex Sans Arabic",
    "Alexandria",
    "Cairo",
    "Tajawal",
    "Readex Pro",
    "Noto Kufi Arabic",
    "Inter",
    "Space Grotesk",
    "IBM Plex Mono",
]

COLOR_ROLES = ["surface", "surface2", "onSurface", "muted", "primary", "onPrimary", "accent"]
TYPE_STYLES = ["display", "headline", "title", "body", "caption"]

_BASE: dict[str, Any] = {
    "fonts": {"display": "Alexandria", "body": "IBM Plex Sans Arabic", "latin": "Inter", "mono": "IBM Plex Mono"},
    # Sizes in px on a 1080px short side; the engine scales them with the frame.
    "type": {"display": 96, "headline": 64, "title": 44, "body": 32, "caption": 28},
    "spacing": [1, 2, 3, 4, 6, 8, 12],  # the gap scale, in 8px units
    "radius": [0, 8, 16, 999],
    "motion": {"personality": "calm", "enter": 0.5, "exit": 0.35, "ease": "outExpo"},
    "logo": None,
}

TEMPLATES: dict[str, dict[str, Any]] = {
    "dark": {
        **_BASE,
        "name": "dark",
        "colors": {
            "surface": "#0e0e0e", "surface2": "#1c1c1b", "onSurface": "#f2f2ef", "muted": "#9a9a93",
            "primary": "#e68835", "onPrimary": "#1f1306", "accent": "#3b82f6",
        },
    },
    "light": {
        **_BASE,
        "name": "light",
        "colors": {
            "surface": "#e9e9e6", "surface2": "#ffffff", "onSurface": "#121212", "muted": "#66665f",
            "primary": "#b35a10", "onPrimary": "#ffffff", "accent": "#2563eb",
        },
    },
    "neon": {
        **_BASE,
        "name": "neon",
        "fonts": {**_BASE["fonts"], "display": "Readex Pro"},
        "motion": {"personality": "energetic", "enter": 0.4, "exit": 0.25, "ease": "outBack"},
        "colors": {
            "surface": "#07070d", "surface2": "#14142a", "onSurface": "#f5f3ff", "muted": "#a5a3c9",
            "primary": "#a3ff12", "onPrimary": "#07070d", "accent": "#ff2bd6",
        },
    },
    "warm": {
        **_BASE,
        "name": "warm",
        "fonts": {**_BASE["fonts"], "display": "Cairo", "body": "Tajawal"},
        "colors": {
            "surface": "#2a1d14", "surface2": "#3a2a1e", "onSurface": "#fbf3ea", "muted": "#c9b8a5",
            "primary": "#f2a65a", "onPrimary": "#2a1d14", "accent": "#7fb685",
        },
    },
}

DEFAULT_KIT = "dark"

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def template(name: str | None) -> dict[str, Any]:
    import copy

    return copy.deepcopy(TEMPLATES.get(name or DEFAULT_KIT, TEMPLATES[DEFAULT_KIT]))


def _luminance(hex_color: str) -> float:
    def channel(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# Pairs that will carry text, and the contrast each needs.
TEXT_PAIRS = [("onSurface", "surface", 4.5), ("onSurface", "surface2", 4.5), ("onPrimary", "primary", 4.5), ("muted", "surface", 3.0)]


def check_kit(kit: Any) -> list[str]:
    """Why this kit can't be saved (empty = fine). Contrast is checked on the pairs that
    carry text, so a kit can't promise a combination nobody can read."""
    problems: list[str] = []
    if not isinstance(kit, dict):
        return ["a brand kit is an object"]
    colors = kit.get("colors") or {}
    for role in COLOR_ROLES:
        value = colors.get(role)
        if not isinstance(value, str) or not _HEX.match(value):
            problems.append(f"colors.{role} must be #rrggbb")
    fonts = kit.get("fonts") or {}
    for role in ("display", "body", "latin"):
        if fonts.get(role) not in FONTS:
            problems.append(f"fonts.{role} must be one of: {', '.join(FONTS)}")
    sizes = kit.get("type") or {}
    for style in TYPE_STYLES:
        size = sizes.get(style)
        if not isinstance(size, (int, float)) or not 12 <= size <= 400:
            problems.append(f"type.{style} must be a size between 12 and 400")
    if not problems:
        for fg, bg, need in TEXT_PAIRS:
            ratio = contrast(colors[fg], colors[bg])
            if ratio < need:
                problems.append(f"{fg} on {bg} has contrast {ratio:.1f}:1, needs {need}:1")
    return problems


def normalize(kit: dict[str, Any]) -> dict[str, Any]:
    """Fills anything a saved kit doesn't set from the dark template."""
    base = template(DEFAULT_KIT)
    out = {**base, **{k: v for k, v in kit.items() if v is not None}}
    for key in ("colors", "fonts", "type", "motion"):
        out[key] = {**base[key], **(kit.get(key) or {})}
    return out


def design_note(kit: dict[str, Any]) -> str:
    """The kit as the design model reads it: the same identity for screens and videos."""
    c, f = kit["colors"], kit["fonts"]
    return (
        "هوية مساحة العمل (brand kit) — استعملها بالتصميم بدل ما تخترع ألوان وخطوط:\n"
        f"- الألوان: surface {c['surface']}، surface2 {c['surface2']}، النص {c['onSurface']}، "
        f"الثانوي {c['muted']}، الأساسي {c['primary']} (النص فوقه {c['onPrimary']})، accent {c['accent']}\n"
        f"- الخطوط: العناوين {f['display']}، النص {f['body']}، اللاتيني {f['latin']}\n"
        f"- الزوايا: {', '.join(str(r) for r in kit['radius'])}px · المسافات بمضاعفات 8px"
    )
