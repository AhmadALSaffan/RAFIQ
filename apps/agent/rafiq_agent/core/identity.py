"""Visual identities for designs: the user builds one (colours, fonts, shape, depth, density,
motion) before the model draws anything, and every design made with it uses exactly those
tokens. The style presets are starting points the user edits, not themes the model picks."""

import re
from typing import Any

from rafiq_agent.core import font_catalog

COLOR_ROLES = ["background", "surface", "ink", "muted", "line", "primary", "onPrimary", "accent"]

# Every Google Font the builder offers (core/font_catalog.py), with the weights each family
# really has. Any family fits any slot: an Arabic page whose heading face has no Arabic falls
# back to the body face for the Arabic letters.
WEIGHTS: dict[str, str] = {name: weights for name, _cls, _ar, weights in font_catalog.FONTS}


CHOICES = {
    "theme": ["light", "dark", "both"],
    "radius": ["sharp", "soft", "round"],
    "shadow": ["none", "soft", "hard"],
    "density": ["airy", "balanced", "compact"],
    "motion": ["calm", "medium", "cinematic"],
}

RADIUS = {"sharp": ("0px", "2px", "4px"), "soft": ("8px", "14px", "22px"), "round": ("14px", "24px", "36px")}
SHADOW = {
    "none": "none",
    "soft": "0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent), 0 24px 60px -28px color-mix(in srgb, var(--ink) 28%, transparent)",
    "hard": "6px 6px 0 var(--ink)",
}
DENSITY = {"airy": ("160px", "18px"), "balanced": ("120px", "17px"), "compact": ("84px", "16px")}
MOTION = {
    "calm": ("0.9s", "cubic-bezier(.22, 1, .36, 1)"),
    "medium": ("0.7s", "cubic-bezier(.16, 1, .3, 1)"),
    "cinematic": ("0.9s", "cubic-bezier(.34, 1.4, .64, 1)"),
}


def _preset(style: str, theme: str, colors: dict[str, str], fonts: tuple[str, str, str], radius: str, shadow: str, density: str, motion: str) -> dict[str, Any]:
    return {
        "style": style, "theme": theme, "colors": colors,
        "fonts": {"display": fonts[0], "body": fonts[1], "latin": fonts[2]},
        "radius": radius, "shadow": shadow, "density": density, "motion": motion,
    }


