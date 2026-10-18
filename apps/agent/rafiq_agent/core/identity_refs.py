"""A visual identity from designs the user likes: links to sites, screenshots, saved HTML.
Rafiq reads each reference itself — the colours a site's CSS really uses (backgrounds apart
from text), its fonts, corner radii, shadows and motion, and a picture's dominant colours —
so even a model that can't open links or see images decides from facts. The model then
proposes one identity in the builder's terms (core/identity.py), which the user edits
before anything is designed."""

from __future__ import annotations

import colorsys
import contextlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote_plus, urljoin

import httpx

from rafiq_agent.core import font_catalog
from rafiq_agent.core import identity as identity_core
from rafiq_agent.i18n import current_locale, tr
from rafiq_agent.tools.web import USER_AGENT, _public_only

MAX_HTML = 1_500_000
MAX_CSS = 800_000
MAX_SHEETS = 12
MAX_LINKS = 6
MAX_IMAGES = 8

_HEX = re.compile(r"#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
_RGB = re.compile(r"rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)")
_HSL = re.compile(r"hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)")
_LAB = re.compile(r"(oklch|oklab|lch|lab)\(\s*([-\d.]+%?)\s+([-\d.]+%?)\s+([-\d.]+%?)(?:deg)?(?:\s*/\s*([\d.]+%?))?\s*\)", re.I)
_FONT_SIZE = re.compile(r"[\d.]+(?:px|r?em|%|pt|vw|vh)(?:\s*/\s*[\w.%-]+)?\s+(.+)$")
_ICON_FONTS = ("icon", "phosphor", "awesome", "symbols", "glyph", "material")
_DECL = re.compile(r"(?<![\w-])([\w-]+)\s*:\s*([^;{}]+)")
_SHEET = re.compile(r"<link\b[^>]*>", re.I)
_HREF = re.compile(r"href\s*=\s*[\"']([^\"']+)[\"']", re.I)
_IMPORT = re.compile(r"@import\s+(?:url\()?[\"']?([^\"')\s;]+)", re.I)
_STYLE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
_INLINE = re.compile(r"\sstyle\s*=\s*\"([^\"]*)\"", re.I)
_FACE = re.compile(r"@font-face\s*\{[^}]*font-family\s*:\s*[\"']?([^;\"'}]+)", re.I)
_GFONT = re.compile(r"fonts\.googleapis\.com/css2?\?([^\"'\s)>]+)", re.I)
_TAG_TEXT = re.compile(r"<(h1|h2|title)\b[^>]*>(.*?)</\1>", re.S | re.I)
_META = re.compile(r"<meta\b[^>]*>", re.I)
_SCRIPT_SRC = re.compile(r"<script\b[^>]*src\s*=\s*[\"']([^\"']+)", re.I)
_GENERIC = {"inherit", "initial", "sans-serif", "serif", "monospace", "system-ui", "-apple-system", "blinkmacsystemfont", "ui-sans-serif",
            "ui-serif", "ui-monospace", "cursive", "fantasy", "emoji", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji",
            "var", "unset", "revert"}
_MOTION_LIBS = ("gsap", "scrolltrigger", "lenis", "framer-motion", "motion", "aos", "lottie", "three", "locomotive", "barba", "swiper", "splide")
_CATALOG = {name.lower(): name for name, _c, _a, _w in font_catalog.FONTS}


@dataclass
class Reference:
    label: str
    ok: bool = True
    error: str = ""
    digest: str = ""
    images: list[str] = field(default_factory=list)  # data URLs, for a model that sees


# ── colours ──────────────────────────────────────────────────────────────────────────────


def _hex(r: int, g: int, b: int) -> str:
    return "#" + "".join(f"{max(0, min(255, v)):02x}" for v in (r, g, b))


def _colors_in(value: str) -> list[str]:
    """Every opaque-enough colour a CSS value names, as #rrggbb."""
    out: list[str] = []
    for m in _HEX.finditer(value):
        h = m.group(1)
        if len(h) in (3, 4):
            if len(h) == 4 and int(h[3], 16) < 6:
                continue
            h = "".join(c * 2 for c in h[:3])
        elif len(h) == 8:
            if int(h[6:], 16) < 96:
                continue
            h = h[:6]
        out.append("#" + h.lower())
    for m in _RGB.finditer(value):
        alpha = m.group(4)
        if alpha and (float(alpha.rstrip("%")) / (100 if alpha.endswith("%") else 1)) < 0.4:
            continue
        out.append(_hex(int(m.group(1)), int(m.group(2)), int(m.group(3))))
    for m in _HSL.finditer(value):
        alpha = m.group(4)
        if alpha and (float(alpha.rstrip("%")) / (100 if alpha.endswith("%") else 1)) < 0.4:
            continue
        r, g, b = colorsys.hls_to_rgb(float(m.group(1)) / 360, float(m.group(3)) / 100, float(m.group(2)) / 100)
        out.append(_hex(round(r * 255), round(g * 255), round(b * 255)))
    for m in _LAB.finditer(value):
        alpha = m.group(5)
        if alpha and (float(alpha.rstrip("%")) / (100 if alpha.endswith("%") else 1)) < 0.4:
            continue
        with contextlib.suppress(ValueError, OverflowError):
            out.append(_from_lab(m.group(1).lower(), m.group(2), m.group(3), m.group(4)))
    return out


def _num(v: str, percent_of: float) -> float:
    return float(v[:-1]) / 100 * percent_of if v.endswith("%") else float(v)


def _gamma(v: float) -> int:
    v = max(0.0, min(1.0, v))
    return round(255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055))


