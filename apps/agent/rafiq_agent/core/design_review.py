"""The designer's review (`design_review`): a design document read the way a studio lead
reads it — is there an identity (tokens, fonts, an accent), does the hierarchy hold (a big
hero, real sections), does it move, does it survive a phone and RTL, and is it free of the
tells that make a page look machine-made. Static, so it works with any model and without
the app window; each note says what to do instead."""

import re
from dataclasses import dataclass, field

_STYLE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
_SCRIPT = re.compile(r"<script[^>]*>(.*?)</script>", re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")
_ROOT = re.compile(r":root[^{]*\{([^}]*)\}", re.S)
_VAR = re.compile(r"--[\w-]+\s*:")
_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)
_SIZE = re.compile(r"font-size\s*:\s*([^;]+)")
_PX = re.compile(r"(-?[\d.]+)(px|rem|em|vw)")
# real emoji, not typographic symbols like ★ or ☾
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF]|[☀-➿]️|[✅✨⚡❌⭐]")
_SLOP_GRADIENTS = ("#667eea", "#764ba2", "#6366f1", "#8b5cf6", "#a855f7", "#7c3aed")
_PHYSICAL = re.compile(r"(?<![\w-])(margin-left|margin-right|padding-left|padding-right|border-left|border-right|text-align\s*:\s*(?:left|right)|(?<![\w-])(?:left|right)\s*:)", re.I)
_GENERIC_FONTS = {"arial", "helvetica", "sans-serif", "serif", "system-ui", "tahoma", "segoe ui", "-apple-system", "times new roman", "inter", "roboto"}


@dataclass
class Review:
    notes: list[str] = field(default_factory=list)
    good: list[str] = field(default_factory=list)


def _px(value: str) -> float:
    """The largest size a font-size value reaches, in px (clamp/min/max read as their top)."""
    best = 0.0
    for num, unit in _PX.findall(value):
        n = float(num)
        if unit in ("rem", "em"):
            n *= 16
        elif unit == "vw":
            n *= 14.4  # at a 1440px window
        best = max(best, n)
    return best


def _rules(css: str) -> list[tuple[str, str]]:
    return [(sel.strip(), body) for sel, body in _RULE.findall(css)]


