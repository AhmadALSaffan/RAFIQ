"""Art directions for websites: how a page is composed, picked by Rafiq for each new design.

The identity decides the colours, the fonts and the feel; left to itself, a model then builds
every page from the same habits (centred hero, three cards, numbers, CTA band) — it has no
memory of the pages it made before, so "never repeat yourself" can't work. Rafiq gives each
new site a concrete composition instead, one the user's recent designs didn't get, and the
model reads it with every turn (chat_service). Apps, dashboards and boards keep the product
conventions they need and get none.
"""

import random
from typing import Any

# `suits` is the page shapes from the brief ("layout") the direction works for; empty: any.
DIRECTIONS: dict[str, dict[str, Any]] = {
    "poster": {
        "name": "ملصقات متتالية",
        "suits": {"long", "short"},
        "brief": "The page is a sequence of posters. The hero is one enormous typographic statement filling the viewport, the product cropped off one edge. Every section after it is its own full-height poster carrying a single idea (one headline, one visual, one line). Signature moves: the headline words scale and settle in one by one; the sections snap gently as you scroll; one poster flips to the primary colour full-bleed.",
    },
    "index": {
        "name": "فهرس تحريري",
        "suits": {"long", "editorial"},
        "brief": "The page opens like a book: the hero is a numbered table of contents (4–7 chapters, each a link to its section with a one-line teaser), beside a short promise. Sections are chapters with big chapter numerals, asymmetric columns of different widths, and notes in the margin. Signature moves: the contents list highlights the chapter in view (sticky on wide screens); rules draw across between chapters; one pull quote breaks the grid.",
    },
    "tour": {
        "name": "جولة جوّا المنتج",
        "suits": {"long"},
        "brief": "Scrollytelling around the product. A drawn product mockup (screen, device or object) stays sticky on one side while 4–6 steps scroll past on the other; each step changes what the mockup shows (a highlight, a new state, a number updating). The hero is the mockup's first state with the headline over or beside it. Signature moves: the mockup's state crossfades per step; a progress line beside the steps fills; the last step zooms out to the whole product.",
    },
    "bento": {
        "name": "بينتو حيّ",
        "suits": {"grid", "short"},
        "brief": "The hero *is* the product: a bento grid of 5–8 tiles of different sizes, each a small working piece of the product (a live counter, a toggle that changes something, a mini chart, a message, a map pin), with the headline living in one large tile instead of above the grid. Below, fewer and bigger tiles go deeper. Signature moves: tiles assemble with a staggered spring; each tile reacts on hover; one tile is interactive for real.",
    },
    "conversation": {
        "name": "قصة بمحادثة",
        "suits": {"long", "short"},
        "brief": "The page is told as a conversation. The hero is a chat thread between a customer and the product (or its team): bubbles appear one after another, the last one is the call to action. Later sections answer the customer's questions — features, prices, proof — each opened by a question bubble; the FAQ is a thread too. Signature moves: typing dots before each answer; bubbles slide in from their side (mirrored in RTL); a reply chip the visitor can press reveals the next part.",
    },
    "split": {
        "name": "شاشة منقسمة",
        "suits": {"long", "editorial"},
        "brief": "The whole page is split in two columns that never merge on wide screens: one side is sticky (a big title, or a visual that changes per section), the other scrolls through the content in a narrow measure. Halfway down the split swaps sides once. On mobile it becomes one column with the sticky side as section headers. Signature moves: the sticky side's visual morphs as sections change; a counter of the section number ticks; the divider line grows with progress.",
    },
    "catalogue": {
        "name": "كتالوج مطبوع",
        "suits": {"grid", "editorial"},
        "brief": "A printed catalogue or spec sheet. A tight grid with hairline rules and numbered items (No. 01, 02…), each item a drawn object with its name, price or key figure, and a mono spec line; a comparison table set like print; small captions everywhere. The hero is the cover: the product name set huge, an issue or edition line, and the first item. Signature moves: items reveal row by row like a printer; hovering an item opens its spec sheet in place; a filter row re-sorts the grid with a FLIP animation.",
    },
    "path": {
        "name": "رحلة على خط",
        "suits": {"long"},
        "brief": "One continuous line (an SVG path) runs down the whole page and connects every section as stops on a journey — from the visitor's problem to the result. Sections sit on alternating sides of the line with a marker at each stop. The hero is the start of the line with the promise. Signature moves: the line draws itself as you scroll; each marker pops when the line reaches it; the line ends by circling the final call to action.",
    },
    "collage": {
        "name": "كولاج",
        "suits": {"grid", "short"},
        "brief": "A layered collage. The hero is an arrangement of overlapping pieces — cards, a drawn photo with tape, stickers, a ticket, notes — rotated a few degrees, with the headline cutting across them. Sections keep the layered feel: things overlap section edges, nothing sits in a neat box. Signature moves: pieces drop in and settle with a small rotation; a piece or two can be dragged a little and springs back; stickers peel slightly on hover.",
    },
    "manifesto": {
        "name": "بيان بالكلمات",
        "suits": {"long", "short", "editorial"},
        "brief": "Text-led and confident. The hero is a manifesto paragraph set very large (not a short headline), with the key words in the primary colour. The page alternates statements and proof: a huge sentence, then the evidence (a drawn product detail, a figure, a quote). Few visuals, each one big. Signature moves: the manifesto lights up word by word as it scrolls into view; proof blocks slide up under their statement; the closing statement is the call to action.",
    },
    "gallery": {
        "name": "معرض أفقي",
        "suits": {"long", "grid"},
        "brief": "An exhibition. The centrepiece is a pinned section whose track scrolls sideways as the visitor scrolls down: 4–7 framed exhibits (the product's uses, works, plans or rooms), each with a museum-style caption. The hero is the gallery's entrance: a title wall with one exhibit lit. Signature moves: the horizontal track driven by vertical scroll (moving with the reading direction); the exhibit in the centre scales up slightly; captions type in.",
    },
    "tool": {
        "name": "أداة شغّالة",
        "suits": {"short", "long"},
        "brief": "The hero is a working tool the visitor uses right away — a calculator, a configurator, a quiz or a planner made for this product — and it produces a personal result (a price, a plan, a recommendation). The rest of the page explains that result and why to trust it, and the final call to action carries it. Signature moves: the result number animates as inputs change; choices are big tappable chips; the result card can be 'kept' and follows to the end.",
    },
    "stack": {
        "name": "بطاقات مكدّسة",
        "suits": {"long", "grid"},
        "brief": "The story is a deck of large cards that stack as you scroll: each card (nearly full-width, rounded) is one feature or chapter and sticks at the top while the next one slides over it, the ones beneath shrinking a little. The hero is the top card of the deck, a different shape from the rest. Signature moves: the sticky stacking with scale; each card has its own tint from the identity; the last card flips over to reveal the call to action.",
    },
}

