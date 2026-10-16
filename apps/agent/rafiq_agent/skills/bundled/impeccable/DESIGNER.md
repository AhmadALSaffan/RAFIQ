# Designing like a studio

The floor is a page that could ship as a real product's site: real content, depth,
motion, and a layout made for *this* product. Never a grey wireframe, never a template.

## 1. The identity is the user's

The user builds the visual identity before you start (it comes as «هوية التصميم»): the
colours, the fonts, the corner shape, the depth, the density, the motion and the theme,
plus a style direction.

- Copy its `:root` block as is.
- Load its fonts with its link.
- Use only its variables.
- Follow its style direction for composition and motion.

Your job is everything the identity doesn't decide:
- the order and shape of the sections;
- the signature moves (2–3 things this page will be remembered by);
- how the product is shown;
- the copy.

If a design has no identity block (an old one), write an identity first: a palette named
after the product's world (6–10 hex colours), a font pair, and 2–3 signature moves.

**Every page different.** Two products with the same identity still get different pages:
a different hero, different section shapes, different signature moves. Never reuse a
sequence you've used before (say, phone hero → marquee → statement → bento → numbers →
dark band → CTA card). Build the structure from *this* brief: the user's sections first,
then what the product's story needs.

## 2. Type and colour craft (inside the identity)

- **Hierarchy comes from contrast in size and weight:** the hero headline 3–6× the body,
  section titles 2–3×.
- **Never put `letter-spacing` on Arabic** — it breaks the joins.
  - Latin headings get −0.02 to −0.035em.
  - Arabic body line-height is 1.7–1.8; Latin body 1.5–1.6.
- **Numbers, URLs and codes** go in `var(--latin)`, isolated (`direction:ltr; unicode-bidi:isolate`).
- **Colour hierarchy:**
  - the primary is for the main action and one detail per section, not everything;
  - the accent is the second voice;
  - tints and shades come from the same colours (`color-mix(in srgb, var(--primary) 12%, transparent)`).
- **Contrast:** body text ≥ 4.5:1, large text ≥ 3:1. Text on `--primary` uses `--on-primary`.
- **No AI tells:** no purple-to-blue gradients, no gradient text for no reason, no neon glow
  on every button, no pure `#000` on pure `#fff`.

## 3. The numbers

| | landing / marketing | app / dashboard |
|---|---|---|
| hero headline | `clamp(44px, 7vw, 104px)` (bold styles up to 180px) | 28–36px |
| section title | `clamp(32px, 4.4vw, 64px)` | 20–24px |
| card title | 20–24px | 15–17px |
| body | `var(--text)` (16–18px) | 14–15px |
| labels | 12–13px, Latin uppercase `.14em`, or Arabic at 600 | 12px |
| section padding | `var(--section)` top and bottom | 24–32px |
| max width | 1160–1280px, gutter `clamp(20px, 4vw, 48px)` | full width, sidebar 240–280px |
| buttons | 48–56px tall, radius `var(--pill)` or `var(--r-sm)` | 36–40px |

The hero headline is the biggest thing on the page and is a promise.
The paragraph under it is ≤ 36ch. Two buttons at most.

## 4. Composition — a menu, not a recipe

**Heroes** (pick by the style and the product):
- a split with the product drawn on one side;
- a giant headline filling the width, the product below it;
- a full-bleed colour block;
- a centred quiet statement with lots of air;
- an editorial cover (headline, issue label, columns);
- a collage of cards and stickers;
- an interactive demo (a working calculator or form);
- a stat-led hero (one huge number and what it means);
- a dark, cinematic hero with a glow behind the product.

**Sections** (choose what the story needs, vary the shapes):
- logos or trust strip;
- marquee;
- problem statement;
- alternating feature rows (text / visual, flipping sides);
- bento grid;
- tabs that switch a preview;
- a horizontal scroller of cards;
- a timeline;
- numbered steps;
- before / after;
- a comparison table;
- big numbers;
- testimonials (one big quote, or a wall);
- case study;
- pricing (the recommended plan raised);
- FAQ (`<details>`);
- a contact or booking form;
- a map or locations;
- a team;
- a gallery;
- a CTA (a band, a card, or a full-screen ending);
- footer.

**Rhythm:**
- Alternate dense and airy sections, and wide and contained ones.
- At most two sections in a row may share a layout.
- Break the page at least once (a band in another colour, a full-bleed visual, a change
  of grid).

**Apps and dashboards:**
- a sidebar or a top nav with the active item clear;
- a header with the page's key number;
- KPI cards with SVG sparklines and delta chips;
- a main chart;
- a table with real rows, status pills and row hover;
- a detail panel;
- empty, loading (skeletons) and error states.