def review(html: str, kind: str = "", identity: dict | None = None) -> Review:
    """`identity` is the one the user built (core/identity.py), when the design has one."""
    r = Review()
    style = (identity or {}).get("style", "")
    motion_level = (identity or {}).get("motion", "medium")
    css = "\n".join(_STYLE.findall(html))
    js = "\n".join(_SCRIPT.findall(html))
    body = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"\s+", " ", _TAGS.sub(" ", body))
    rules = _rules(css)
    app = any(k in kind for k in ("لوحة", "dashboard", "تطبيق", "app")) and "هبوط" not in kind
    rtl = bool(re.search(r"dir\s*=\s*[\"']rtl", html, re.I))

    # ── the identity the user built: its colours and fonts, and nothing else ──
    if identity:
        palette = {v.lower()[:7] for v in identity.get("colors", {}).values()} | {v.lower()[:7] for v in (identity.get("dark") or {}).values()}
        missing = [role for role, v in identity.get("colors", {}).items() if v.lower()[:7] not in css.lower()]
        if missing:
            r.notes.append(f"the identity's colours aren't all in the page ({', '.join(missing)} missing) — copy its :root block as is and use the variables.")
        foreign = {h.lower()[:7] for h in re.findall(r"#[0-9a-fA-F]{6}\b", css)} - palette - {"#ffffff", "#000000"}
        if len(foreign) > 3:
            r.notes.append(f"{len(foreign)} colours that aren't in the identity ({', '.join(sorted(foreign)[:6])}…) — the user chose the palette; use its variables, and color-mix() for tints.")
        wanted = {f.lower() for f in identity.get("fonts", {}).values()}
        loaded = {f.replace("+", " ").lower() for link in re.findall(r"fonts\.googleapis\.com/css2\?([^\"'>]+)", html) for f in re.findall(r"family=([^:&]+)", link)}
        if wanted - loaded:
            r.notes.append(f"the identity's fonts aren't loaded ({', '.join(sorted(wanted - loaded))}) — use the identity's font link.")
        if not (wanted - loaded) and not missing and len(foreign) <= 3:
            r.good.append("follows the identity")

    tokens = sum(len(_VAR.findall(block)) for block in _ROOT.findall(css))
    if tokens < 8:
        r.notes.append(f"only {tokens} design tokens in :root — the identity isn't a system. Name 6–10 colours after the product's world (--paper --seal --flame …), plus fonts, radii, the ease curve and the shadow, and use them everywhere.")
    else:
        r.good.append(f"{tokens} tokens")
    fonts_link = re.findall(r"fonts\.googleapis\.com/css2\?([^\"'>]+)", html)
    families = {f.replace("+", " ").lower() for link in fonts_link for f in re.findall(r"family=([^:&]+)", link)}
    if not families:
        r.notes.append("no fonts loaded — the page falls back to system fonts and looks generic. Load a display face with character and a body face in one Google Fonts <link> (e.g. Readex Pro + IBM Plex Sans Arabic, Alexandria + IBM Plex Sans Arabic, Lalezar + Almarai).")
    elif families <= _GENERIC_FONTS:
        r.notes.append(f"only {', '.join(sorted(families))} — no face with character. Add a display face for the headings.")
    else:
        r.good.append("fonts: " + ", ".join(sorted(families)))
    lower = (css + html).lower()
    if any(g in lower for g in _SLOP_GRADIENTS) and "gradient" in lower:
        r.notes.append("the purple/indigo gradient is the most common AI-made look. Use the palette you named for this product instead.")
    if re.search(r"(?<![\w-])(background|color)\s*:\s*(#000|#000000|black)\b", css, re.I) and re.search(r"(?<![\w-])(background|color)\s*:\s*(#fff|#ffffff|white)\b", css, re.I):
        r.notes.append("pure black and pure white together — harsh and flat. Tint them: a paper like #f4f2ec, an ink like #161827.")

    # ── hierarchy ──
    h1_sizes = [_px(m) for sel, block in rules if re.search(r"(^|[\s,>])h1\b|\.hero|\.display|\.title-xl", sel) for m in _SIZE.findall(block)]
    h1 = max(h1_sizes, default=0)
    want = 30 if app else (48 if style in ("minimal", "luxury") else 64)
    if not re.search(r"<h1\b", html, re.I):
        r.notes.append("no <h1> — the page has no main headline. Give it one promise in 3–6 words, the biggest thing on the page.")
    elif h1 and h1 < want:
        r.notes.append(f"the main headline tops out at {h1:.0f}px — too small to lead. {'Use 28–36px for an app screen.' if app else 'Use clamp(46px, 7.4vw, 104px), weight 700–800.'}")
    elif h1:
        r.good.append(f"h1 up to {h1:.0f}px")
    sections = len(re.findall(r"<(section|header|footer)\b", html, re.I))
    if not app and sections < 6:
        r.notes.append(f"{sections} sections — thin for a landing page. Tell the product's story: what it promises, the problem, how it works, the proof, the ask — in sections of different shapes (see the guide's menu).")
    words = len(text.split())
    if not app and words < 180:
        r.notes.append(f"about {words} words of copy — too little to feel like a real product. Write real, specific copy for every section.")

    # ── motion ──
    keyframes = len(re.findall(r"@keyframes\s", css))
    transitions = len(re.findall(r"transition\s*:", css))
    hovers = len(re.findall(r":hover", css))
    observes = "IntersectionObserver" in js
    if keyframes == 0 and not observes:
        r.notes.append("nothing moves — the page reads as a static mockup. At the identity's motion level: sections reveal as they arrive (.rv + an IntersectionObserver), and the hero enters; medium and cinematic add living details.")
    elif not observes and not app:
        r.notes.append("no scroll reveals — sections just sit there. Mark them .rv and let an IntersectionObserver add .in, staggered by --i.")
    elif motion_level == "cinematic" and keyframes < 2:
        r.notes.append("the identity asks for cinematic motion, but almost nothing animates beyond reveals — add a bigger hero entrance, a marquee or scroll-linked effect, and floating or spring details.")
    else:
        r.good.append(f"{keyframes} animations{', scroll reveals' if observes else ''}")
    if hovers < 3:
        r.notes.append(f"{hovers} hover states — buttons and cards must answer the pointer: buttons lift 2px (the arrow nudges), cards lift 6px with a deeper shadow, links change colour.")
    if (keyframes or transitions) and "prefers-reduced-motion" not in css:
        r.notes.append("no prefers-reduced-motion — add a media query that shows everything at rest without movement.")
    if re.search(r"transition\s*:[^;}]*\b(width|height|top|left|margin)\b", css):
        r.notes.append("animating width/height/top/margin janks — animate transform, opacity and filter only.")

    # ── craft ──
    if _EMOJI.search(text):
        r.notes.append("emoji used as icons — they look cheap in a product. Draw simple inline SVG icons (24px strokes) or small CSS shapes in the palette.")
    if re.search(r"lorem ipsum|placeholder\.com|via\.placeholder|عنوان هنا|نص تجريبي|صورة هنا|image here|feature \d", html, re.I):
        r.notes.append("placeholder content (lorem, «عنوان هنا», placeholder images). Write real copy and draw the product in HTML.")
    external_imgs = re.findall(r"<img[^>]+src=[\"']https?://", html, re.I)
    if external_imgs:
        r.notes.append(f"{len(external_imgs)} external images — they may not load in the preview. Draw the product in HTML/CSS (a phone or browser frame with real UI) or use inline SVG.")
    if not re.search(r"@media[^{]*max-width|@media[^{]*min-width", css):
        r.notes.append("no breakpoints — at 380px the layout will overflow. Collapse grids to one column, hide the nav links, and scale type with clamp().")
    if rtl:
        physical = len(_PHYSICAL.findall(css))
        if physical > 2:
            r.notes.append(f"{physical} physical left/right properties in an RTL page — they break when the direction flips. Use margin-inline-start, padding-inline, inset-inline-end, text-align: start.")
        if any(re.search(r"letter-spacing\s*:\s*-", block) for sel, block in rules if re.search(r"(^|[\s,])(h1|h2|h3|body|p)\b", sel)):
            r.notes.append("negative letter-spacing on the headings of an Arabic page — it breaks the joins. Keep letter-spacing for Latin text only.")
    cards = len(re.findall(r"class=[\"'][^\"']*\bcard\b", html))
    if not app and cards >= 3 and "grid-column" not in css and "span" not in css:
        r.notes.append("a row of identical cards — the most generic layout there is. Use another shape from the guide's menu: alternating feature rows, a bento grid, tabs, a scroller, a timeline.")
    if not app and style not in ("minimal", "editorial", "luxury") and not re.search(r"backdrop-filter|::after|::before|blur\(|text-stroke|conic-gradient|radial-gradient|linear-gradient|box-shadow", css):
        r.notes.append("flat — no depth or texture anywhere. In the identity's style: layered surfaces, its shadow, a texture, a pattern, or a drawn graphic.")
    return r


def format_review(r: Review) -> str:
    lines = [f"✗ {n}" for n in r.notes]
    if r.good:
        lines.append(f"✓ {' · '.join(r.good)}")
    lines.append("")
    lines.append(f"{len(r.notes)} note{'s' if len(r.notes) != 1 else ''} to fix." if r.notes else "no notes — the design passes the review ✓")
    return "\n".join(lines)
