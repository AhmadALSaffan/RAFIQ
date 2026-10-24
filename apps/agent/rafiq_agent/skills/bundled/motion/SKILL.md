---
name: motion
description: How to build motion graphics and videos in Rafiq's Motion page — the RMS v1 scene format, layout on the grid, brand tokens, presets and timing, audio, the check codes and how to fix each, and recipes for reels, intros, explainers, charts, app demos and editing the user's own video. Read it at the start of every motion session.
---

# motion — scenes the engine draws

You don't draw pixels. You write a **scene** (JSON, RMS v1) and change it with small
JSON Patches through `motion_patch_scene`. The engine measures the text, lays everything
out, draws every frame, checks it, and exports it. Full field list: `schema.json`.

## 0. The workflow

1. Read the project note (size, fps, kit). `motion_get_scene` for anything you need.
2. Plan in one short message: the beats (what the viewer sees second by second), the
   one thing that must be read, the pace. Then build.
3. Change the scene a **beat at a time** — all of a beat's layers in one patch, not one
   layer per call. Every patch is a version and comes back with the check result. Look up
   all the icons you need in one `motion_assets` call (`queries`: a list of words).
4. Fix every check error before moving on. Warnings: fix unless you have a reason.
5. When the check is clean, look: `motion_render_frames` at the start of each beat, the
   busiest moment and the last frame (a model that can't see images gets them described in
   words), and `motion_inspect` for exact measurements — boxes, gaps, contrast.
6. Tell the user what you made and why, in a few lines. Never paste the whole scene.

## 1. The document

```jsonc
{
  "version": 1,
  "composition": { "width": 1080, "height": 1920, "fps": 30, "duration": 12,
                   "background": "brand.surface", "safeArea": "reels", "direction": "rtl" },
  "brand": "workspace",
  "assets": { "logo": { "type": "image", "src": "asset://a1b2c3" } },
  "layers": [ /* drawn in order: first = at the back */ ],
  "audio":  [ ]
}
```

- **Time is seconds.** A layer shows for `start ≤ t < end`. The engine snaps to frames,
  so the same scene exports at 30, 60 or 120 fps unchanged.
- **Everything stays inside the video.** A layer ends by `composition.duration`; its keys
  and animations sit between its own `start` and `end`. Anything outside is pulled back
  in when you save (the patch result lists what moved) — place it right the first time.
- **Layer ids** are short ASCII (`title`, `price`, `cta`). Reference them in layout.
- `direction: "rtl"` (default) makes `start` = right and `x` positive = leftwards.

## 2. Layer types

| type | needs | notes |
|---|---|---|
| `text` | `text`, `style` | Arabic shaping is automatic. `{count}` is replaced by the animated `count`. `background` makes a pill/box. |
| `shape` | `shape`: rect, circle, line, path, star, triangle, polygon, arrow, ring, arc, heart | `fill` (colour or gradient), `stroke` + `strokeWidth`, `dash: [dash, gap]`; `radius` = index in the kit's radius scale (3 = pill); `points` = star points or polygon sides; `thickness` for ring/arc; `arc: {from, to}` degrees (0 = top, clockwise — a progress ring); `pointing` start/end for arrows; `path` is SVG data in grid units from the box's top-left |
| `icon` | `icon` | `set:name`, 46k+ icons — find them with `motion_assets` action=icons (`queries`: several words at once). One colour, taking the layer's `color` (and `drawOn`): `tabler:` (outline), `ph:` (Phosphor — add `-bold`, `-fill`, `-duotone`, `-light`), `lucide:`, `mdi:`, `ri:` (`-line` / `-fill`), `iconoir:`, `heroicons:`, `si:` (brand marks). In their own colours (marked `(colour)` in search; no Lottie): `fluent-emoji-flat:` emoji, `logos:` brand logos, `circle-flags:<iso code>` flags. Mix sparingly: one outline set per video reads as one design. |
| `image` | `asset` | `fit` cover/contain, `crop` {x,y,w,h} in 0..1, `filters` |
| `video` | `asset` | `in`, `out`, `speed`, `crop`, `volume`, `filters` |
| `chart` | `chart`, `data` | bar, line, pie, number; builds itself over 1 s (or animate `drawOn`) |
| `captions` | `words` or `source` | word timing from `motion_transcribe`; `captionStyle` pop/highlight/karaoke; `maxWords` per card |
| `group` | `children` | children are laid out inside the group's box and move with it |
| `lottie` | `asset` | an imported Lottie file, played on the scene's clock |
| `scene3d` | `scene3d` | a 3D scene (three.js) — recipes, objects, camera, lights; see «3D» below |

