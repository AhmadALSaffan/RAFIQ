"""The checks that need no pixels: grid, easings, brand tokens, reading time, how much moves
at once, readable sizes, Lottie compatibility. The engine in the app runs these too, plus
the ones that do need pixels (contrast, overflow, safe area, overlap, jumps). When no app
window is open to draw, the agent still has these."""

import re
from typing import Any

from rafiq_agent.motion.brand import template

ALLOWED_EASE = re.compile(r"^(linear|inOut|in|out|outExpo|outBack|spring|brand|spring\(\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*\))$")
BLOCKING = {"M002", "M003", "M004"}
ERRORS = {"M002", "M003", "M004", "M007"}
MAJOR = {"fadeIn", "fadeUp", "fadeDown", "slideIn", "scaleIn", "pop", "typewriter", "wordPop", "lineReveal", "maskReveal", "wipe", "countUp", "drawOn", "zoomPunch"}
ENTRANCES = MAJOR - {"zoomPunch"}

FIXES = {
    "M001": "قرّب لأقرب وحدة شبكة (رقم صحيح)، والـ gap من السلّم: 1, 2, 3, 4, 6, 8, 12",
    "M005": "طوّل ظهور النص (0.5 ث + 0.3 ث لكل كلمة على الأقل) أو قصّر النص",
    "M006": "فرّق التوقيت: stagger بين 0.1 و 0.2 ث، وحركة رئيسية وحدة بالمرة",
    "M007": "بدّل الـ easing بواحد مسموح: linear, inOut, outExpo, outBack, spring",
    "M012": "استعمل ستايل أكبر (body أو title)",
    "L001": "Lottie ما بيحمل هالشي — شيله، أو صدّر MP4",
}


def _issue(code: str, layer: str | None, message: str, t: float | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "severity": "error" if code in ERRORS else "warning",
        "blocking": code in BLOCKING,
        "layer": layer,
        "t": t,
        "message": message,
        "fix": FIXES.get(code, ""),
    }


def _layers(scene: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(layers: list[dict[str, Any]]) -> None:
        for layer in layers:
            out.append(layer)
            walk(layer.get("children") or [])

    walk(scene.get("layers", []))
    return out


def structural(scene: dict[str, Any], kit: dict[str, Any] | None = None, target: str = "mp4") -> list[dict[str, Any]]:
    kit = kit or template(None)
    issues: list[dict[str, Any]] = []
    comp = scene.get("composition", {})
    short = min(comp.get("width", 1080), comp.get("height", 1080))
    layers = _layers(scene)
    gap_scale = set(kit.get("spacing") or [1, 2, 3, 4, 6, 8, 12])

    starts: dict[float, list[str]] = {}
    for layer in layers:
        lid = layer["id"]
        layout = layer.get("layout") or {}
        for key in ("x", "y", "width", "height"):
            value = layout.get(key)
            if isinstance(value, (int, float)) and abs(value - round(value)) > 1e-6:
                issues.append(_issue("M001", lid, f"layout.{key} = {value} مش وحدة شبكة كاملة"))
        if "gap" in layout and layout["gap"] not in gap_scale:
            issues.append(_issue("M001", lid, f"gap = {layout['gap']} مش من السلّم {sorted(gap_scale)}"))

        for anim in layer.get("animate") or []:
            if anim.get("ease") and not ALLOWED_EASE.match(anim["ease"]):
                issues.append(_issue("M007", lid, f"easing «{anim['ease']}» مش مسموح", anim.get("at")))
            if anim.get("preset") in MAJOR:
                starts.setdefault(round(float(anim.get("at", 0)) * 10) / 10, []).append(lid)
        for prop, keys in (layer.get("keyframes") or {}).items():
            for key in keys:
                if key.get("ease") and not ALLOWED_EASE.match(key["ease"]):
                    issues.append(_issue("M007", lid, f"easing «{key['ease']}» على {prop} مش مسموح", key.get("t")))

        if layer["type"] in ("text", "captions"):
            text = re.sub(r"\{count\}", "0", layer.get("text") or "")
            words = len(text.split())
            if layer["type"] == "text" and words:
                shown = layer["end"] - layer["start"]
                need = 0.5 + 0.3 * words
                if shown < need:
                    issues.append(_issue("M005", lid, f"النص ظاهر {shown:.1f} ث وبيلزمه {need:.1f} ث ليتقرأ ({words} كلمات)", layer["start"]))
            style = layer.get("style") or ("title" if layer["type"] == "captions" else "body")
            px = (kit.get("type") or {}).get(style, 32)
            if px < 28:
                issues.append(_issue("M012", lid, f"حجم {style} بالـ kit {px}px على 1080 — أصغر من المقروء (28)"))
            # A text scaled well below 1 for long stays too small too.
            for key in (layer.get("keyframes") or {}).get("scale", []):
                if isinstance(key.get("v"), (int, float)) and px * key["v"] < 28:
                    issues.append(_issue("M012", lid, f"النص بيصغر لـ {px * key['v']:.0f}px", key.get("t")))
                    break

        if target == "lottie":
            if layer["type"] in ("video", "image", "captions"):
                issues.append(_issue("L001", lid, f"طبقة {layer['type']} ما بتنصدّر لـ Lottie"))
            if layer.get("blend") not in (None, "normal") or layer.get("shadow"):
                issues.append(_issue("L001", lid, "blend أو shadow ما بينصدّروا لـ Lottie"))
            if (layer.get("keyframes") or {}).get("blur") or any(a.get("preset") in ("kenBurns",) for a in layer.get("animate") or []):
                issues.append(_issue("L001", lid, "blur و kenBurns ما بينصدّروا لـ Lottie"))
            if layer.get("filters"):
                issues.append(_issue("L001", lid, "فلاتر الألوان ما بتنصدّر لـ Lottie"))

    for at, ids in sorted(starts.items()):
        if len(set(ids)) > 3:
            issues.append(_issue("M006", None, f"{len(set(ids))} حركات رئيسية بنفس اللحظة ({', '.join(sorted(set(ids)))})", at))

    if target == "lottie" and scene.get("audio"):
        issues.append(_issue("L001", None, "الصوت ما بينصدّر مع Lottie (بيضل بالـ MP4 بس)"))
    _ = short
    return issues


def has_blocking(issues: list[dict[str, Any]]) -> bool:
    return any(i.get("blocking") for i in issues)
