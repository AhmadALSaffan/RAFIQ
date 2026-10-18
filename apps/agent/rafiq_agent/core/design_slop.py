"""`design_slop_check`: the tells that make a page look machine-made, counted in the HTML —
the purple gradient, glow, blobs and glass; gradient headlines; emoji icons; the template
section order; three identical cards; hero stats and "trusted by" strips; the stock copy
(in English and Arabic); and motion that treats everything the same. Each finding names
what was found and how often. The user's identity is respected: a colour or font the user
chose is never a tell. The full list, with what to do instead, is SLOP.md."""

import re
from dataclasses import dataclass, field
from pathlib import Path

_STYLE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")
# real emoji, not typographic symbols like ✓ ★ →
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF]|[☀-➿]️|[✅✨⚡❌⭐]")
_HEXES = re.compile(r"#[0-9a-fA-F]{6}\b")

# the AI-default violets, indigos and slates
_SLOP_HEX = {"#6366f1", "#4f46e5", "#818cf8", "#8b5cf6", "#7c3aed", "#a855f7", "#9333ea", "#c084fc", "#667eea", "#764ba2", "#ec4899", "#d946ef"}
_SLATE = {"#0f172a", "#111827", "#1e293b", "#020617", "#18181b"}
_DEFAULT_FONTS = {"inter", "roboto", "poppins", "montserrat", "open sans", "lato", "arial", "helvetica"}

STOCK_EN = [
    "unlock", "elevate", "empower", "seamless", "revolutioniz", "supercharge", "effortless", "cutting-edge", "next-generation",
    "next generation", "game-changer", "game changer", "all-in-one", "your journey", "next level", "built for the future",
    "powered by ai", "ai-powered", "transform your", "harness the power", "unleash", "streamline your", "boost your",
    "take control", "in today's", "world-class", "state-of-the-art", "robust", "leverage", "skyrocket", "lightning fast",
    "lightning-fast", "get started today", "join thousands", "trusted by thousands",
]
STOCK_AR = [
    "حلول مبتكرة", "نقلة نوعية", "بكل سهولة", "ارتق", "اكتشف قوة", "تجربة فريدة", "عالم من", "بلمسة زر", "ثورة في",
    "مستقبل ال", "حلول متكاملة", "بسلاسة", "أطلق العنان", "اطلق العنان", "رحلتك نحو", "لا مثيل لها", "الأفضل على الإطلاق",
    "نحن هنا من أجلك", "بكل احترافية", "جودة عالية", "تجربة استثنائية", "حلول ذكية", "مدعوم بالذكاء الاصطناعي",
    "بخطوات بسيطة", "كل ما تحتاجه", "في مكان واحد", "أفضل الحلول", "شريكك", "نسعى", "نحرص على",
]
_STOCK_CTA = re.compile(r">\s*(get started|learn more|start now|sign up free|ابدأ الآن|اعرف المزيد|اكتشف المزيد|ابدأ مجاناً|سجّل الآن)\s*<", re.I)
_FAKE_PEOPLE = re.compile(r"\b(john doe|jane doe|sarah j\.?|john smith|acme|your company|company name|lorem ipsum)\b|محمد أحمد|شركتك|اسم الشركة", re.I)
_STATS = re.compile(r"\b\d{1,3}(?:[.,]\d)?\s?(?:k|m|\+|%)(?=[\s<+])|24/7|99\.9", re.I)
_NEW_PILL = re.compile(r"(✨|new|introducing|جديد|نقدّم|نقدم|حصرياً)[^<]{0,40}</(span|div|a|p)>", re.I)


# An eyebrow: the small label over a headline ("• Available for work", "01 — FEATURES",
# "New in 2.0"). Found by its class name, or as a short element right before an h1/h2.
_EYEBROW_CLASS = re.compile(
    r"<(\w+)\b[^>]*class=[\"'][^\"']*\b(?:eyebrow|kicker|overline|pre-?title|super-?title|tagline|hero-?(?:badge|tag|label|pill|chip)|section-?(?:label|tag|kicker))\b[^\"']*[\"'][^>]*>(.*?)</\1>",
    re.S | re.I,
)
_BEFORE_HEADING = re.compile(
    r"<(p|span|div|small|a|em|strong)\b([^>]*)>((?:(?!</?(?:p|div|section|header|article|h[1-6])\b).){1,400}?)</\1>\s*<h([12])\b",
    re.S | re.I,
)