# The brief's page shapes (core/designs.py QUESTIONS, "layout"), by their Arabic text.
_LAYOUTS = {"طويلة بقصة كاملة": "long", "قصيرة ومركّزة": "short", "شبكة بطاقات": "grid", "تحريرية بأعمدة": "editorial"}
# The kinds of design that get a direction: sites and landing pages (apps keep their conventions).
_SITE_KINDS = ("موقع", "صفحة هبوط")


def _arabic(value: Any) -> str:
    """A brief answer back in Arabic, whichever language it was saved in."""
    from rafiq_agent.i18n import _DICTS

    text = str(value or "").strip()
    for d in _DICTS.values():
        for ar, other in d.items():
            if other == text:
                return ar
    return text


def wants_direction(brief: dict[str, Any] | None) -> bool:
    """A website or a landing page (or an old brief with no kind) — not an app or a board."""
    if not brief or brief.get("type") == "board":
        return False
    kind = _arabic(brief.get("kind"))
    return not kind or kind in _SITE_KINDS


def pick(brief: dict[str, Any], recent: list[str], rng: random.Random | None = None) -> str:
    """A direction for a new design: one that suits its page shape and that none of the
    user's recent designs got (the oldest-used one when they've all been used)."""
    rng = rng or random.Random()
    shape = _LAYOUTS.get(_arabic(brief.get("layout")))
    suited = [k for k, d in DIRECTIONS.items() if not shape or shape in d["suits"]] or list(DIRECTIONS)
    fresh = [k for k in suited if k not in recent]
    if fresh:
        return rng.choice(fresh)
    # every suited one was used lately: the one used longest ago
    return max(suited, key=lambda k: recent.index(k) if k in recent else len(recent))


def direction_note(key: str) -> str:
    """What the model reads with every turn of the design chat."""
    d = DIRECTIONS[key]
    return (
        f"الاتجاه الفني لهالتصميم — «{d['name']}». رفيق اختاره لهالمشروع ليطلع مختلف عن تصاميم المستخدم "
        "السابقة: الهوية بتقرر الألوان والخطوط والإحساس، وهاد بيقرر التكوين (الهيرو، هيكل الصفحة، الحركات "
        "المميزة). ابنِ الصفحة عليه وطبّقه بروح الهوية، ولا ترجع لهيكل القالب المعتاد (هيرو بالنص ← تلت "
        "بطاقات ← أرقام ← شريط CTA). أقسام المستخدم بالـ brief بتدخل جوّاه. إذا المستخدم طلب تكوين تاني، "
        "طلبه هو الأهم.\n" + d["brief"]
    )


# ── Variants ─────────────────────────────────────────────────────────────────────────────
#
# Three versions of the page side by side, each on another direction; the user keeps one.
# The model writes them as documents named `variant-<key>` (it reads which ones in
# `variants_note`), and choosing one makes it the design's page and its direction.

VARIANT_PREFIX = "variant-"


def pick_variants(brief: dict[str, Any], recent: list[str], n: int = 3, rng: random.Random | None = None) -> list[str]:
    """`n` different directions for variants, none of them the design's own, fresh ones first."""
    rng = rng or random.Random()
    current = brief.get("art")
    out: list[str] = []
    for _ in range(n):
        taken = [*out, *([current] if current else [])]
        key = pick(brief, [*taken, *recent], rng)
        if key in taken:
            key = rng.choice([k for k in DIRECTIONS if k not in taken])
        out.append(key)
    return out


def variants_note(keys: list[str]) -> str:
    """What the model reads while the user is waiting for variants."""
    lines = [
        "المستخدم طلب **3 نسخ بديلة** من الصفحة جنب بعض، ليختار وحدة. اكتب بهالرد 3 مستندات كاملة، كل واحد "
        "ببلوك ```html لحاله وأول سطر فيه اسمه بالظبط متل ما تحت. نفس الهوية (:root والخطوط) ونفس المحتوى "
        "والأقسام اللي طلبها المستخدم، بس كل نسخة مبنية على اتجاهها الفني: هيرو مختلف، هيكل مختلف، حركات "
        "مختلفة — لازم يبيّن الفرق من أول نظرة. لا تعيد المستند الرئيسي ولا تغيّره. قبل البلوكات اكتب سطر "
        "لكل نسخة: شو فكرتها."
    ]
    for key in keys:
        d = DIRECTIONS[key]
        lines.append(f"\n<!-- file: {VARIANT_PREFIX}{key} --> — «{d['name']}»:\n{d['brief']}")
    return "\n".join(lines)