def _from_lab(space: str, l_: str, x: str, y: str) -> str:
    """oklch()/oklab() and lch()/lab() — what Tailwind 4 and many new sites write — as sRGB."""
    import math

    if space in ("oklch", "oklab"):
        lightness = _num(l_, 1.0)
        if space == "oklch":
            chroma, hue = _num(x, 0.4), math.radians(_num(y, 360))
            a, b = chroma * math.cos(hue), chroma * math.sin(hue)
        else:
            a, b = _num(x, 0.4), _num(y, 0.4)
        lm = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
        mm = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
        sm = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
        rgb = (4.0767416621 * lm - 3.3077115913 * mm + 0.2309699292 * sm,
               -1.2684380046 * lm + 2.6097574011 * mm - 0.3413193965 * sm,
               -0.0041960863 * lm - 0.7034186147 * mm + 1.7076147010 * sm)
    else:
        lightness = _num(l_, 100.0)
        if space == "lch":
            chroma, hue = _num(x, 150), math.radians(_num(y, 360))
            a, b = chroma * math.cos(hue), chroma * math.sin(hue)
        else:
            a, b = _num(x, 125), _num(y, 125)
        fy = (lightness + 16) / 116
        fx, fz = fy + a / 500, fy - b / 200

        def inv(t: float) -> float:
            return t**3 if t**3 > 0.008856 else (116 * t - 16) / 903.3

        X, Y, Z = 0.96422 * inv(fx), inv(fy), 0.82521 * inv(fz)  # noqa: N806 - the XYZ names
        rgb = (3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z,
               -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z,
               0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z)
    return _hex(*(_gamma(v) for v in rgb))


def _describe_color(h: str) -> str:
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (1, 3, 5))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    tone = "very dark" if light < 0.15 else "dark" if light < 0.35 else "very light" if light > 0.9 else "light" if light > 0.7 else "mid"
    if sat < 0.12:
        return f"{tone} neutral"
    names = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "violet", "magenta", "pink"]
    return f"{tone} {names[int(((hue * 360) + 15) % 360 // 30)]}"


# ── reading CSS and HTML ─────────────────────────────────────────────────────────────────


def _font_names(value: str) -> list[str]:
    names = []
    for part in value.replace("!important", "").split(","):
        n = part.strip().strip("\"'").strip()
        low = n.lower()
        if n and low not in _GENERIC and not low.startswith("var(") and not n[0].isdigit() and len(n) < 50 and not any(i in low for i in _ICON_FONTS):
            names.append(n)
    return names


def _google_families(text: str) -> list[str]:
    out = []
    for query in _GFONT.findall(text):
        for part in re.split(r"&(?:amp;)?", query):
            if part.startswith("family="):
                for fam in part[7:].split("|"):
                    out.append(unquote_plus(fam.split(":")[0]).strip())
    return out


