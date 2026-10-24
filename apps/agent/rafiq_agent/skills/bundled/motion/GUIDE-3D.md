# 3D, step by step

Follow these steps exactly when the user asks for anything 3D (a 3D logo, 3D text,
particles, a globe, a galaxy, a city, a product that turns, 3D bars…). Don't design a
3D scene from nothing: **start from a recipe**, then change one thing at a time.

## Step 1 — pick the recipe

| the user wants… | recipe | params to fill |
|---|---|---|
| a logo, a name, a title in 3D | `logoReveal` | `text` (or `icon`), `material`, `mood` |
| text that forms out of particles / dust / stars | `particleText` | `text`, `colors` |
| several lines of big 3D text, a slogan | `kineticType3D` | `lines` (2–4 short lines), `style` |
| space, a galaxy, "something cosmic" | `galaxy` | `colors` |
| planets, a solar system | `solarSystem` | (none needed) |
| a real planet (Earth, Mars…) with its true surface | a `sphere` with `texture` | first `motion_fetch_image` with the map's link (equirectangular .jpg), then `"texture": "<asset name>"` |
| countries, cities, travel, "worldwide" | `globeArcs` | `points` as [[lat, lon], …] — the first is the hub |
| a city, blocks, buildings, "tech world" | `voxelCity` | `palette` (optional) |
| an abstract shiny shape, a "liquid metal" background | `chromeBlob` | `material` |
| a product turning (the user uploaded a .glb) | `productSpin` | `asset` = the asset's name in `scene.assets` |
| screenshots or pictures floating in 3D | `cardStack` | `images` = asset names, `layout` |
| numbers, a comparison, growth | `bars3D` | `data` {values, labels} |
| pieces falling and bouncing | `physicsDrop` | `of`, `colors` |
| none of these | `logoReveal` with the video's title | `text` |

Materials to choose from: `chrome` (silver), `gold`, `glass`, `holographic`, `neon`,
`plastic`, `clay`, `metal`. Moods: `night` (dark blue), `studio` (dark grey), `sunset`,
`dawn` (light), `city`.

## Step 2 — copy this layer and fill the blanks

```json
{ "id": "hero3d", "type": "scene3d", "start": 0, "end": 8,
  "scene3d": { "recipe": "<<recipe>>", "params": { "text": "<<the title, max 3 words>>", "material": "<<chrome|gold|glass>>", "mood": "<<night|studio|sunset>>" } } }
```

- `start` 0, `end` = how long the 3D shows (6–10 s is good; never past the video's end).
- Text: **at most 3 words** in 3D. Longer sentences go in a normal 2D `text` layer.
- Add it with one patch: `[{ "op": "add", "path": "/layers/0", "value": <the layer> }]`
  — at index 0 it sits at the back, so 2D text can go on top.

## Step 3 — add 2D text on top (optional)

A 3D title plus one short 2D line under it reads well:

```json
{ "id": "tagline", "type": "text", "text": "<<one short line>>", "style": "title", "start": 2, "end": 8,
  "layout": { "anchor": "bottom", "y": -20 }, "animate": [{ "preset": "fadeUp", "at": 2.2 }] }
```

## Step 4 — look, then fix one thing per patch

Call `motion_render_frames` at `[1, 3, 6]`. Then fix **one** problem per patch:

| you see | do this |
|---|---|
| the frame is black or very dark | add `"environment": "studio"` to `scene3d`, or `"exposure": 1.3` |
| the 3D thing is cut off at the edges | move the camera back: `"camera": { "position": [0, 0.4, 10] }` |
| it looks flat | `"mood": "night"` and a `rim` light: `"lights": [{ "type": "rim", "color": "brand.primary", "intensity": 3, "position": [-5, 3, -4] }, { "type": "key", "intensity": 2, "position": [4, 6, 5] }]` |
| nothing moves | `"camera": { "move": { "type": "orbit", "amount": 30 } }` |
| too bright, washed out | `"exposure": 0.7` and `"post": { "bloom": 0.3 }` |
| Arabic letters look broken | make sure the text is one line, `split` only `"words"` (never `"letters"` for Arabic) |
| the text is too small | fewer words — not a bigger size |

## Step 5 — finish

Run `motion_lint`; fix errors. Tell the user in two or three short lines what the 3D shows.

## Rules

- One `scene3d` layer per shot. Two 3D layers on screen at once only when the user asks.
- No sound unless the user asked for it.
- Times stay inside the layer (`at` and key `t` between `start` and `end`) and the layer
  inside the video.
- Never more than 20 000 particles (`count`).
- 3D can't be exported to Lottie — if the user wants Lottie, use 2D only.

## A full example (a 6-second 3D title with a 2D line)

```json
[
 { "op": "add", "path": "/layers/0", "value":
   { "id": "hero3d", "type": "scene3d", "start": 0, "end": 6,
     "scene3d": { "recipe": "logoReveal", "params": { "text": "رفيق", "material": "gold", "mood": "night" },
                  "camera": { "move": { "type": "orbit", "amount": 24 } } } } },
 { "op": "add", "path": "/layers/-", "value":
   { "id": "tagline", "type": "text", "text": "مساعدك على الكمبيوتر", "style": "title", "start": 2, "end": 6,
     "layout": { "anchor": "bottom", "y": -18 }, "animate": [{ "preset": "fadeUp", "at": 2.2 }] } }
]
```