## 3. Layout — no pixels

- **Grid unit = 8 px on a 1080 short side.** Everything is in units: `x: 3` = 24 px at 1080.
- `layout.anchor`: `center, top, bottom, start, end, topStart, topEnd, bottomStart, bottomEnd`.
  Anchors other than `center` sit `margin` units (default 8) from the edge.
- `x`, `y`: offsets in units from the anchor (`x` toward the reading end, `y` down).
- **Relations** — prefer them to numbers: `below: "title", gap: 3` puts this under
  `title`; `above`; `beside` (after it in the reading direction). `align`: start/center/end.
  The engine uses the **measured** text size, so they never collide.
- `width` (units) sets the text box; text wraps on words inside it.
- Gaps come from the scale **1, 2, 3, 4, 6, 8, 12**. Margins per ratio: 9:16 → 8–10,
  1:1 → 8, 16:9 → 10–12.
- Pictures (`image`, `video`) without a width/height fill the frame.
- **Safe areas** (reels): keep text and logos out of the top ~220 px, bottom ~420 px and
  right ~120 px. YouTube 16:9: 5% from each edge. The check enforces it for important
  layers (all text unless `important: false`).

## 4. Colour, paint and type

- **Each video picks its own palette and fonts** (see the directing guide):
  ```jsonc
  "palette": { "surface": "#0b1020", "surface2": "#141b33", "onSurface": "#eef2ff",
               "muted": "#94a3c4", "primary": "#ffb547", "onPrimary": "#1a1205", "accent": "#5eead4" },
  "fonts":   { "display": "Lalezar", "body": "Almarai", "latin": "Poppins" }
  ```
  `palette` sets what the `brand.*` tokens mean in this video (you can add your own roles:
  `"glow": "#7c5cff"` → `brand.glow`). `fonts` takes any family — the shipped ones or any
  Google Fonts family by its exact name. One text can have its own face: `"fontFamily":
  "Bebas Neue"`. The workspace kit is only the default when a video sets neither.
- **Colours are open.** Use the tokens (`brand.surface`, `brand.surface2`,
  `brand.onSurface`, `brand.muted`, `brand.primary`, `brand.onPrimary`, `brand.accent`) so
  the video stays one system, or any hex colour (`#ff3366`, `#f36`, `#ff336680` with alpha),
  or `transparent`. The contrast check applies to every colour.
- **Gradients** wherever a fill goes — `fill`, text `color`, `background.color`,
  `composition.background`:
  `{ "type": "linear", "angle": 90, "stops": [{ "at": 0, "color": "#7928ca" }, { "at": 1, "color": "brand.primary" }] }`
  (`angle` 0 = across, 90 = top to bottom; `"type": "radial"` from the centre).
- **Depth:** `shadow: true` (soft) or `shadow: { color, blur, x, y, opacity }` (units);
  `glow: { color, size }` for neon edges; text `outline: { color, width }` for punchy titles
  over busy pictures.
- `primary` is for the one thing that matters in a beat (a number, the call to action).
  Body text is `onSurface`; secondary is `muted`. Text on `primary` uses `onPrimary`.
- Over video or photos: give text `shadow: true`, or a `background` pill, or a dark shape
  behind it — contrast is measured on the real frame (M002).
- Styles: `display` (one or two words), `headline`, `title`, `body`, `caption`. Sizes come
  from the kit. Words per line at most: 9:16 → display 2, headline 4, body 8;
  16:9 → headline 6, body 12.
- **Arabic:** never letter-spacing, never split letters for animation (words only — the
  engine already does this for typewriter), digits follow the text's language
  (`composition.digits: "arabic"` for ٠١٢٣).

## 5. Motion

- **Presets first**: `fadeIn/Out, fadeUp/Down, slideIn/Out (dir), scaleIn/Out, pop,
  bounceIn, blurIn, rotateIn (dir), typewriter, wordPop, lineReveal, maskReveal (dir), wipe,
  countUp (to), drawOn, kenBurns, zoomPunch, shake, float, pulse, spin (amount = turns),
  sweep (dir)`.
- **A cut transition in one layer** — `sweep` carries a full-frame panel across the cut:
  `{"id":"cut1","type":"shape","shape":"rect","fill":"brand.primary","important":false,
  "start":2.32,"end":2.88,"layout":{"anchor":"center","width":143,"height":248},
  "animate":[{"preset":"sweep","at":2.32,"duration":0.56,"dir":"start"}]}` for a cut at
  2.6 s in 9:16 (grid 135×240 → panel 143×248; 16:9 → 248×143; 1:1 → 143×143). It covers
  the frame exactly at the cut, so the outgoing shot ends and the next starts under it.
  `dir` up/down sweeps vertically. Don't build panels that scale from the middle.
  `{ "preset": "fadeUp", "at": 0.4, "duration": 0.6 }` — `duration` defaults to the kit's
  enter/exit times.