def digest_css(css: str, html: str = "") -> str:
    """What a page's styles say about its identity, in a few lines a model can read."""
    backgrounds, texts, borders, others = Counter(), Counter(), Counter(), Counter()
    variables: dict[str, str] = {}
    fonts, radii, shadows = Counter(), Counter(), Counter()
    for prop, value in _DECL.findall(css):
        prop = prop.lower()
        if prop.startswith("--"):
            colors = _colors_in(value)
            if colors and len(variables) < 300:
                variables[prop] = colors[0]
            elif "font" in prop or "family" in prop:
                for n in _font_names(value)[:1]:
                    fonts[n] += 2
            continue
        if prop in ("font-family", "font"):
            families = value if prop == "font-family" else (m.group(1) if (m := _FONT_SIZE.search(value.strip())) else "")
            for n in _font_names(families)[:1]:
                fonts[n] += 1
            continue
        if prop == "border-radius":
            radii[value.strip()[:24]] += 1
            continue
        if prop == "box-shadow" and value.strip() not in ("none", "0", "inherit"):
            shadows[value.strip()[:80]] += 1
        colors = _colors_in(value)
        if not colors:
            continue
        target = backgrounds if prop.startswith("background") else texts if prop in ("color", "fill") else borders if prop.startswith(("border", "outline")) else others
        for c in colors:
            target[c] += 1
    for n in _FACE.findall(css):
        fonts[n.strip()] += 3
    for n in _google_families(css + html):
        fonts[n] += 5

    lines = []

    def top(counter: Counter, n: int) -> str:
        return ", ".join(f"{c} ({_describe_color(c)}, ×{k})" for c, k in counter.most_common(n))

    if backgrounds:
        lines.append(f"- background colours (most used first): {top(backgrounds, 8)}")
    if texts:
        lines.append(f"- text colours: {top(texts, 6)}")
    if borders:
        lines.append(f"- border colours: {top(borders, 4)}")
    if others:
        lines.append(f"- other colours (gradients, shadows, fills): {top(others, 6)}")
    if variables:
        # the ones whose names say what they are first: a design system's bg, text, brand…
        named = sorted(variables.items(), key=lambda kv: not re.search(r"bg|back|surface|text|ink|fg|fore|primary|accent|brand|border|muted", kv[0]))
        lines.append("- colour variables: " + ", ".join(f"{k}: {v}" for k, v in named[:28]))
    if fonts:
        known = [f"{n}{' (in the catalogue)' if n.lower() in _CATALOG else ''}" for n, _k in fonts.most_common(8)]
        lines.append(f"- fonts (most used first): {', '.join(known)}")
    if radii:
        lines.append(f"- border-radius values: {', '.join(f'{v} ×{k}' for v, k in radii.most_common(6))}")
    lines.append(f"- box-shadows: {sum(shadows.values())}" + (f", e.g. {shadows.most_common(1)[0][0]}" if shadows else ""))
    keyframes = len(re.findall(r"@keyframes\s", css))
    transitions = len(re.findall(r"transition\s*:", css))
    libs = sorted({lib for src in _SCRIPT_SRC.findall(html) for lib in _MOTION_LIBS if lib in src.lower()})
    lines.append(f"- motion: {keyframes} @keyframes, {transitions} transitions" + (f", libraries: {', '.join(libs)}" if libs else ""))
    return "\n".join(lines)


def _page_facts(html: str) -> list[str]:
    lines = []
    lang = re.search(r"<html\b[^>]*\blang\s*=\s*[\"']([\w-]+)", html, re.I)
    rtl = re.search(r"<html\b[^>]*\bdir\s*=\s*[\"']rtl", html, re.I)
    if lang or rtl:
        lines.append(f"- language: {lang.group(1) if lang else '?'}{', right-to-left' if rtl else ''}")
    for meta in _META.findall(html):
        if re.search(r"name\s*=\s*[\"']theme-color", meta, re.I) and (c := re.search(r"content\s*=\s*[\"']([^\"']+)", meta, re.I)):
            lines.append(f"- theme-color: {c.group(1)}")
        if re.search(r"name\s*=\s*[\"']description", meta, re.I) and (c := re.search(r"content\s*=\s*[\"']([^\"']+)", meta, re.I)):
            lines.append(f"- description: {c.group(1)[:200]}")
    heads = [(tag.lower(), re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()) for tag, text in _TAG_TEXT.findall(html)]
    heads = [(t, x) for t, x in heads if x][:6]
    if heads:
        lines.append("- headings: " + " | ".join(f"{t}: {x[:90]}" for t, x in heads))
    return lines


