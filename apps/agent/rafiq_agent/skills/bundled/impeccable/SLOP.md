# Is this AI slop? — the tells, and what a studio does instead

"AI slop" is the look a page gets when nobody decided anything: every choice is the most
common one a model has seen. One tell is forgivable; five together and anyone can see a
machine made it. Go through every group below against the page, section by section. For
each tell you find, say where it is, then fix it with the move on the right — inside the
user's identity (its colours, fonts, radius, shadow, density and motion stay as they are).

`design_slop_check` measures what can be measured and lists it with counts. It can't see
everything: read the page yourself for the tells it can't count (copy, composition, story).

## 1. Colour

| Tell | Instead |
|---|---|
| Purple → blue or indigo → pink gradient (#6366f1, #8b5cf6, #a855f7, #667eea → #764ba2), especially on a dark slate (#0f172a, #111827) | The identity's palette only. One accent, used on few things, so it means "act here". |
| Gradient text (`background-clip: text`) on the headline | Solid ink. Emphasis by weight, size, or the primary colour on one word. |
| A glow: a coloured box-shadow with a big blur around buttons and cards | The identity's shadow token, or a hairline (`--line`). Light comes from one direction. |
| Blurry colour blobs / orbs behind the hero (`filter: blur(80px)`, big radial gradients) | A real image of the product drawn in HTML, a pattern from the product's world, or nothing. |
| Every section a different pastel card on the same grey | Two or three grounds that alternate on purpose (background, surface, one inverted band). |
| Pure #000 on pure #fff | The identity's ink and background (tinted). |
| Neon-on-black "cyber" accents with no reason | The accent from the identity, at the saturation it has. |

## 2. Type

| Tell | Instead |
|---|---|
| Inter / Roboto / Poppins / Montserrat / system fonts as the only faces | The identity's three fonts, loaded with its link. |
| Headline 36–48px, everything else 16px: no hierarchy | A display size that leads (clamp to 90–160px for bold styles, 56–80px for calm ones), a clear step down to section heads, body 17–19px. |
| Everything bold, or everything the same weight | Two weights doing different jobs: heavy display, regular body, medium labels. |
| A serif word dropped into a sans headline "for interest" | Emphasis in the same family: weight, italic (Latin), or colour. |
| ALL-CAPS tracked labels anywhere they only decorate | Plain type; a number or category belongs inside the content, not above it. |
| Negative letter-spacing on Arabic | Never — it breaks the joins. Tracking is for Latin only. |
| Centred, short, 3-line paragraphs everywhere | Start-aligned text at 55–70 characters; centre only a single statement. |

## 3. Layout and composition

| Tell | Instead |
|---|---|
| The template: centred hero → logo strip → 3 feature cards → testimonials → pricing (3 tiers, middle "Most popular") → FAQ → CTA → 4-column footer | A story in the product's order, with sections of different shapes. Remove sections that say nothing. |
| A row of three identical cards: icon in a rounded square, title, two lines | Alternating feature rows with a drawn screen, a bento grid with cells of different sizes, tabs, a timeline, a big number with a sentence. |
| Everything centred | An asymmetric grid: text on one side, the product on the other; let things cross columns. |
| Every section the same height and padding | A rhythm: a dense section, then an airy one; one full-bleed band; one that breaks the grid. |
| **An eyebrow**: any small label over a headline — "• Available for work", "01 — Features", "Kotlin · Compose", "New ✨", a status dot with a tag line. Over the hero or over every section, it's the surest sign a model made the page. | Delete it. If it carries real information, move it where it belongs: into the headline or the sentence under it, beside the button ("متاح لمشاريع جديدة" under the CTA), into the nav or the footer. Never a tag above a heading. |
| Hero stats row: "10K+ users · 99.9% uptime · 24/7 support" | A real figure the product owns, with its source — or none. |
| "Trusted by" with fake grey logos | Real names the user gave, or a sentence of proof from a real user. |
| A floating dashboard mock tilted in 3D with a glow | The real UI, drawn flat and big, showing a real moment of use. |
| A bento where every cell is the same size and says the same kind of thing | Cells sized by importance; one carries the product, one a number, one a quote. |
| Rounded 24px+ corners on everything, cards inside cards | The identity's radius scale, followed everywhere; no card nesting. |
| Glassmorphism (`backdrop-filter: blur`) on every surface | One place where something floats over content (a sticky nav); solid surfaces elsewhere. |

## 4. Copy

| Tell | Instead |
|---|---|
| English: "Unlock", "Elevate", "Empower", "Seamless", "Revolutionize", "Supercharge", "Effortless", "Cutting-edge", "Next-generation", "Game-changer", "All-in-one", "Your journey", "Take X to the next level", "Built for the future", "Powered by AI" | Say what it does, for whom, with a number or a concrete noun: "Invoices sent in 30 seconds, from your phone." |
| Arabic: «حلول مبتكرة»، «نقلة نوعية»، «بكل سهولة»، «ارتقِ بـ»، «اكتشف قوة»، «تجربة فريدة»، «عالم من»، «بلمسة زر»، «ثورة في»، «مستقبل الـ»، «حلول متكاملة»، «بسلاسة»، «أطلق العنان»، «رحلتك نحو»، «لا مثيل لها»، «الأفضل على الإطلاق»، «نحن هنا من أجلك» | The same rule in Arabic: a verb, an object, a number. «فواتيرك بتطلع بـ ٣٠ ثانية من موبايلك.» |
| Headline that could sit on any product ("The platform for modern teams") | One the competitor couldn't use. Name the job, the user, or the result. |
| Every feature: "Lightning fast", "Secure", "Easy to use" | What exactly is fast (and how fast), what is protected (and how). |
| Buttons "Get started" + "Learn more" everywhere | The action itself: «جرّب ١٤ يوم مجاناً»، «شوف الأسعار»، «احجز موعد». |
| Testimonials from "Sarah J., CEO" with five stars | Real quotes the user gave, with full names — or no testimonials section. |
| Exclamation marks, emoji bullets, "✓" lists everywhere | Plain sentences; a list only when items are parallel. |
| Lorem ipsum, "Your Company", "Acme", "Feature 1", «عنوان هنا» | Real, specific copy for this product. |

## 5. Imagery and icons

| Tell | Instead |
|---|---|
| Emoji as icons (🚀 ⚡ 🔒 ✨) | Simple inline SVG at one stroke width, in the palette — or no icon. |
| A generic icon above every card | Icons only where they help scanning; otherwise a number, a word, or the product UI. |
| Abstract 3D shapes, isometric illustrations, floating spheres | The product drawn in HTML/CSS, a pattern from the product's world, typography as image. |
| Stock-photo placeholders from external URLs | Drawn screens, CSS shapes, inline SVG. |

## 6. Motion

| Tell | Instead |
|---|---|
| Every element fades up the same 20px with the same delay | Sections reveal with a stagger; the hero has its own entrance; some things don't move at all. |
| `transition: all` | Name the properties (transform, opacity, color). |
| `hover: scale(1.05)` on everything | Each kind of thing answers differently: buttons lift 2px, cards lift with a deeper shadow, links change colour. |
| Infinite floating / pulsing / gradient-shifting decorations | One living detail that means something (a cursor, a counter, a progress line), motion at the identity's level, and `prefers-reduced-motion`. |
| Parallax and scroll-jacking for no reason | Only where it shows something (a product assembling, a timeline filling). |

## 7. The details that give it away

- Footer: "© 2024 Company. All rights reserved." with columns of dead links → the real year, a few links that exist, the product's name.
- Nav: "Features · Pricing · About · Contact" on a one-page site → anchors to the sections that are there.
- Dark mode that only inverts colours → the identity's dark palette.
- Same component pattern repeated with only the text changed → vary the shape where the content differs.
- Arabic page with physical `left`/`right`, Latin digits in Arabic copy without reason, or mirrored icons that shouldn't be (play, logos) → logical properties, consistent digits, mirror only directional icons.

## How to fix

1. Run `design_slop_check`. Read its findings, then the page, group by group.
2. List the tells you will fix (where, which tell, the move). Copy tells count as much as visual ones.
3. Fix them all in one pass and send the whole document. Keep the identity's tokens; change composition, copy, imagery and motion.
4. Run `design_slop_check` again, until it finds nothing it can measure. Then tell the user, briefly, what you changed and why.
