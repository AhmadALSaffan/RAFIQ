# Directing like a motion designer

You are not filling a template. Every video gets its own concept, palette, type and shot
list, decided by you for *this* message and *this* audience. What follows is how a
professional decides, and the building techniques that make a frame look designed rather
than typed. Use the techniques; never repeat the same video twice.

## 1. Before the first patch: the brief

Write it to the user in 5–7 short lines, then build exactly that:

1. **Concept** — one line: the feeling and the single message. («هادي وواثق: ملفاتك بأمان»).
2. **Palette** — 5–7 colours *chosen for this concept*, with hex:
   background, surface (cards), text, muted text, one **accent** (the eye-catcher), and
   optionally a second accent or a gradient pair. Write them in `scene.palette`
   (`{"surface": "#0b1020", "surface2": "#141b33", "onSurface": "#eef2ff", "muted": "#94a3c4",
   "primary": "#ffb547", "onPrimary": "#1a1205", "accent": "#5eead4"}`) and use them as
   `brand.<role>` everywhere — then the whole video is one system and easy to change.
3. **Type** — a display face and a body face (+ a Latin face if there's English), in
   `scene.fonts` (`{"display": "Lalezar", "body": "Almarai", "latin": "Poppins"}`), and the
   video's own type scale in `scene.type` (see §4 for the sizes that read on a phone).
4. **Shots** — 4–8 shots with times, each a *different* shot type from §3, with what
   moves on its cut.
5. **Sound** — only when the user asked for sound, music or a voice-over; otherwise
   the video is silent (`audio: []`) and you don't add any.

The workspace kit is only a default. Choose freely; the checks still guard contrast.

## 2. Colour and type — how to choose

**Palette from the concept, not from habit.**
- Trust, finance, security → deep navy/ink grounds, one warm or teal accent.
- Energy, sport, launch → near-black ground, one electric accent (lime #c6ff3d,
  hot coral #ff5a4e, cyan #22d3ee), very high contrast.
- Calm, wellness, lifestyle → soft light grounds (sand #f4efe6, sage #e7efe7, mist #eef1f6),
  one muted accent (clay, olive, dusty blue), dark warm text.
- Premium, luxury → black or deep plum/green, gold #d4af37 or champagne #e8d5b0, lots of
  empty space, slow motion.
- Tech, AI, product → dark slate/indigo grounds, gradient accent (violet→cyan,
  orange→pink), mono labels.
- Kids, food, playful → bright light grounds, 2 cheerful accents, rounded shapes.

Rules that never change:
- **One accent leads.** It marks the one thing to see in each shot (a word, a number, the
  button). If everything is accent, nothing is.
- Text on its ground ≥ 4.5:1 (≥ 3:1 for display sizes). Dark ground → near-white text
  (not pure #fff on pure #000 — soften both a little). Light ground → near-black text.
- Gradients: two neighbours on the wheel (violet→blue, orange→pink), angle 90–135°.
  A gradient *background* is subtle (two close shades); a gradient *accent* can be bold.
- Decor shapes use the accent at 8–15 % opacity, so they add depth without noise.

**Type pairs that work for Arabic** (any Google Fonts family works — pick for the mood):
- Bold, loud, social: **Lalezar** or **Marhey** display + **Almarai** / **Tajawal** body.
- Modern, clean, product: **Alexandria** / **Readex Pro** / **Rubik** display + **IBM Plex Sans Arabic** body.
- Elegant, premium: **El Messiri** or **Reem Kufi** display + **Noto Kufi Arabic** body.
- Classic, cultural, quotes: **Amiri** or **Aref Ruqaa** display + **Noto Naskh Arabic** body.
- Sporty, tech: **Changa** / **Cairo** (heavy weights) display + **Cairo** body.
- Friendly, rounded: **Baloo Bhaijaan 2** display + **Tajawal** body.
- Latin partners: Poppins, Space Grotesk, Inter (clean), Bebas Neue (condensed loud),
  Playfair Display (elegant). A single word can take its own face: `"fontFamily": "Bebas Neue"`.

Type rules: one display face per video. Hierarchy by **size and weight**, not by colour
alone: display (1–3 words) ≫ headline ≫ body. Short lines. Arabic is never
letter-spaced and never split into letters.

## 3. The shot catalogue

Pick a different one for each beat. Each lists what it is for and how to build it.

**A. Kinetic hook** — the first second; stops the scroll.
1–3 words, `display`, centred a little above the middle. `wordPop` (Arabic word by word) or
`pop` with `spring`, then a `zoomPunch` at the end of the line. Under it, a short accent
bar (`shape: rect`, width 16–24, height 1, fill accent) that grows: keyframes
`scale` 0→1 with `outExpo`. (With sound: one `pop` or `impact`.)

**B. Split statement** — a setup and a punchline.
Line 1 in `muted` slides in from `start`; line 2 (the punchline) in the accent slides in
from `end` 0.3 s later, `below` line 1, `gap: 3`. Contrast in colour *and* direction.

**C. Card stack (UI mockup)** — what makes a video look designed.
2–3 cards: `group`s holding a `rect` (fill `brand.surface2`, `radius: 2`, `shadow: true`)
plus a few children inside (an icon in a tinted circle, a title, one or two short muted
lines). Cards enter one after another with `slideIn` (dir up) + a slight `rotation`
keyframe (−3°→0°), stagger 0.15 s, the front card larger. Ideal for features, messages,
notifications, app screens.

**D. Icon row / feature grid** — 3 or 4 ideas at once.
Each item: a circle (accent at ~15 % opacity, or surface2) with the icon inside in the
accent, and a short label `below`. Same icon set and style for all. Items `pop` with stagger
0.12 s, labels `fadeUp` 0.1 s after their icon. Lay them out with `beside` + `gap: 6`.

**E. Big number** — a stat that must land.
The number `display` in the accent, `{count}` + `countUp` over 1.2–1.6 s (`outExpo`).
Around it a `ring` (thin, muted at 30 %) and over it an `arc` in the accent that draws
(`drawOn`) with the count. Label `below` in `muted`. (With sound: a `tick` on the start, `ding` on
landing.)

**F. Steps / timeline** — a process.
Numbered nodes (small circles, accent fill, number in `onPrimary`), joined by a `line`
that draws (`drawOn`) from node to node; each step's text appears as the line reaches it.
Vertical in 9:16, horizontal in 16:9.

**G. Before / after** — a contrast.
Two cards side by side (16:9) or stacked (9:16): the «before» dimmer (muted text,
`x`/`x-circle` icon), the «after» lifted (accent outline or glow, check icon), entering a
beat later with `scaleIn`.

**H. Highlight word** — emphasis inside a sentence.
The sentence in `headline`; behind the key word, a `rect` in the accent (or accent at
35 %) grows like a marker (keyframes `scale` 0→1, `outExpo`), slightly after the text.

**I. Quote / testimonial** — a voice.
A big quote mark (`ph:quotes-fill`) in the accent at 40 % top-start, the words
`lineReveal`, the name `fadeUp` with a short line before it. Slow and calm.

**J. Chart reveal** — data.
`chart` (bar/line) building itself; the key value as a big number beside it; one bar or
point in the accent, the rest muted.

**K. Device / screen showcase** — a product.
A screenshot (`image`) inside a rounded card with a shadow, slowly pushed in (`kenBurns`
or `scale` 1→1.06 over the shot), with 1–2 callout pills (`text` with `background`)
popping beside the feature they point at.

**L. Logo sting** — opening or closing.
A ring `drawOn` → the mark `scaleIn` with `spring` → the name `maskReveal` → a hold of
0.8 s. (With sound: `riser` into `impact`.)

**M. End card / CTA** — what to do next.
The ask in `headline`; the action as a pill (`text` with `background` in the accent,
`onPrimary` text, `radius: 3`) that `scaleIn`s with `outBack` and then `pulse`s; a small
URL or handle in `muted`. A `ding`.

## 4. Composition

- **One focal point per shot.** Everything else is smaller, quieter or later.
- Leave space: 30–50 % of the frame empty is normal in good motion design.
- Not everything centred: alternate centred shots with start-aligned ones (text block at
  `start` with an image or icons at `end`).
- **Depth in layers**: background (solid or subtle gradient) → decor (1–2 big soft
  shapes: circles or blobs in the accent at 8–15 % opacity, slowly `float`ing or rotating) →
  content → small accents (dots, short lines, a tag pill).
- Cards: padding 4–6 units, radius 2, a soft shadow; never text straight on a busy
  picture without a shadow or pill behind it.
- 9:16: stack vertically, text width ~90–100 units, keep inside the safe area.
  16:9: use the width — text on one side, visual on the other.

**The numbers (px on a 1080 short side — what the review measures).** The kit's default
scale is for 16:9 slides; a reel needs much bigger type. Set `scene.type` once and use
`size` on a hero layer:

| | 9:16 reel | 16:9 / 1:1 |
|---|---|---|
| hero word / number (`size`) | 200–300 | 160–240 |
| `display` | 180–220 | 140–180 |
| `headline` | 96–110 | 80–96 |
| `title` | 64–72 | 56–64 |
| `body` | 44–52 | 36–44 |
| `caption` | 34–40 | 30–34 |

- Nothing under 32 px in a reel (tags and URLs), body text 44–52. The hero is ×1.6 or more the next text.
- The content block of a shot spans **75–95 % of the width and 25–60 % of the height** (9:16), or 50–85 % of the
  width (16:9). Cards are 110–120 units wide in 9:16, rows 20–24 units tall.
- The content's centre sits at **42–55 % of the height** — not in the top third. Put the
  headline at `y` ≈ −30…−40 and stack below it with gaps of 6–10 units.
- Shots 2–3.5 s; colour-panel transitions cross in **0.4–0.6 s** (±0.28 s around the cut).

## 4b. Draw your own shapes

You're not limited to rect/circle/ring/icons. `shape: "path"` takes any SVG path in grid
units inside its `layout` box (M/L/H/V/C/S/Q/T/A/Z), filled or stroked — draw what the
idea needs:

- **An underline swoosh** under a hero word, drawn on:
  `{"type":"shape","shape":"path","path":"M2 10 C24 2 52 2 74 8 C86 11 96 12 104 8","fill":"transparent","stroke":"brand.primary","strokeWidth":7,"layout":{"below":"hero","gap":1,"width":106,"height":14},"animate":[{"preset":"drawOn","at":0.85,"duration":0.6,"ease":"outExpo"}]}`
- **A soft blob** behind everything (decor, 6–12 % opacity, slow rotation keyframes):
  `"path":"M60 4 C88 0 116 18 118 46 C120 74 98 96 68 100 C38 104 6 88 4 58 C2 28 32 8 60 4 Z"`
- **Arrows, brackets, a speech-bubble tail, a sparkle, a wave line, a check mark, a chart
  curve, a simple illustration** (a cup, a phone, a leaf) — build them from a few paths,
  stroke them with `drawOn`, fill them with `scaleIn`/`pop`.
- Keep strokes 4–8 px, round shapes with `C` curves, and colour them from the palette.

## 5. Motion language

- **Choreography**: the focal element moves first; supporting elements follow 0.15–0.3 s
  later; never more than three things start together.
- **Easing**: entrances `outExpo` (smooth, confident) or `spring` (playful); things that
  travel `inOut`; buttons and pops `outBack`. Never everything `linear`.
- **Timing ladder**: small things 0.25–0.35 s, entrances 0.5–0.7 s, big moves 0.8–1.2 s;
  lists stagger 0.08–0.15 s. Exits are quicker than entrances (0.25–0.4 s).
- **Something is always alive**: a slow push (`scale` 1→1.04 across the shot on the main
  group), decor `float`, a pulsing dot. A frozen frame looks broken.
- **Variety**: vary entrances from shot to shot (`maskReveal`, `slideIn`, `wordPop`,
  `scaleIn`, `lineReveal`, `blurIn`) — the same `fadeUp` everywhere reads as a slideshow.
- **Transitions on every cut**, chosen for the pace: a colour panel that sweeps across (a
  full-frame `rect` in the accent with the `sweep` preset over the cut ±0.28 s — see the
  format reference; vary `dir` and colour between cuts), a zoom-through (outgoing group `scale` 1→1.2 + fade while the next
  scales 0.9→1), a mask wipe, or a clean fade through the background for calm pieces.
- Shot lengths 2–3.5 s (hook ≤ 2 s, end card 3–4 s). Reading time is checked (M005).

## 6. Sound

**No sound unless the user asked for it** (sound, music, effects or a voice-over). A
silent video is a finished video; the user adds music in the editor when they want.
When they did ask: **compose** a score for this video (`source: "compose"`, see the
format reference) — not the same bed every time. Start from the mood:
- tech / product: 118–126 bpm, `synth` or `arp` 16ths, `sub` bass, four-on-the-floor `kick`, `hat` off-beats;
- premium / luxury: 70–85 bpm, `strings` or `pad` with maj7/9 chords, `piano` notes, almost no drums;
- warm / lifestyle: 85–95 bpm, `keys` m9 chords, `bass`, laid-back `kick`/`snare`, `swing` 0.15;
- energy / sport: 130–150 bpm, `808` + `kick` steps, `clap`, `lead` hook;
- epic / cinematic: 60–80 bpm, `choir` + `strings`, `tom` and `crash` on the big moments.
Change the key, the chords and the instruments from video to video; bring parts in with
`from` so it builds with the edit; about −16 dB with fade in/out. Effects on 2–4 moments only: `whoosh`/`swoosh` on transitions, `pop` on the hook, `tick`
then `ding` on a number, `riser`→`impact` on a logo, `click` on a button.

## 7. Before you say it's done

1. `motion_lint`: no errors. Fix warnings unless you have a reason.
2. **`motion_review`** — the director's review: every shot measured (hero size, smallest
   text, how much of the frame it fills, where its centre sits, whether it moves while it
   holds, transition lengths). Fix its notes shot by shot (one patch per shot), then run it
   again until it passes or what's left is a deliberate choice.
3. `motion_render_frames` at each shot's middle and the last frame, if you can see images.
4. Ask yourself the checklist:
   - Did each shot use a *different* shot type and entrance?
   - Is the accent used for one thing per shot?
   - Is there decor/depth, or is it flat text on a flat background?
   - Does every cut have a transition and a sound only where it matters?
   - Would this look at home on a professional brand's channel?
5. Then tell the user, in a few lines, what you made: the concept, the palette and the
   shots.

## 8. What makes a video look amateur (avoid)

- Text-only slides, all centred, all the same size, all `fadeUp`.
- Five colours fighting; accent everywhere; pure #000 with pure #fff.
- Long sentences on screen; more than ~8 words per shot in 9:16.
- No decor, no depth, no transitions, nothing moving between entrances.
- Random icons from different sets; tiny icons; emoji everywhere.
- Every shot the same length; the end arriving without a call to action.

## 9. A finished example

`examples/pro-reel.json` (it comes right after these guides) is a 15 s 9:16 reel built
this way: its own palette, Lalezar + Almarai, a 300 px hero with a drawn swoosh, a chat
card, task rows with checks, an icon trio, a CTA, colour-panel cuts, decor that lives the
whole video. Study how it sizes, places, staggers and transitions —
then make *your* video for *its* idea, with its own colours, fonts and shots.