async def _get(client: httpx.AsyncClient, url: str, limit: int) -> tuple[str, str] | None:
    """A public URL's text (and its final address), or None. Local and private addresses
    are refused, the same as the web_fetch tool."""
    if await _public_only(url):
        return None
    try:
        async with client.stream("GET", url) as response:
            final = str(response.url)
            if final != url and await _public_only(final):
                return None
            if response.status_code >= 400:
                return None
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size > limit:
                    break
            return b"".join(chunks)[:limit].decode(response.encoding or "utf-8", errors="replace"), final
    except httpx.HTTPError:
        return None


async def _styles_of(client: httpx.AsyncClient | None, html: str, base: str | None) -> str:
    """The page's own CSS: inline blocks and attributes, then its stylesheets (and their
    @imports), skipping font CSS. Without a base address only absolute links are followed."""
    parts = _STYLE.findall(html) + [f"x{{{s}}}" for s in _INLINE.findall(html)[:400]]
    if client is None:
        return "\n".join(parts)
    hrefs = []
    for tag in _SHEET.findall(html):
        if re.search(r"rel\s*=\s*[\"'][^\"']*stylesheet", tag, re.I) and (h := _HREF.search(tag)):
            hrefs.append(urljoin(base, h.group(1)) if base else h.group(1))
    hrefs += [urljoin(base, u) if base else u for block in parts for u in _IMPORT.findall(block)]
    seen: set[str] = set()
    for href in hrefs:
        if len(seen) >= MAX_SHEETS:
            break
        if href in seen or "fonts.googleapis.com" in href or not href.startswith("http"):
            continue
        seen.add(href)
        got = await _get(client, href, MAX_CSS)
        if not got:
            continue
        parts.append(got[0])
        for u in _IMPORT.findall(got[0])[:2]:
            if "fonts.googleapis" not in u and (more := await _get(client, urljoin(href, u), MAX_CSS)):
                parts.append(more[0])
    return "\n".join(parts)


async def read_site(client: httpx.AsyncClient, url: str) -> Reference:
    ref = Reference(label=url)
    if not re.match(r"^https?://", url):
        url = "https://" + url
        ref.label = url
    got = await _get(client, url, MAX_HTML)
    if got is None:
        return Reference(label=url, ok=False, error=tr("ما قدرت أفتح الرابط"))
    html, final = got
    css = await _styles_of(client, html, final)
    ref.digest = "\n".join([f"Site {final}", *_page_facts(html), digest_css(css, html)])
    return ref


async def read_html(name: str, html: str, client: httpx.AsyncClient | None) -> Reference:
    """A saved page (an .html attachment). Absolute stylesheet links are fetched like a site's."""
    css = await _styles_of(client, html, "https://invalid.local/") if client else "\n".join(_STYLE.findall(html))
    return Reference(label=name, digest="\n".join([f"Saved page «{name}»", *_page_facts(html), digest_css(css, html)]))


def read_image(name: str, path: str) -> Reference:
    """A screenshot or picture: its dominant colours, measured (any model can use them),
    and the picture itself for a model that sees."""
    from PIL import Image

    from rafiq_agent.core.attachments import image_data_url

    with Image.open(path) as img:
        small = img.convert("RGB")
        small.thumbnail((240, 240))
        quant = small.quantize(colors=10, method=Image.Quantize.MEDIANCUT)
        palette = quant.getpalette() or []
        counts = sorted(quant.getcolors() or [], reverse=True)
    total = sum(n for n, _i in counts) or 1
    colors = [(n / total, _hex(*palette[i * 3 : i * 3 + 3])) for n, i in counts if i * 3 + 2 < len(palette)]
    listed = ", ".join(f"{h} ({_describe_color(h)}, {share:.0%})" for share, h in colors if share >= 0.01)
    return Reference(label=name, digest=f"Picture «{name}»\n- dominant colours by area (the largest is usually the background): {listed}", images=[image_data_url(path)])


# ── the model's proposal ─────────────────────────────────────────────────────────────────