# Each style: a starting identity, and how a studio builds a page in it (for the model).
STYLES: dict[str, dict[str, Any]] = {
    "minimal": {
        "label": "مينيمال هادي",
        "preset": _preset("minimal", "light", {"background": "#fafaf8", "surface": "#ffffff", "ink": "#151515", "muted": "#6b6b67", "line": "#1515151a", "primary": "#151515", "onPrimary": "#fafaf8", "accent": "#3f6b4f"}, ("Readex Pro", "IBM Plex Sans Arabic", "Inter"), "soft", "none", "airy", "calm"),
        "direction": "Space is the material. Huge margins, an asymmetric 12-column grid, headings big but light (weight 400–500), hairlines instead of boxes, one small accent detail per screen. No glows, grain, gradients or busy cards. Motion is slow fades and gentle rises only; hover is an underline or a colour change. Imagery is calm: a single product shot drawn in HTML, generous negative space around it.",
    },
    "bold": {
        "label": "جريء وصاخب",
        "preset": _preset("bold", "light", {"background": "#f4f3ee", "surface": "#ffffff", "ink": "#0b0b0b", "muted": "#454545", "line": "#0b0b0b", "primary": "#ff4310", "onPrimary": "#0b0b0b", "accent": "#2d5bff"}, ("Lalezar", "Almarai", "Space Grotesk"), "sharp", "hard", "compact", "cinematic"),
        "direction": "Loud and graphic. Type is the image: headlines 120–200px that run edge to edge, full-bleed blocks of the primary colour, thick 2–3px ink borders, hard offset shadows, stickers and tags rotated a few degrees, a marquee of words. Sections collide instead of floating in space. Motion is punchy: big slides, scale pops, a marquee, hover that shifts the hard shadow.",
    },
    "luxury": {
        "label": "فخم وأنيق",
        "preset": _preset("luxury", "dark", {"background": "#0e0d0b", "surface": "#181612", "ink": "#f1ebdd", "muted": "#a39b8a", "line": "#f1ebdd24", "primary": "#c8a96b", "onPrimary": "#0e0d0b", "accent": "#7d8c72"}, ("El Messiri", "IBM Plex Sans Arabic", "Cormorant Garamond"), "sharp", "none", "airy", "calm"),
        "direction": "Quiet and expensive. Centred, symmetrical compositions; thin rules in the primary (gold) colour; small captions under figures; large dark panels with a subtle gradient or texture standing in for photography; few words, lots of air. Nothing bounces: reveals are slow (1–1.2s) fades and masks, hover is a thin line drawing in.",
    },
    "playful": {
        "label": "مرح وملوّن",
        "preset": _preset("playful", "light", {"background": "#fff7ec", "surface": "#ffffff", "ink": "#2a2250", "muted": "#6c6690", "line": "#2a225014", "primary": "#ff6f9c", "onPrimary": "#2a2250", "accent": "#3ccfc0"}, ("Baloo Bhaijaan 2", "Rubik", "Fredoka"), "round", "soft", "balanced", "cinematic"),
        "direction": "Friendly and alive. Soft blobs and wavy SVG dividers, sections in different pastel tints, cards tilted −2…3°, sticker-like badges, simple illustrated characters or objects built from shapes. Big rounded buttons. Motion uses springs: elements pop in, float, wiggle on hover; nothing is stiff.",
    },
    "tech": {
        "label": "تقني داكن",
        "preset": _preset("tech", "dark", {"background": "#07080c", "surface": "#10121a", "ink": "#e7e9f0", "muted": "#8a90a3", "line": "#ffffff14", "primary": "#7cf2a4", "onPrimary": "#03140a", "accent": "#62a8ff"}, ("Alexandria", "IBM Plex Sans Arabic", "JetBrains Mono"), "soft", "none", "balanced", "medium"),
        "direction": "Precise and technical. A faint grid or dot pattern behind everything, mono numbers and code, terminal and code blocks, product UI drawn dark with real data, thin borders with a glow of the primary on focus. Layouts are dense and aligned. Motion: lines and borders draw in, numbers tick, a cursor blinks, panels slide on a grid.",
    },
    "editorial": {
        "label": "تحريري متل المجلات",
        "preset": _preset("editorial", "light", {"background": "#f2eee5", "surface": "#fbf9f4", "ink": "#1b1815", "muted": "#6a6359", "line": "#1b181526", "primary": "#b42a1f", "onPrimary": "#fbf9f4", "accent": "#20395c"}, ("Amiri", "Noto Naskh Arabic", "Newsreader"), "sharp", "none", "balanced", "calm"),
        "direction": "A magazine. Multi-column layouts with columns of different widths, big serif headlines, rules between columns, an issue number in the masthead, pull quotes, captions under drawn figures, a drop cap. Hierarchy comes from type and rules, not boxes. Motion is restrained: text reveals line by line, rules draw across.",
    },
    "craft": {
        "label": "دافئ وحِرَفي",
        "preset": _preset("craft", "light", {"background": "#efe4d1", "surface": "#f8efe1", "ink": "#3a2a1b", "muted": "#7b6650", "line": "#3a2a1b24", "primary": "#c0552c", "onPrimary": "#fff7ec", "accent": "#5d7a49"}, ("Reem Kufi", "Almarai", "Instrument Sans"), "round", "soft", "airy", "medium"),
        "direction": "Made by hand. Paper texture, hand-drawn SVG strokes (underlines, arrows, circles around words), stamps and round badges, organic shapes, framed 'photos' drawn as cards with tape, a warm earthy rhythm. Motion: strokes draw on, stamps press in, cards settle with a small rotation.",
    },
    "corporate": {
        "label": "مؤسسي موثوق",
        "preset": _preset("corporate", "light", {"background": "#f5f7fb", "surface": "#ffffff", "ink": "#0f1b2e", "muted": "#596a80", "line": "#0f1b2e1a", "primary": "#1f4fd6", "onPrimary": "#ffffff", "accent": "#0f9f9a"}, ("Cairo", "IBM Plex Sans Arabic", "Inter"), "soft", "soft", "balanced", "calm"),
        "direction": "Clear and credible. A structured grid, a logos row, trust badges and certifications, data cards with real figures, a comparison table, case studies with numbers. Plain, confident copy. Motion is calm: fades and rises, numbers count up, hover lifts cards slightly.",
    },
}

_HEX = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")


def presets() -> list[dict[str, Any]]:
    return [{"key": k, "label": v["label"], "preset": v["preset"]} for k, v in STYLES.items()]


def normalize(raw: dict[str, Any] | None) -> dict[str, Any]:
    """A clean identity: every field present and valid, anything unknown falling back to
    the style's preset."""
    raw = raw or {}
    style = raw.get("style") if raw.get("style") in STYLES else "minimal"
    base = STYLES[style]["preset"]
    out: dict[str, Any] = {"name": str(raw.get("name") or STYLES[style]["label"])[:60], "style": style}
    for key, options in CHOICES.items():
        out[key] = raw.get(key) if raw.get(key) in options else base[key]

    def palette(given: Any, fallback: dict[str, str]) -> dict[str, str]:
        given = given if isinstance(given, dict) else {}
        return {role: (given.get(role) if isinstance(given.get(role), str) and _HEX.match(given.get(role)) else fallback[role]) for role in COLOR_ROLES}

    out["colors"] = palette(raw.get("colors"), base["colors"])
    if out["theme"] == "both":
        out["dark"] = palette(raw.get("dark"), derive_dark(out["colors"]))
    fonts = raw.get("fonts") if isinstance(raw.get("fonts"), dict) else {}
    out["fonts"] = {slot: (fonts.get(slot) if fonts.get(slot) in WEIGHTS else base["fonts"][slot]) for slot in ("display", "body", "latin")}
    out["logo"] = str(raw.get("logo") or "")[:40]
    out["voice"] = str(raw.get("voice") or "")[:600]
    return out