- **Keyframes** when a preset can't: `x, y, scale, rotation, opacity, blur, trim, color,
  count, cornerRadius` → `[{ "t": 1.2, "v": 0 }, { "t": 2.4, "v": 25, "ease": "outExpo" }]`.
- **Easings**: `linear, inOut, in, out, outExpo, outBack, spring, spring(k,d), brand`.
  Anything else is M007.
- The newest animation of a property wins; exits start from wherever the value is.
- Rhythm: enter 0.4–0.7 s, exit shorter (0.25–0.4 s); stagger 0.08–0.2 s between items;
  **one main motion at a time** (M006 fires at more than 3 starting together); calm first
  and last half-second.
- Reading time: a text needs 0.5 s + 0.3 s per word on screen (M005).

## 6. Audio

**Only when the user asks for it** (sound, music, effects, a voice-over). Otherwise
`audio` stays `[]`: no music, no effects.

```jsonc
{ "id": "music", "source": "procedural", "pattern": "warm-lofi", "tempo": 96, "gain": -18 },
{ "id": "w1", "source": "sfx", "kind": "whoosh", "at": 1.4 },
{ "id": "vo", "source": "asset", "asset": "vo", "at": 0.5, "gain": -6, "duck": "music" }
```

- **Compose your own music** (`source: "compose"`) — the sound is yours to design for
  this video, like its colours: tempo, key, chords, a melody, a bassline, the drums, which
  instruments and how they sound. Beats count from the track's `at`.

  ```jsonc
  { "id": "score", "source": "compose", "tempo": 92, "gain": -16, "reverb": 0.6, "swing": 0.15,
    "parts": [
      { "instrument": "keys", "notes": [{ "t": 0, "n": "Dm9", "d": 4 }, { "t": 4, "n": "Gm9", "d": 4 }], "loop": 8 },
      { "instrument": "bass", "notes": [{ "t": 0, "n": "D2", "d": 1.5 }, { "t": 4, "n": "G2", "d": 1.5 }], "loop": 8, "from": 4 },
      { "instrument": "bell", "notes": [{ "t": 0, "n": "A5" }, { "t": 1.5, "n": "F5" }, { "t": 3, "n": "D6", "d": 2 }], "loop": 8, "from": 8 },
      { "drum": "kick", "steps": "x.....x...x.....", "from": 4 },
      { "drum": "snare", "steps": "....x.......x...", "from": 4, "reverb": 0.3 },
      { "drum": "hat", "steps": "x.x.x.x.x.x.x.xx", "from": 8, "gain": -6 }
    ] }
  ```

  Instruments: `pad, strings, piano, keys, pluck, guitar, bell, marimba, bass, sub, 808,
  lead, synth, arp, brass, organ, choir, flute` — shape any of them: `wave` (sine, saw,
  square, triangle, fm, noise, string, piano, organ), `attack, decay, sustain, release`,
  `cutoff, resonance, detune, vibrato, octave, reverb, gain, pan`. Drums: `kick, snare,
  clap, hat, openhat, rim, tom, shaker, crash, ride, snap, cowbell, conga, perc` with `hits`
  (beats) or `steps` (16ths, `x` hit, `X` accent, `.` rest), `tune`, `decay`. `loop`
  repeats a part, `from`/`to` (beats) bring it in and out, `sidechain` (default on) ducks
  the chords under the kick.
- Ready-made patterns too (`source: "procedural"`): `warm-lofi, upbeat, cinematic,
  minimal, corporate` (+ `tempo`, `key` like `Am`) — the same few beds for everyone; compose
  when the video deserves its own sound.
- SFX kinds: `whoosh, pop, click, riser, impact, swoosh, tick, ding, typing` — each can be
  `tune`d (semitones) and stretched (`length`), and a composed part can be an effect too (a
  single `bell` hit, a `crash`, an `808` drop). Put one on an important entrance or a cut,
  not on everything.
- Levels: music about −18 dB, effects −12, voice −6. `duck` lowers music under a voice.
- The mix is limited to −1 dBTP and normalised to −14 LUFS automatically.
- Voice-over only with `motion_tts`, and only if it works (a voice provider is set). If
  it doesn't, don't promise one: use captions.

## 3D — `scene3d` layers

A `scene3d` layer is a 3D scene (three.js) drawn into the layer's box — by default the
whole frame, transparent, so 2D layers can sit behind and in front of it (titles in 2D
over a 3D background, captions on top). Arabic 3D text is shaped properly (joined, RTL).

```jsonc
{ "id": "hero", "type": "scene3d", "start": 0, "end": 8,
  "scene3d": {
    "recipe": "logoReveal", "params": { "text": "رفيق", "material": "chrome", "mood": "night" },
    // anything below is optional and goes on top of the recipe
    "camera": { "position": [0, 0.4, 7.5], "fov": 32, "move": { "type": "orbit", "amount": 30 } },
    "objects": [ { "id": "ring", "kind": "torus", "radius": 2.4, "thickness": 0.03, "material": "glow",
                   "color": "brand.accent", "animate": [{ "preset": "turntable", "at": 0, "amount": 40, "axis": "z" }] } ],
    "post": { "bloom": 0.6, "vignette": 0.3 }
  } }