# Latin faces worth offering by name; the whole catalogue (~600) would crowd a small
# model's window, and any family in it is accepted anyway.
LATIN_PICKS = (
    "Inter Tight", "Manrope", "DM Sans", "Space Grotesk", "Sora", "Outfit", "Plus Jakarta Sans", "Figtree", "Geist", "Instrument Sans",
    "Bricolage Grotesque", "Hanken Grotesk", "Schibsted Grotesk", "Archivo", "Syne", "Unbounded", "Familjen Grotesk", "Onest",
    "Work Sans", "Lexend", "Big Shoulders Display", "Anton", "Bebas Neue", "Oswald", "Archivo Black", "Fraunces", "Instrument Serif",
    "Newsreader", "Playfair Display", "Cormorant Garamond", "EB Garamond", "DM Serif Display", "Bodoni Moda", "Young Serif", "Gloock",
    "Source Serif 4", "Libre Caslon Text", "Bungee", "Shrikhand", "Titan One", "Dela Gothic One", "Monoton", "Fredoka", "Righteous",
    "Caveat", "Permanent Marker", "Kalam", "JetBrains Mono", "IBM Plex Mono", "Space Mono", "DM Mono", "Geist Mono", "Martian Mono",
)


def _catalogue_note(refs: list[Reference]) -> str:
    """Every Arabic family by class, the catalogue fonts the references use, and a Latin
    selection."""
    arabic: dict[str, list[str]] = {}
    for name, cls, has_arabic, _w in font_catalog.FONTS:
        if has_arabic:
            arabic.setdefault(cls, []).append(name)
    text = "\n".join(r.digest for r in refs).lower()
    used = [name for name, _c, _a, _w in font_catalog.FONTS if re.search(rf"\b{re.escape(name.lower())}\b", text)]
    lines = [f"- with Arabic, {cls}: {', '.join(names)}" for cls, names in arabic.items()]
    if used:
        lines.append(f"- used by the references and available: {', '.join(used)}")
    lines.append(f"- Latin (a selection — any Google Fonts family works if it exists): {', '.join(LATIN_PICKS)}")
    return "\n".join(lines)


def build_prompt(refs: list[Reference], notes: str, seen_pictures: str = "") -> list[dict[str, Any]]:
    styles = "\n".join(f"- {k}: {s['direction']}" for k, s in identity_core.STYLES.items())
    language = {"ar": "Arabic (a Levantine, friendly tone)", "en": "English", "ru": "Russian"}.get(current_locale(), "Arabic")
    system = (
        "You are a brand designer. The user collected designs they like. Read what Rafiq measured in each one, "
        "find what they share (the mood, the palette family, the type, the shapes, how much they move), and propose ONE "
        "visual identity for the user's own product that carries that taste — not a copy of one site.\n"
        "Answer with JSON only, no prose, with exactly these keys:\n"
        '{"name": "a short name for the identity", "style": one of the styles below, "theme": "light"|"dark"|"both", '
        '"colors": {"background","surface","ink","muted","line","primary","onPrimary","accent"} as #rrggbb (line may be #rrggbbaa), '
        '"dark": the same 8 roles for the dark theme (only when theme is "both"), '
        '"fonts": {"display": headings, "body": running text, "latin": Latin text and numbers}, '
        '"radius": "sharp"|"soft"|"round", "shadow": "none"|"soft"|"hard", "density": "airy"|"balanced"|"compact", '
        '"motion": "calm"|"medium"|"cinematic", "voice": "2-3 sentences on tone and do/don\'t, drawn from the references", '
        f'"why": "3-5 short lines, in {language}, telling the user what you took from which reference"}}\n'
        "Rules:\n"
        "- Colours come from the references' real values (background colours are the most used backgrounds). Keep ink on "
        "background and onPrimary on primary at 4.5:1 contrast or more; adjust lightness, not hue, to get there.\n"
        "- Fonts must be names from the catalogue below, exactly as written. Prefer a font the references use when it is in "
        "the catalogue; otherwise the closest one in the same class. The pages are Arabic-first: display and body need "
        "Arabic (a Latin-only display face is allowed only when the references are clearly Latin and the body has Arabic).\n"
        "- radius: sharp for 0–4px corners, soft for 6–16px, round for 18px+ or pills. shadow: hard for offset solid shadows, "
        "soft for blurred ones, none when there are few. motion: from the keyframes, transitions and libraries.\n"
        f"Styles:\n{styles}\n\nFont catalogue (Google Fonts):\n{_catalogue_note(refs)}"
    )
    body = ["The references:"]
    for i, r in enumerate(refs, 1):
        body.append(f"\n[{i}] {r.digest}")
    if seen_pictures:
        body.append(f"\nWhat the pictures show (described by a vision model):\n{seen_pictures}")
    if notes.strip():
        body.append(f"\nThe user's notes: {notes.strip()[:1500]}")
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n".join(body)}]