## 5. Show the product — draw it

- **Phone frame:** a div with `aspect-ratio: 9/19`, a radius around 44px and padding 10–12px,
  with a real screen inside. **Browser frame:** a bar with three dots and a URL pill.
  Both get real UI inside: headers, lists, rings (`conic-gradient` + radial mask), charts.
- **Charts:**
  - bars are divs with `height: var(--h)` growing with `scaleY`;
  - lines are SVG paths drawn with `stroke-dasharray`.
- **Illustrations:** inline SVG shapes in the identity's colours.
- **Icons:** simple inline SVG strokes (24px, the same stroke width everywhere).
- **Never:** external stock images, `placeholder.com`, grey "image" boxes, or emoji as icons.

## 6. Motion (at the identity's level)

| Level | What moves |
|---|---|
| **calm** | Sections fade and rise 16px as they arrive (once, staggered 60–90ms); hover changes colour or lifts 1–2px. Nothing loops except maybe one slow drift. |
| **medium** | Calm, plus: the hero enters with a short sequence; one or two living details (a ring filling, numbers counting up, a line drawing on scroll); cards lift on hover. |
| **cinematic** | Medium, plus: bigger entrances (scale, rotation settle, masks); a marquee or scroll-linked effect; floating elements; spring pops. |

Always:
- use `var(--speed)` and `var(--ease)`;
- animate only `transform`, `opacity`, `filter` and `clip-path`;
- add `@media (prefers-reduced-motion: reduce)` that shows everything at rest;
- give everything pressable hover, `:focus-visible` and press states.

## 7. Copy

- Write real copy in the product's language, specific and short. The headline is a
  promise; the paragraph says how.
- Use real-looking numbers, names and prices. Never lorem ipsum, «عنوان هنا», or
  «Feature 1».
- Each section: a label, a title of ≤ 8 words, at most two sentences before the visual.
- Arabic is written as Arabic, not translated: short, warm, direct.

## 8. RTL

- Use `<html lang="ar" dir="rtl">` and logical properties only (`margin-inline-start`,
  `padding-inline`, `inset-inline-end`, `text-align: start`).
- Arrows point the reading way.
- Marquees and lines move with the direction.

## 9. Building blocks (mechanics, not layouts)

```css
.rv { opacity: 0; transform: translateY(20px); transition: opacity var(--speed) var(--ease), transform var(--speed) var(--ease); transition-delay: calc(var(--i, 0) * 80ms) }
.rv.in { opacity: 1; transform: none }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important } .rv { opacity: 1; transform: none } }
```
```js
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target) } }), { threshold: .12 });
document.querySelectorAll(".rv").forEach((el) => io.observe(el));
```
- **Count-up:** an IntersectionObserver at 0.6; on arrival, animate the number from 0 with an
  ease-out over 1.2–1.6s.
- **Drawn line:** `stroke-dasharray: L; stroke-dashoffset: L` → `0` with a transition when `.in`.
- **Marquee:** the content twice in a flex row, `@keyframes { to { transform: translateX(50%) } }`
  in RTL (−50% in LTR), linear, 20–40s.
- **Theme toggle (theme both):** a button that flips `data-theme` on `<html>` and saves it in
  `localStorage`.

## 10. Before you send it

1. **The identity:** its `:root` block is copied, its fonts load, and no other colour or font is used.
2. **Every answer in the brief is followed:** the sections the user asked for, the page
   shape, the direction.
3. **Hierarchy:** the hero headline leads, and each section has one focal point.
4. **Rhythm:** the sections vary, nothing repeats more than twice, and there's at least one break.
5. **Motion** matches the identity's level, with hover and focus states and reduced motion.
6. **The product is drawn**, not described or left as a grey box.
7. **Mobile:** at 380px nothing overflows, grids become one column, and type uses `clamp()`.
8. **No slop:** no emoji icons, no lorem, no placeholder images, no three identical cards in a row.
9. **It's not a copy of a page you made before.**
10. Then tell the user, in a few lines: how the identity is applied, the sections, and the
    signature moves.

## 11. What makes a page look amateur (avoid)

- A small hero, everything centred, every section the same shape.
- The identity ignored: new colours or fonts invented, or default system fonts.
- No motion at all, or everything bouncing.
- Emoji icons, stock placeholders, «صورة هنا».
- Tiny low-contrast text, long paragraphs.
- Physical `left`/`right` in an RTL page; letter-spaced Arabic.
