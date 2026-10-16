"""The designer's review: the bundled example passes, and the usual machine-made tells are
each caught with a note that says what to do."""

from pathlib import Path

from rafiq_agent.core.design_review import format_review, review
from rafiq_agent.core.designs import DESIGN_SYSTEM_PROMPT, design_guide_note, review_guide
from rafiq_agent.core.identity import STYLES, css_tokens, fonts_link, identity_note, normalize

# a hand-made landing page at the bar (kept out of the skill: a model shown a page copies it)
EXAMPLE = Path(__file__).resolve().parent / "fixtures/landing-example.html"

PLAIN = """<!doctype html><html lang="ar" dir="rtl"><head><style>
:root { --blue: #3366ff }
body { font-family: Arial; background: #fff; color: #000 }
h1 { font-size: 32px; letter-spacing: -1px }
.card { margin-left: 10px; padding-right: 8px; text-align: left; left: 0 }
.hero { background: linear-gradient(#667eea, #764ba2) }
</style></head><body>
<header><h1>مرحبا 👋</h1></header>
<section><div class="card">Feature 1</div><div class="card">ميزة</div><div class="card">ميزة</div></section>
<img src="https://via.placeholder.com/300">
</body></html>"""


def test_the_bundled_example_passes():
    r = review(EXAMPLE.read_text(encoding="utf-8"), "صفحة هبوط")
    assert r.notes == [], r.notes
    assert "passes" in format_review(r)


def test_a_plain_page_gets_a_note_for_each_tell():
    notes = " ".join(review(PLAIN, "صفحة هبوط").notes)
    for expected in ("tokens", "no fonts", "purple", "pure black", "headline tops out at 32px", "sections",
                     "nothing moves", "hover", "emoji", "placeholder", "external images", "breakpoints",
                     "physical left/right", "letter-spacing", "identical cards", "flat"):
        assert expected in notes, expected


def test_an_app_screen_is_held_to_app_sizes():
    html = EXAMPLE.read_text(encoding="utf-8").replace("clamp(46px, 7.4vw, 104px)", "32px")
    landing = " ".join(review(html, "صفحة هبوط").notes)
    app = " ".join(review(html, "لوحة تحكم").notes)
    assert "headline tops out" in landing
    assert "headline tops out" not in app


def test_the_design_chat_carries_the_guide_but_no_page_to_copy():
    note = design_guide_note()
    assert "Designing like a studio" in note and "<!doctype html>" not in note
    assert "design_review" in DESIGN_SYSTEM_PROMPT
    assert "Mistakes and their fixes" in review_guide()


def test_an_identity_is_normalized_and_becomes_binding_tokens():
    built = normalize({"style": "bold", "theme": "both", "colors": {"primary": "#123456", "ink": "nope"}, "fonts": {"display": "Comic Sans"}})
    assert built["colors"]["primary"] == "#123456"
    assert built["colors"]["ink"] == STYLES["bold"]["preset"]["colors"]["ink"]  # a bad value falls back
    assert built["fonts"]["display"] == "Lalezar"  # only offered fonts
    assert "dark" in built  # theme both gets a dark palette
    css = css_tokens(built)
    assert "--primary: #123456;" in css and '[data-theme="dark"]' in css
    assert "family=Lalezar:wght@400" in fonts_link(built)
    assert css in identity_note(built)


def test_the_review_holds_the_page_to_its_identity():
    page = EXAMPLE.read_text(encoding="utf-8")
    own = normalize({"style": "tech"})
    notes = " ".join(review(page, "صفحة هبوط", own).notes)
    assert "identity's colours" in notes and "fonts aren't loaded" in notes