def eyebrows(html: str) -> list[tuple[str, bool]]:
    """Every eyebrow in the page: its text, and whether it sits over the main headline."""
    body = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    found: dict[str, bool] = {}

    def text_of(inner: str) -> str:
        return re.sub(r"\s+", " ", _TAGS.sub(" ", inner)).strip()

    for m in _BEFORE_HEADING.finditer(body):
        if "aria-hidden" in m.group(2):
            continue  # a decorative word behind the heading, not a label over it
        words = text_of(m.group(3))
        if words and len(words) <= 80 and len(words.split()) <= 12:
            found[words] = found.get(words, False) or m.group(4) == "1"
    for m in _EYEBROW_CLASS.finditer(body):
        words = text_of(m.group(2))
        if words and len(words) <= 80:
            found.setdefault(words, False)
    return list(found.items())


def eyebrow_note(html: str) -> str | None:
    found = eyebrows(html)
    if not found:
        return None
    hero = [w for w, top in found if top]
    examples = ", ".join(f"«{w[:40]}»" for w, _top in found[:4])
    where = " — including one over the main headline" if hero else ""
    return (
        f"{len(found)} eyebrow{'s' if len(found) > 1 else ''} (the small label over a headline: {examples}){where}. "
        "It's one of the surest signs a model made the page. Remove each one. If it carries real information "
        "(availability, a date, a step number, a category), move it where it belongs: into the headline or the "
        "sentence under it, next to the button, into the nav or the footer — never as a tag above a heading."
    )


@dataclass
class SlopReport:
    findings: list[str] = field(default_factory=list)
    clean: list[str] = field(default_factory=list)