def _mix(a: str, b: str, t: float) -> str:
    ca = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb, strict=True))


def derive_dark(c: dict[str, str]) -> dict[str, str]:
    """A dark palette from a light one (or the reverse): grounds from the ink, ink from the
    ground, the brand colours kept."""
    ink, bg = c["ink"][:7], c["background"][:7]
    return {
        "background": _mix(ink, "#000000", 0.35), "surface": _mix(ink, bg, 0.08), "ink": bg, "muted": _mix(bg, ink, 0.4),
        "line": bg + "1f", "primary": c["primary"], "onPrimary": c["onPrimary"], "accent": c["accent"],
    }


def fonts_link(identity: dict[str, Any]) -> str:
    seen: dict[str, str] = {}
    for slot in ("display", "body", "latin"):
        name = identity["fonts"][slot]
        seen.setdefault(name, WEIGHTS.get(name) or "400;700")
    families = "&".join(f"family={n.replace(' ', '+')}:wght@{w}" for n, w in seen.items())
    return f"https://fonts.googleapis.com/css2?{families}&display=swap"


def css_tokens(identity: dict[str, Any]) -> str:
    """The :root block every design made with this identity starts from."""
    r1, r2, r3 = RADIUS[identity["radius"]]
    section, body = DENSITY[identity["density"]]
    speed, ease = MOTION[identity["motion"]]
    f = identity["fonts"]

    def colors(c: dict[str, str]) -> str:
        names = {"onPrimary": "on-primary"}
        return " ".join(f"--{names.get(k, k)}: {v};" for k, v in c.items())

    lines = [
        ":root {",
        f"  {colors(identity['colors'])}",
        f'  --display: "{f["display"]}", "{f["body"]}", sans-serif; --body: "{f["body"]}", sans-serif; --latin: "{f["latin"]}", sans-serif;',
        f"  --r-sm: {r1}; --r-md: {r2}; --r-lg: {r3}; --pill: {'4px' if identity['radius'] == 'sharp' else '999px'};",
        f"  --shadow: {SHADOW[identity['shadow']]};",
        f"  --section: {section}; --text: {body}; --speed: {speed}; --ease: {ease};",
        "}",
    ]
    if identity["theme"] == "both" and identity.get("dark"):
        lines.append(f'[data-theme="dark"] {{ {colors(identity["dark"])} }}')
    return "\n".join(lines)


def identity_note(identity: dict[str, Any]) -> str:
    """What the model reads: the identity the user built, as binding tokens, and how a page
    in its style is composed."""
    style = STYLES[identity["style"]]
    theme = {"light": "light", "dark": "dark", "both": "light by default, with a dark theme under [data-theme=\"dark\"] and a toggle that remembers the choice"}[identity["theme"]]
    lines = [
        f"هوية التصميم — بناها المستخدم بنفسه («{identity['name']}»). هي قرار، مش اقتراح:",
        "- انسخ بلوك الـ :root هاد كما هو بأول الـ <style> واستعمل متغيراته بكل مكان. لا ألوان ولا خطوط غيرها "
        "(ظلال أخف أو أغمق من نفس الألوان بـ color-mix مسموحة).",
        f"- الخطوط برابط واحد: <link href=\"{fonts_link(identity)}\" rel=\"stylesheet\">",
        "```css",
        css_tokens(identity),
        "```",
        f"- الأسلوب: {style['label']} — {style['direction']}",
        f"- السمة: {theme}. الزوايا: {identity['radius']}. الظل: {identity['shadow']}. الكثافة: {identity['density']} "
        f"(مسافة الأقسام var(--section)). الحركة: {identity['motion']} (var(--speed) و var(--ease)).",
    ]
    if identity.get("logo"):
        lines.append(f"- الاسم/الشعار النصي: «{identity['logo']}» — اعمله wordmark بخط العناوين، مع علامة SVG بسيطة من ألوان الهوية إذا بتناسب.")
    if identity.get("voice"):
        lines.append(f"- صوت الهوية وملاحظات المستخدم: {identity['voice']}")
    lines.append("- إنت بتقرر: ترتيب الأقسام وشكلها والحركات المميزة — بروح هالأسلوب، ومختلفة عن أي تصميم سابق.")
    return "\n".join(lines)
