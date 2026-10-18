"""An identity from references: Rafiq measures what a page's CSS really uses (colours by
role, in every syntax; fonts; corners; motion) and a picture's colours, and the model's
answer is cleaned into the builder's terms."""

from PIL import Image

from rafiq_agent.core import identity_refs as refs
from rafiq_agent.core.identity import STYLES

CSS = """
:root { --bg: #0a0a0c; --text: oklch(0.95 0 0); --accent: #ff2e63; --font-display: "Space Grotesk", sans-serif }
body { background: var(--bg); background-color: #0a0a0c; color: #ededf0; font: 400 17px/1.6 "Rubik", sans-serif }
.btn { background: #ff2e63; border-radius: 999px; box-shadow: 0 10px 30px rgba(0,0,0,.4); transition: transform .3s }
.card { background: hsl(240 6% 8%); border: 1px solid rgb(255 255 255 / 0.1); border-radius: 16px }
code { font-family: "JetBrains Mono", monospace }
i { font-family: "Phosphor-Light" !important }
@keyframes rise { from { opacity: 0 } }
"""


def test_colours_in_every_syntax():
    assert refs._colors_in("#fff #abcdef rgb(255, 0, 0) hsl(120 100% 25%)") == ["#ffffff", "#abcdef", "#ff0000", "#008000"]
    # the CSS spec's own examples
    assert refs._colors_in("oklch(62.7% 0.258 29.23)") == ["#ff0000"]
    assert refs._colors_in("lab(52.2345% 40.1645 59.9971)") == ["#c65d06"]
    # see-through colours aren't part of a palette
    assert refs._colors_in("rgba(0,0,0,.1) #00000010") == []


def test_a_stylesheet_is_read_by_role():
    digest = refs.digest_css(CSS, '<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>')
    assert "background colours (most used first): #0a0a0c" in digest
    assert "#ff2e63" in digest and "text colours: #ededf0" in digest
    assert "--bg: #0a0a0c" in digest and "--text: #eeeeee" in digest
    assert "Space Grotesk (in the catalogue)" in digest and "Rubik (in the catalogue)" in digest and "JetBrains Mono" in digest
    assert "Phosphor" not in digest  # icon fonts aren't type
    assert "999px" in digest and "16px" in digest
    assert "1 @keyframes" in digest and "libraries: gsap" in digest


def test_a_picture_gives_its_colours(tmp_path):
    path = tmp_path / "shot.png"
    img = Image.new("RGB", (100, 100), "#101820")
    for x in range(30):
        for y in range(100):
            img.putpixel((x, y), (255, 77, 120))
    img.save(path)
    ref = refs.read_image("shot.png", str(path))
    assert "#101820" in ref.digest and "70%" in ref.digest
    assert ref.images and ref.images[0].startswith("data:image/")


def test_the_proposal_is_cleaned_into_the_builders_terms():
    data, why = refs.proposal({
        "name": "Neon", "style": "tech", "theme": "dark",
        "colors": {"background": "#0a0a0c", "surface": "#111114", "ink": "#ededf0", "muted": "#8a8a93", "line": "#ffffff14",
                   "primary": "#ff2e63", "onPrimary": "#0a0a0c", "accent": "#62a8ff"},
        "fonts": {"display": "space grotesk", "body": "Not A Real Font", "latin": "JetBrains Mono"},
        "radius": "round", "shadow": "soft", "density": "balanced", "motion": "cinematic", "why": "from [1]",
    })
    assert data["colors"]["primary"] == "#ff2e63" and data["radius"] == "round"
    assert data["fonts"]["display"] == "Space Grotesk"  # matched to the catalogue's spelling
    assert data["fonts"]["body"] == STYLES["tech"]["preset"]["fonts"]["body"]  # unknown → the style's own
    assert why == "from [1]"
    assert refs.proposal({"why": ["one", "two"]})[1] == "one\ntwo"


def test_the_prompt_carries_the_facts_and_the_catalogue():
    msgs = refs.build_prompt([refs.Reference(label="a", digest="Site a\n- background colours: #0a0a0c")], "dark, sharp")
    assert "#0a0a0c" in msgs[1]["content"] and "dark, sharp" in msgs[1]["content"]
    assert "Alexandria" in msgs[0]["content"] and '"why"' in msgs[0]["content"]