def _json_of(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON in the answer")
    return json.loads(text[start : end + 1])


def _catalog_font(name: Any) -> str | None:
    if not isinstance(name, str):
        return None
    key = name.strip().strip("\"'").lower()
    return _CATALOG.get(key) or _CATALOG.get(key.replace("-", " "))


def proposal(raw: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """The model's answer as a clean identity (core/identity.normalize), and its reasons."""
    fonts = raw.get("fonts") if isinstance(raw.get("fonts"), dict) else {}
    raw = {**raw, "fonts": {slot: _catalog_font(fonts.get(slot)) for slot in ("display", "body", "latin")}}
    data = identity_core.normalize(raw)
    data["logo"] = ""
    why = raw.get("why") or ""
    # some models answer the reasons as a list of lines
    why = "\n".join(str(x) for x in why) if isinstance(why, list) else str(why)
    return data, why.strip()[:1200]


async def references_from(urls: list[str], attachments: list[Any]) -> list[Reference]:
    refs: list[Reference] = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=20, headers={"User-Agent": USER_AGENT}) as client:
        for url in [u.strip() for u in urls if u.strip()][:MAX_LINKS]:
            refs.append(await read_site(client, url))
        images = 0
        for a in attachments:
            if a.kind == "image" and images < MAX_IMAGES:
                images += 1
                try:
                    refs.append(read_image(a.name, a.path))
                except Exception:  # noqa: BLE001 - an unreadable picture is reported, not raised
                    refs.append(Reference(label=a.name, ok=False, error=tr("ما قدرت أقرأ الصورة")))
            elif a.kind == "text" and Path(a.path).suffix.lower() in (".html", ".htm", ".css"):
                text = ""
                with contextlib.suppress(OSError):
                    text = Path(a.path).read_text(encoding="utf-8", errors="replace")[:MAX_HTML]
                if Path(a.path).suffix.lower() == ".css":
                    refs.append(Reference(label=a.name, digest=f"Stylesheet «{a.name}»\n{digest_css(text)}"))
                else:
                    refs.append(await read_html(a.name, text, client))
            else:
                refs.append(Reference(label=a.name, ok=False, error=tr("نوع الملف هاد ما بينفع كمرجع — صور أو HTML أو CSS")))
    return refs


DESIGN_EYE = (
    "You are the eyes of a brand designer who can't see. For each picture, describe its visual identity in short "
    "points: light or dark, the background and the main colours (estimate hex values), the accent and where it is "
    "used, the type (serif, sans, display, handwritten; heavy or light; how big the headings are), corner shapes, "
    "shadows and depth, spacing (airy or dense), textures or illustrations, and the overall mood. No guessing beyond "
    "what is visible."
)


async def propose(model: Any, refs: list[Reference], notes: str) -> tuple[dict[str, Any], str]:
    """The identity `model` (an LlmModel row) proposes from the references. A model that
    sees gets the pictures themselves; one that doesn't gets them described by the vision
    model in Settings, when there is one — the measured colours reach it either way."""
    from rafiq_agent.auth.resolve import llm_for
    from rafiq_agent.core.vision import describe_images
    from rafiq_agent.llm.discovery import supports_vision

    usable = [r for r in refs if r.ok]
    images = [(r.label, img) for r in usable for img in r.images]
    llm = llm_for(model)
    try:
        sees = supports_vision(llm.model) is not False
        seen = ""
        if images and not sees:
            with contextlib.suppress(Exception):
                seen = await describe_images([i for _l, i in images], [f"«{label}»:" for label, _i in images], prompt=DESIGN_EYE, max_tokens=1600)
        messages = build_prompt(usable, notes, seen)
        if images and sees:
            parts: list[dict[str, Any]] = [{"type": "text", "text": messages[1]["content"]}]
            for label, img in images:
                parts += [{"type": "text", "text": f"«{label}»:"}, {"type": "image_url", "image_url": {"url": img}}]
            messages[1] = {"role": "user", "content": parts}
        text = await llm.complete(messages, max_tokens=6000)
        try:
            raw = _json_of(text)
        except ValueError:
            messages += [{"role": "assistant", "content": text}, {"role": "user", "content": "Answer again with the JSON object only."}]
            raw = _json_of(await llm.complete(messages, max_tokens=6000))
    finally:
        await llm.aclose()
    return proposal(raw)