```

**Recipes** (a complete look from a few params): `logoReveal` (text | svg | icon,
material, mood, color) · `particleText` (text, from, colors, count) · `kineticType3D`
(lines, style stack|tunnel|wave, material) · `galaxy` (arms, colors, count, spin) ·
`solarSystem` (planets: [{color, radius, orbit, speed}], sun) · `globeArcs` (points
[[lat, lon]…], hub, style dots|wire|solid, color, spin) · `voxelCity` (size, palette) ·
`chromeBlob` (noise, speed, colors, material) · `productSpin` (asset = a .glb, or shape,
material, turns, pedestal) · `cardStack` (images [asset…], layout fan|stack|carousel) ·
`bars3D` (data {values, labels}, material, color) · `physicsDrop` (of, count, colors).
Moods: `night, studio, sunset, dawn, city`. Or skip the recipe and build `objects` yourself.

**Units.** World units, y up; the camera sits about 7 from the origin looking at it; a
title is about 1 tall; rotations in degrees. Times (`at`, key `t`) are scene seconds,
inside the layer.

**Objects** (`kind`): `box` (width/height/depth, radius = rounded corners), `sphere`,
`cylinder`, `cone`, `torus`, `torusKnot`, `capsule`, `plane`, `ring` (thin circle),
`icosahedron` · `text3d` (text, size, depth, bevel, font display|body|latin, split
words|letters for staggered parts, fit) · `extrude` (svg path data, or a one-colour
icon) · `model` (asset: an uploaded .glb; size, animation) · `image` (asset, height,
cornerRadius) · `particles` (count, shape sphere|shell|disc|ring|cube|galaxy|grid|wave|
helix|text|image, `to` another shape + `morph` keys 0→1, toText, colors, size, drift,
glow) · `instances` (of box|sphere|…, layout grid|wall|ring|spiral|helix|random|city|line,
rows, cols, count, gap, colors) · `tube` (points, radius; draws with `trim`) · `globe`
(radius, style, arcs [{from:[lat,lon], to, at}], markers, atmosphere) · `blob` (noise,
speed) · `ground` (catches shadows; `color` makes it a floor) · `group` (children).
Every object: `position`, `rotation`, `scale`, `material`, `color`, `opacity`, `shadow`,
`pivot: "bottom"` (grows up from its base), `animate`, `keyframes`.

**Materials:** `chrome, gold, metal, glass, frosted, plastic, clay, rubber, matte, neon,
holographic, toon, wire, glow` — or an object `{ preset, color, metalness, roughness,
transmission, clearcoat, iridescence, emissive, emissiveIntensity, opacity }`.

**Pictures on surfaces (textures).** Bring the picture in first — `motion_fetch_image`
with the image's own link (a planet's equirectangular map, a label, a logo), or
`motion_stock` — then name its asset: `"texture": "earth"` on a `sphere` or a `globe`
(`style: "texture"`) wraps it around; on a box or plane it covers the face. More maps in
the material object: `bumpMap` (+ `bumpScale`), `normalMap`, `roughnessMap`, `emissiveMap`
(what glows by itself — a planet's night lights). Planet rings: a `ring` with `radius`,
`width` and a `texture` running from the inner edge out (transparent PNG keeps the gaps).

```jsonc
{ "id": "earth", "kind": "sphere", "radius": 1.6, "texture": "earth",
  "material": { "bumpMap": "earthBump", "emissiveMap": "earthNight", "emissiveIntensity": 0.8 },
  "rotation": [0, 0, 23.4], "animate": [{ "preset": "turntable", "at": 0, "amount": 12 }] },
{ "id": "rings", "kind": "ring", "radius": 2.3, "width": 1.8, "texture": "saturnRings", "rotation": [26, 0, 0] }
```

**Motion.** `animate` presets: `rise, drop, pop, spinIn, flip, slideIn, zoomIn, fadeIn,
fadeOut, float, turntable, orbit, pulse, grow, assemble, scatter, draw` (+ `duration`,
`ease` incl. `bounce`, `amount`, `axis`, `stagger` — on the parts: words or letters,
instances, a group's children). `keyframes`: `position | rotation | scale` (an [x,y,z]
or one axis: `rotation.y`), `opacity, color, glow, morph, trim`.

**Camera:** `position`, `target`, `fov`, `move` {type orbit|dolly|push|crane|handheld,
amount, ease, at, duration}, or `keyframes` {position, target, fov}. **Lights:** `key,
fill, rim, ambient, point, spot, hemisphere` (color, intensity, position, shadow) — none
given = a key, a rim in brand.primary, a fill and ambient. **environment:** `studio, city,
sunset, night, dawn, none` (reflections; chrome and glass need one). **fog**, **background**
(a paint behind the 3D, inside the layer's box), **exposure**, **post** {bloom 0–3,
vignette, grain}.

Limits: 100k particles a scene, 10k instances an object. 3D can't go to Lottie (MP4 only).
Look at it with `motion_render_frames` — a 3D scene's mistakes (too dark, cut off, the
camera inside something) only show in the picture.

## 7. Checks and fixes

| code | means | fix |
|---|---|---|
| M001 | off the grid | whole units; gaps from the scale |
| M002 | contrast < 4.5:1 (3:1 large) on the drawn frame | onSurface/muted swap, `shadow`, background pill, darker shape behind |
| M003 | text overflows its box or the frame | smaller style, `width`, fewer words, split into two layers |
| M004 | important layer in the platform's UI zone | move inside the safe area (larger `y` from top / smaller from bottom) |
| M005 | not on screen long enough to read | longer `end`, or fewer words |
| M006 | more than 3 main motions at once | stagger the `at` times |
| M007 | easing not allowed | use an allowed one |
| M009 | two texts (or text and an important layer) overlap | `below`/`above`/`gap`, or separate them in time |
| M010 | starts or ends off-frame with no entrance/exit | fix the anchor or add slideIn/slideOut |
| M011 | a property jumps between two frames | add a keyframe with an ease, or a preset |
| M012 | text smaller than readable | a bigger style |
| A001/A002/A003 | audio peaks, loudness, music over voice | lower the source; add `duck` |
| L001 | not exportable as Lottie | remove it or export MP4 |

Export refuses M002/M003/M004 unless the user says to go ahead.

## 8. Recipes

**Reel 9:16, 8–15 s.** Hook in the first second (display word, `pop`), 3–4 beats of
2–3 s, one idea each, captions or short lines, end card with the call to action in
`primary`, logo small at `bottom`. (Music + 2–3 effects if the user wants sound.)

**Logo intro, 3–5 s.** Shape `drawOn` → logo `scaleIn` (`spring`) → name `fadeUp`
`below` it → hold → fade out. (With sound: one `riser` into an `impact` on the logo.)

**Explainer 16:9, 20–40 s.** Title beat, then three points: each point is a `headline`
with an `icon` `beside` it and a `body` `below`, `lineReveal`; numbers as `countUp`.

**Animated chart.** `chart` bar/line with labels; a `headline` above; the key number as a
`text` `{count}` with `countUp` in `primary`; source in `caption`, `muted`.

**App demo.** `image` screenshots (16:9 or inside a rounded `group`), `kenBurns` slowly,
a `text` callout with a `background` pill `beside` the feature, cut every 2–3 s.

**The user's video.** `video` layer (trim with `in`/`out`, `speed`, `crop` for 9:16 from
16:9: `{ "x": 0.34, "y": 0, "w": 0.32, "h": 1 }`), `motion_transcribe` → a `captions`
layer with `source`, a lower third (`group` of a `rect` + name + role), `filters`
for a light grade (`contrast: 1.08, saturation: 1.1, warmth: 0.15`).

## 9. A complete example (passes every check)

See `examples/reel.json` — a 9:16 reel with a hook, a counting number, an icon row, an
end card, music and two effects (this one was asked for sound). `examples/intro.json` is a 4 s logo intro;
`examples/chart.json` an animated bar chart.
