# Reviewing a video shot by shot

You're the director looking at a cut that isn't good enough yet. Don't start over and don't
patch at random: go shot by shot, find what's wrong against the list below, and fix it.

## The loop

1. `motion_review` — every shot measured, with notes (✗) and what already works (✓).
2. Take **shot 1**. Read its notes, then look at its layers (`motion_get_scene` with a
   path, or the summary). Decide the fixes from the table below.
3. One `motion_patch_scene` for that shot: every fix for it together, summary
   «مراجعة: لقطة 1 — …».
4. Next shot. Then the notes on the whole video (palette, fonts, transitions, sound).
5. `motion_review` again. Repeat until there are no notes, or what's left is a choice you
   can defend (say which and why).
6. Tell the user per shot, in one short line each, what you changed.

## Mistakes and their fixes

| What's wrong | What a designer does |
|---|---|
| **No hero** — every text about the same size | Pick the one word/number that carries the shot; give it `size` 200–300 (9:16) in the display face; shrink or cut the rest. |
| **Tiny type** (body under 44 px, anything under 32 px in a reel) | Set `scene.type` for the video (display 200, headline 100, title 68, body 46, caption 36), or `size` per layer. |
| **Floats small in an empty frame** | Scale the whole shot up: bigger type, cards 110–120 units wide, gaps 6–10 units, so the content spans 75–95 % of the width and 25–60 % of the height. |
| **Sits in the top third** | Move the headline to `y` ≈ −30…−40 from the centre and stack the rest below it; the content's centre at 42–55 %. |
| **A still slide** — nothing moves while it holds | A slow push on the main group (`scale` 1 → 1.04 over the shot), `float` on decor, a detail that animates late (a check pops, a number counts, an underline draws). |
| **Everything enters at once** | Hero first, the rest 0.1–0.2 s apart; lists stagger 0.08–0.15 s. |
| **Same entrance everywhere** | Vary per shot: `maskReveal`, `wordPop`, `slideIn` + rotation settle, `scaleIn` `outBack`, `blurIn`, `typewriter`. |
| **Slow transitions** (a panel over 0.6 s) | The panel crosses in ±0.28 s around the cut; the next shot starts under it. |
| **Hard cuts with no transition** | A colour panel, a zoom-through, or a mask wipe on every cut, with a `whoosh`. |
| **Flat background** | A radial or linear gradient in the palette's darks, plus one big soft shape (blob path or circle, 6–12 % opacity) drifting or rotating slowly all video. |
| **Default colours and fonts** | Choose for the idea: `scene.palette` (5–7 hex) and `scene.fonts` (a display face with character + a clean body face). |
| **Busy** (more than ~12 things on screen) | One idea per shot: split it, or cut decoration that doesn't serve the message. |
| **Long sentences** | 3–6 words per line in 9:16, at most ~8 per shot. Rewrite, don't shrink. |
| **Text on a busy picture** | A pill (`background`) or a dark gradient behind it. |
| **Icons floating alone** | Set each on a soft circle (the accent at 15–20 % opacity) 1.8× its size, with a label under it. |
| **Ending without an ask** | A last shot with the call to action as a pill button that pops and pulses, and where to find it. |
| **Silent** | Music under everything (−18 dB, fades), and 2–4 effects on the key hits. |

## Compare with the example

`examples/pro-reel.json` (after the guides) is the bar. For each shot ask: is my hero as
big as its «رفيق» (300 px)? Does my card fill the width like its chat card? Does something
still move like its slow scale and floating decor? Do my cuts cross as fast as its
panels? Match the craft, never copy its content, colours or shots.