def check(html: str, identity: dict | None = None) -> SlopReport:
    r = SlopReport()
    css = "\n".join(_STYLE.findall(html))
    body = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"\s+", " ", _TAGS.sub(" ", body))
    low = text.lower()
    chosen = {v.lower()[:7] for v in ((identity or {}).get("colors") or {}).values()} | {v.lower()[:7] for v in ((identity or {}).get("dark") or {}).values()}
    chosen_fonts = {f.lower() for f in ((identity or {}).get("fonts") or {}).values()}

    # ── colour ──
    gradients = re.findall(r"(?:linear|radial|conic)-gradient\(([^;{}]*)\)", css)
    violet = [g for g in gradients if {h.lower() for h in _HEXES.findall(g)} & (_SLOP_HEX - chosen) or re.search(r"\b(purple|violet|indigo|fuchsia)\b", g)]
    if violet:
        r.findings.append(f"{len(violet)} purple/indigo gradient{'s' if len(violet) > 1 else ''} — the most recognisable AI look. Use the identity's palette; one accent, few places.")
    slate = {h.lower() for h in _HEXES.findall(css)} & (_SLATE - chosen)
    if slate and violet:
        r.findings.append(f"the default dark slate ({', '.join(sorted(slate))}) under violet accents — the 'AI SaaS' night mode. Use the identity's dark palette.")
    if re.search(r"background-clip\s*:\s*text|-webkit-background-clip\s*:\s*text", css):
        r.findings.append("gradient text (background-clip: text) — a default trick. Solid ink; emphasise a word by weight, size or the primary colour.")
    glows = [s for s in re.findall(r"box-shadow\s*:\s*([^;{}]+)", css) if re.search(r"0\s+0\s+\d{2,}px", s) and not re.search(r"\b(?:#000|rgba?\(0,\s*0,\s*0|var\(--ink)", s)]
    if len(glows) >= 2:
        r.findings.append(f"{len(glows)} coloured glows (0 0 30px+ shadows) — light from nowhere. Use the identity's shadow token or a hairline.")
    blobs = len(re.findall(r"filter\s*:\s*blur\(\s*(?:[4-9]\d|\d{3,})px", css))
    if blobs >= 2 or (blobs and violet):
        r.findings.append(f"{blobs} blurred blob{'s' if blobs > 1 else ''} (blur 40px+) — the floating-orb background. Replace with the product drawn in HTML, a pattern from its world, or nothing.")
    glass = len(re.findall(r"backdrop-filter\s*:", css))
    if glass >= 3:
        r.findings.append(f"glass on {glass} surfaces (backdrop-filter) — keep it for one floating thing (the sticky nav); solid surfaces elsewhere.")

    # ── type ──
    loaded = {f.replace("+", " ").lower() for link in re.findall(r"fonts\.googleapis\.com/css2\?([^\"'>]+)", html) for f in re.findall(r"family=([^:&]+)", link)}
    used = {f.strip().strip("\"'").lower() for decl in re.findall(r"font-family\s*:\s*([^;{}]+)", css) for f in decl.split(",")[:1]}
    defaults = ((loaded | used) & _DEFAULT_FONTS) - chosen_fonts
    if defaults and not (loaded - _DEFAULT_FONTS):
        r.findings.append(f"only default faces ({', '.join(sorted(defaults))}) — the look of every generated page. Use the identity's fonts and its link.")
    eyebrow = eyebrow_note(html)
    if eyebrow:
        r.findings.append(eyebrow)
    caps = len(re.findall(r"text-transform\s*:\s*uppercase", css))
    if caps >= 5:
        r.findings.append(f"uppercase tracked labels in {caps} rules — an eyebrow over every section. Keep them where they carry information.")
    centred = len(re.findall(r"text-align\s*:\s*center", css))
    if centred >= 6:
        r.findings.append(f"text centred in {centred} rules — everything centred is the template look. Start-align running text; centre only a single statement.")

    # ── layout ──
    order = [m.lower() for m in re.findall(r"<(?:section|div|header|footer)[^>]*(?:id|class)=[\"'][^\"']*?(hero|logos?|trusted|features?|testimonials?|pricing|faq|cta)\b", html, re.I)]
    seen = list(dict.fromkeys(o.rstrip("s") for o in order))
    template = [s for s in ("hero", "logo", "feature", "testimonial", "pricing", "faq", "cta") if s in seen]
    if len(template) >= 5:
        r.findings.append(f"the template section order ({' → '.join(template)}) — the page every model writes. Tell the product's story in its own order, with sections of different shapes; drop the ones that say nothing.")
    three = re.findall(r"grid-template-columns\s*:\s*repeat\(\s*3\s*,\s*(?:1fr|minmax[^)]*\))\s*\)", css)
    icon_cards = len(re.findall(r"class=[\"'][^\"']*\b(?:feature|card)[^\"']*[\"'][^>]*>\s*<(?:div|span)[^>]*class=[\"'][^\"']*\bicon", html, re.I))
    if three and icon_cards >= 3:
        r.findings.append(f"{icon_cards} identical icon cards in a 3-column grid — the most generic layout. Use alternating rows with a drawn screen, a bento of different sizes, tabs or a timeline.")
    if _NEW_PILL.search(body[:6000]):
        r.findings.append("a 'New / ✨ Introducing' pill above the headline — only if there's real news; then say what, plainly.")
    hero = body[: max(4000, len(body) // 5)]
    stats = len(_STATS.findall(_TAGS.sub(" ", hero)))
    if stats >= 3:
        r.findings.append(f"a row of {stats} round figures near the top (10K+, 99.9%, 24/7) — stock social proof. Use one real figure the product owns, with its source, or none.")
    if re.search(r"trusted by|used by teams at|موثوق من|يثق بنا|بيثقوا فينا", low):
        r.findings.append("a 'trusted by' strip — unless the user gave real names, it's filler. Use a real quote, or remove it.")
    if re.search(r"most popular|الأكثر طلباً|الأكثر شعبية|الأكثر اختيار", low) and len(re.findall(r"class=[\"'][^\"']*\b(?:plan|tier|price-card|pricing-card)\b", html, re.I)) == 3:
        r.findings.append("three pricing tiers with the middle one 'most popular' — the default pricing block. Price the way this product sells (one plan, a calculator, a comparison).")
    big_radius = [float(v) for v in re.findall(r"border-radius\s*:\s*(\d+(?:\.\d+)?)px", css)]
    if identity and identity.get("radius") == "sharp" and sum(v >= 12 for v in big_radius) >= 3:
        r.findings.append("rounded corners (12px+) in a sharp identity — follow the identity's radius tokens.")
    elif not identity and len(big_radius) >= 6 and min(big_radius) >= 16:
        r.findings.append("every corner rounded 16px+ — pick a radius scale and follow it.")

    # ── copy ──
    stock = sorted({w for w in STOCK_EN if w in low} | {w for w in STOCK_AR if w in text})
    if stock:
        r.findings.append(f"stock phrases ({', '.join(stock[:10])}{'…' if len(stock) > 10 else ''}) — copy that fits any product. Say what it does, for whom, with a number or a concrete noun.")
    ctas = {m.lower() for m in _STOCK_CTA.findall(body)}
    if len(ctas) >= 2:
        r.findings.append(f"generic buttons ({', '.join(sorted(ctas))}) — name the action itself (‹try 14 days free›, ‹see prices›, ‹book a call›).")
    fakes = sorted({m.group(0) for m in _FAKE_PEOPLE.finditer(text)})
    if fakes or re.search(r"lorem ipsum", low):
        r.findings.append(f"placeholder people or companies ({', '.join(fakes[:5]) or 'lorem ipsum'}) — write real copy; testimonials only from real quotes the user gave.")
    if text.count("!") >= 4:
        r.findings.append(f"{text.count('!')} exclamation marks — hype. Plain, confident sentences.")
    emoji = _EMOJI.findall(text)
    if emoji:
        r.findings.append(f"{len(emoji)} emoji in the copy ({' '.join(dict.fromkeys(emoji[:6]))}) — they read as filler icons. Inline SVG in the palette, or nothing.")
    if re.search(r"©\s*20(1\d|2[0-4])", text):
        r.findings.append("a stale © year in the footer — use the current year (or none).")

    # ── motion ──
    if re.search(r"transition\s*:\s*all\b", css):
        r.findings.append("transition: all — name the properties (transform, opacity, color).")
    scales = len(re.findall(r":hover[^{]*\{[^}]*scale\(1\.0[5-9]|:hover[^{]*\{[^}]*scale\(1\.1", css))
    if scales >= 3:
        r.findings.append(f"{scales} hover rules that all scale up — each kind of thing should answer differently (buttons lift, cards deepen, links recolour).")
    infinite = len(re.findall(r"animation\s*:[^;{}]*\binfinite\b", css))
    if infinite >= 5:
        r.findings.append(f"{infinite} infinite animations — decorations that never stop. Keep one living detail that means something.")

    if not violet and len(glows) < 2:
        r.clean.append("no AI gradients or glows")
    if not stock:
        r.clean.append("no stock phrases")
    if not emoji:
        r.clean.append("no emoji icons")
    if not eyebrow:
        r.clean.append("no eyebrows")
    return r


def format_report(r: SlopReport) -> str:
    lines = [f"✗ {n}" for n in r.findings]
    if r.clean:
        lines.append(f"✓ {' · '.join(r.clean)}")
    lines.append("")
    lines.append(
        f"{len(r.findings)} measurable tell{'s' if len(r.findings) != 1 else ''}. Fix them, then read the page against the guide for the ones a check can't count."
        if r.findings
        else "no measurable tells — now read the page against the guide (copy, composition, story) for the ones a check can't count."
    )
    return "\n".join(lines)


def slop_guide() -> str:
    """The full list of tells, and what a studio does instead (SLOP.md)."""
    folder = Path(__file__).resolve().parent.parent / "skills" / "bundled" / "impeccable"
    return (folder / "SLOP.md").read_text(encoding="utf-8").strip()
