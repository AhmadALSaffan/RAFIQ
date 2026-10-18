"""The AI-slop check: a page made of every default is caught on each tell, the hand-made
example passes, and a colour or font the user chose for the identity is never a tell."""

from pathlib import Path

from rafiq_agent.core.design_review import review
from rafiq_agent.core.design_slop import check, eyebrows, format_report, slop_guide

EXAMPLE = Path(__file__).resolve().parent / "fixtures/landing-example.html"

SLOP = """<html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700" rel="stylesheet"><style>
body{font-family:Inter;background:#0f172a} .hero{text-align:center;background:linear-gradient(135deg,#6366f1,#a855f7)}
h1{-webkit-background-clip:text;background-clip:text}
.card{box-shadow:0 0 40px rgba(99,102,241,.5);transition:all .3s} .x{box-shadow:0 0 60px #8b5cf6}
.card:hover{transform:scale(1.05)} .b:hover{transform:scale(1.05)} .c:hover{transform:scale(1.1)}
.grid{grid-template-columns:repeat(3,1fr)} .blob{filter:blur(120px)}
</style></head><body>
<section class="hero"><span>✨ New: AI-powered</span><h1>Unlock your potential with seamless workflows!</h1>
<p>10K+ users 99.9% uptime 24/7 support</p><a>Get started</a><a>Learn more</a></section>
<section class="logos">Trusted by</section>
<section class="features"><div class="grid"><div class="card"><div class="icon">🚀</div></div><div class="card"><div class="icon">⚡</div></div><div class="card"><div class="icon">🔒</div></div></div></section>
<section class="testimonials">John Doe ✓ ★</section><section class="pricing">Most popular</section><section class="faq"></section>
<section class="cta">!!!</section><footer>© 2024 Acme — حلول مبتكرة بكل سهولة</footer></body></html>"""


def test_a_page_of_defaults_is_caught_on_every_tell():
    found = "\n".join(check(SLOP).findings)
    for tell in ("purple/indigo gradient", "dark slate", "gradient text", "coloured glows", "blurred blob", "default faces",
                 "template section order", "identical icon cards", "Introducing", "round figures", "trusted by",
                 "stock phrases", "generic buttons", "placeholder people", "exclamation", "emoji", "stale ©",
                 "transition: all", "scale up"):
        assert tell in found, tell
    assert "حلول مبتكرة" in found and "بكل سهولة" in found


def test_symbols_are_not_emoji():
    found = "\n".join(check(SLOP).findings)
    emoji_line = next(n for n in found.splitlines() if "emoji" in n)
    assert "✓" not in emoji_line and "★" not in emoji_line


def test_the_hand_made_example_passes():
    r = check(EXAMPLE.read_text(encoding="utf-8"))
    assert r.findings == [], r.findings
    assert "no measurable tells" in format_report(r)


def test_the_users_own_choices_are_not_tells():
    page = """<html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400" rel="stylesheet"><style>
    body{font-family:Inter} .hero{background:linear-gradient(#8b5cf6,#6d28d9)}</style></head><body><h1>x</h1></body></html>"""
    identity = {"colors": {"primary": "#8b5cf6", "accent": "#6d28d9"}, "fonts": {"display": "Inter", "body": "Inter", "latin": "Inter"}}
    found = "\n".join(check(page, identity).findings)
    assert "purple" not in found and "default faces" not in found
    assert "purple" in "\n".join(check(page).findings)


def test_the_guide_rides_along():
    guide = slop_guide()
    assert "design_slop_check" in guide and "حلول مبتكرة" in guide


EYEBROWS = """<header><nav><a href="#">الرئيسية</a></nav></header>
<section class="hero"><div><p class="eyebrow rv in"><span class="dot"></span>مطوّر أندرويد · Kotlin وCompose <span>—</span> متاح للعمل</p>
<h1 class="rv">أبني تطبيقات جوّال</h1></div></section>
<section><span class="tag">خدماتي</span><h2>شو بعمل</h2><div class="ghost" aria-hidden="true">رفيق</div><h2>تاني</h2></section>
<section><div class="kicker">03 — كيف</div><p>نص</p></section>"""


def test_eyebrows_are_found_by_place_and_by_name():
    found = dict(eyebrows(EYEBROWS))
    assert found["مطوّر أندرويد · Kotlin وCompose — متاح للعمل"] is True  # over the main headline
    assert "خدماتي" in found and "03 — كيف" in found
    assert "رفيق" not in found  # a decorative word behind a heading isn't a label over it


def test_both_checks_report_eyebrows():
    assert any("eyebrow" in n and "main headline" in n for n in check(EYEBROWS).findings)
    assert any("eyebrow" in n for n in review(EYEBROWS, "صفحة هبوط").notes)
    assert "eyebrow" in slop_guide().lower()
