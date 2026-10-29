# 3D, step by step

Use this whenever the user asks for anything 3D: a 3D logo or title, particles, a globe,
a galaxy, a city, a landscape, a room, a product, a character, "anything in 3D". The engine
draws everything from the `scene3d` layer — never write HTML, CSS, JavaScript or three.js
code; code in a reply never reaches the video.

There are three ways to get a 3D thing on screen, from the quickest to the freest. Pick the
first one that fits:

1. **A recipe** — a finished look from a few params (a logo reveal, a galaxy, 3D bars…).
2. **A ready-made thing** — `{ "kind": "tree" }`, `{ "kind": "city" }`, `{ "kind": "car" }`…
   real objects with good proportions, colours and details already in them.
3. **Built from parts** — a `group` of shapes, for anything else (a chair, a rocket, a
   robot, a cup of coffee). Anything can be built this way; see «Build anything».

## Step 1 — pick the starting point

| the user wants… | use | fill |
|---|---|---|
| a logo, a name, a title in 3D | recipe `logoReveal` | `text` (or `icon`), `material`, `mood` |
| text that forms out of particles / dust / stars | recipe `particleText` | `text`, `colors` |
| several lines of big 3D text, a slogan | recipe `kineticType3D` | `lines` (2–4 short lines), `style` |
| space, a galaxy, "something cosmic" | recipe `galaxy` | `colors` |
| planets, a solar system | recipe `solarSystem` | — |
| a real planet with its true surface | a `sphere` with `texture` | `motion_fetch_image` the map first |
| countries, travel, "worldwide" | recipe `globeArcs` | `points` [[lat, lon]…], the first is the hub |
| a city, a skyline, towers, downtown | **`{ "kind": "city" }`** | `rows`, `cols`, `height`, `colors`, `windows` |
| one tower, a few buildings | `{ "kind": "building" }` | `variant`, `height`, `width` |
| nature: trees, a forest, rocks, mountains, clouds | `tree`, `bush`, `flower`, `rock`, `mountain`, `cloud` | `variant`, `height`, `position` |
| a street, a neighbourhood | `road`, `house`, `streetLamp`, `car`, `person`, `bench`, `fence` | `position`, `rotation` |
| a lake, the sea | `{ "kind": "water" }` | `width`, `depth`, `color` |
| abstract tech blocks, "digital world" | recipe `voxelCity` | `palette` |
| an abstract shiny shape, liquid metal | recipe `chromeBlob` | `material` |
| a product the user uploaded (.glb) | recipe `productSpin` | `asset` |
| screenshots floating in 3D | recipe `cardStack` | `images`, `layout` |
| numbers, a comparison, growth | recipe `bars3D` | `data` {values, labels} |
| a heart, a star, a bolt, a gear… | `{ "kind": "extrude", "outline": "heart" }` | `outline`, `material`, `color` |
| a vase, a bottle, a cup, a bowl | `{ "kind": "lathe", "profile": [...] }` | `profile` |
| anything else | **build it from parts** | see «Build anything» |

## Ready-made things

They stand on their base: `position` is the point on the ground under them (y 0 = the
ground). Size with `height` (or `size`/`width`); turn with `rotation` [0, degrees, 0]. They
take every usual field: `animate`, `keyframes`, `material` (one look for all of it — a clay
town, a gold tree), `color`, `colors`, `shadow`, `seed` (another arrangement).

| kind | what | its fields |
|---|---|---|
| `tree` | a tree, ~2.2 tall | `variant` round · pine · palm · autumn; `height`; `color`/`colors` for the leaves |
| `bush` | a low round bush | `size` |
| `flower` | a flower on a stem | `color` (the petals), `height` |
| `rock` | a low-poly stone (a shape, not a group) | `radius`, `height`, `noise` 0–1 (how rough), `color` |
| `mountain` | a peak with forest, rock and snow | `radius`, `height`, `variant: "bare"` (no snow), `noise` |
| `cloud` | a puffy cloud | `size`, `color` |
| `building` | one building with lit windows and a roof — describe each tower so no two look alike | `form` box · slab · round · tapered (`taper`) · twisted (`twist`) · stepped · triangle · lshape; `top` flat · spire · pyramid · gable · dome · crown (a band of light) · helipad · antenna; `podium` (a wider base); `height`, `width`, `depth`, `floors`; `color` (concrete, or the glass tint); `windows.style` grid · bands · fins · curtain · diagrid. Or just `variant` tower · glass · classic · setback · spire · residential |
| `city` | a whole downtown: blocks of buildings (tallest in the middle), streets, lane lines | `rows`, `cols` (≤ 16), `height` (the tallest), `size` (a lot, 1.6), `gap` (street, 0.45 of a lot), `variant` (one style for all), `colors` (façades), `windows`, `trees` (true, or one every N lots), `roads` |
| `house` | a house: walls, a pitched roof, a door, windows, a chimney | `width`, `height`, `depth`, `color` (walls), `colors` [roof] |
| `streetLamp` | a lamp post with a glowing head | `height`, `color` (the light) |
| `car` | a small car with lights and wheels | `size` (its length, 1), `color` |
| `person` | a simple figure, ~0.9 tall | `height`, `color` (the clothes) |
| `road` | a straight road with dashed lines, along z | `width`, `depth` (its length), `color` |
| `water` | still water that mirrors everything above it (a marina, a lake, the sea) | `width`, `depth`, `color`, `reflect` 0–1 (0.7; 1 = a clear mirror). Any `box` takes `reflect` too: a wet street, a polished floor |
| `fence` | a wooden fence along x | `width` (its length), `height`, `color` |
| `bench` | a park bench | `size`, `color` |

**Windows** (on `building`, `city`, or any `box`): `true`, or `{ "lit": 0–1, "glow": 1,
"light": "#ffd59a", "glass": "#3b4a5c", "style": "grid"|"bands", "cols": n }`. A day scene:
`lit` 0.15–0.3; a night city: `lit` 0.5–0.7 with `glow` 1.2–1.6 and some `bloom`.

A city's parts are its buildings, so `"animate": [{ "preset": "rise", "at": 0.2,
"stagger": 0.03 }]` raises it building by building (the streets are there from the start).

## Copy a real place from a photo

When the user names a real place or wants something to look real (a skyline, «a district of
towers», a landmark, a street, a building), don't invent it — **copy a photo of it**:

1. `motion_reference` with the place's English name («Dubai Marina skyline», «Riyadh
   skyline night», «Shanghai Lujiazui from the Bund»). It shows you real photos; pick the one
   closest to what the user asked (day or night, the angle). `skip` shows others.
2. Write down what you see, left → right, front → back: every tower's place across the
   picture (x from −1 to 1), its height against the tallest, its width, `form`, `top`,
   façade `style`, colour or glass tint, a `podium`, a lit crown; then the water, the
   promenade, roads, trees, hills, the sky's colours.
3. Build each tower as its own `building` with those fields (never a generated `city` for a
   real place, never two towers alike unless they are in the photo). Place them in depth:
   x = (place across) × distance × 0.87 for a 52° lens; nearer things lower in the frame.
   Water in front of a waterfront: `water` (it mirrors the towers); lamps along a
   promenade: a row of `streetLamp`.
4. Match the camera to the photo: its height (water or street level ≈ 1, a rooftop, the
   air), `fov` (wide 50–60 for a close waterfront, 25–35 for a far skyline), where the
   horizon falls; the background gradient and the light from its sky and its time of day.
5. `motion_render_frames`, compare it with the photo, fix the biggest difference (a missing
   tower, a wrong height, the wrong top), and again — two or three rounds.

Credit the photo's author to the user if you mention where it came from; the photo itself
isn't in the video (unless you add it with `motion_fetch_image`).

## Build anything from parts

Anything that isn't a recipe or a ready-made thing is a `group` of simple shapes. Think
like a modeller: **what are its 3–12 main pieces, and which shape is each?**

**The shapes:** `box` (width/height/depth; corners are softly rounded by default, `radius`
for more, `radius: 0` for razor-sharp), `sphere`, `dome` (half a sphere), `cylinder`,
`cone`, `capsule` (a pill: limbs, bodies), `torus` (a ring, a handle, a tyre), `prism`
(lies along x with an edge up: a roof; `sides` 6 for a hexagonal bar), `rock` (a rough
lump: stones, low-poly foliage), `lathe` (a profile turned round: vases, bottles, cups,
lamps, chess pieces, a rocket's body), `extrude` (a flat outline given depth: hearts,
stars, letters, icons, any SVG path), `tube` (a curve through points: cables, paths,
arcs), `text3d`.

**Placing pieces:** every child has its own `position` (from the group's origin),
`rotation` (degrees) and `pivot: "bottom"` (stands on its base — easiest for stacking: a
piece on top of another sits at the lower one's height). Nest groups for joints (an arm
turning at the shoulder: a group at the shoulder holding the arm piece offset from it).

**How to build common things:**

| thing | pieces |
|---|---|
| table | a flat box top + 4 thin boxes/cylinders as legs at the corners |
| chair | seat box, back box (tilted -8°), 4 legs |
| lamp | lathe or cone shade (emissive), thin cylinder stem, flat cylinder base |
| cup / mug | lathe body (open top) + torus handle at its side (rotation [0, 0, 90]) |
| rocket | lathe body (pointed profile), 3–4 extrude fins round it, a glow cone flame under it |
| robot | box torso, box or sphere head, capsule arms and legs, sphere eyes in `glow` |
| character | capsule body, sphere head, capsule arms; eyes = small dark spheres |
| bridge | box deck, cylinder towers, tube cables between them |
| ship / boat | lathe or box hull (scaled), box cabin, cylinder mast, plane sail |
| island | `rock` (wide, low) + `tree` (palm) + `water` around it |
| room | `ground` + two big boxes as walls (`radius: 0`) + furniture from the table above |
| planet with a ring | `sphere` + flat `ring` with `width` |
| coins, chips | flat cylinders; many of them with `instances` |

Keep real-world proportions (a door ~2 tall when a person is ~1.8, a table ~0.75 high),
and give each piece the material its real surface has.

## Make it look good

- **Scale:** 1 unit ≈ 1 metre in a world scene (a person 1.7, a floor 3, a tree 2–6), or
  "a title is about 1" in an abstract one. Stay consistent inside a scene.
- **Soft edges:** boxes are already slightly rounded; add `radius` for friendly, toy-like
  things (phones, cards, buttons: 0.08–0.2). Sharp (`radius: 0`) only for walls, floors,
  thin lines.
- **Materials by surface:** wood, fabric, stone, foliage → `matte` or `clay` (warm
  colours); painted metal, car paint → `plastic` with `clearcoat`; steel → `metal`;
  mirrors, logos → `chrome`; windows, bottles → `glass`; screens, lamps, signs → `neon` or
  `glow`; a stylised world → one `material` for everything (`clay` or `toon`).
- **Colour:** 3–4 colours plus neutrals. A night city: dark façades
  (`"colors": ["#2b3140", "#353c4c", "#3f4657", "#272c38"]`) so the lit windows carry it. A
  day scene: light façades, sky-blue background, green ground.
- **Light:** day outdoors — a warm `key` from high up with `shadow`, a `hemisphere` (sky
  colour over ground colour), `environment: "dawn"` or `"sunset"`. Night — `environment:
  "night"`, a dim cool `hemisphere`, a coloured `rim`, glow from windows and lamps, `bloom`
  0.8–1.2. Product/studio — `environment: "studio"`, key + rim + fill.
- **Depth:** a `ground` (with `color` for a floor, without for shadows only), `fog` the
  colour of the background's horizon (near ≈ the scene's far edge, far ≈ 2× it), things
  in front, in the middle and behind.
- **Camera:** `fov` 35–45; frame the subject with some air around it; never inside an
  object; a slow move sells 3D — `orbit` 20–40°, a `push`, or `keyframes` for a flyover
  (high and far → low and close, `ease` `inOut`). Look at the subject's middle (`target`),
  not at its feet.
- **Motion:** things arrive (`rise`, `pop`, `assemble` with a `stagger`), then live
  (`float`, `turntable`, a slow camera). One idea per shot.

## Scene templates

**A night city** (towers rising, a flyover, lit windows):

```json
{ "id": "city3d", "type": "scene3d", "start": 0, "end": 10,
  "scene3d": {
    "environment": { "preset": "night", "intensity": 0.6 },
    "background": { "type": "linear", "angle": 180, "stops": [{ "at": 0, "color": "#0a1030" }, { "at": 1, "color": "#3a2346" }] },
    "fog": { "color": "#1b1840", "near": 18, "far": 48 },
    "camera": { "fov": 40, "keyframes": {
      "position": [{ "t": 0, "v": [16, 13, 18], "ease": "inOut" }, { "t": 10, "v": [-6, 4, 11] }],
      "target": [{ "t": 0, "v": [0, 1, 0], "ease": "inOut" }, { "t": 10, "v": [0, 3, 0] }] } },
    "lights": [ { "type": "hemisphere", "color": "#6f7dff", "ground": "#1a1020", "intensity": 0.55 },
                { "type": "key", "color": "#ffd2a6", "intensity": 1.2, "position": [-8, 14, 6], "shadow": true },
                { "type": "rim", "color": "#ff5fa2", "intensity": 1.6, "position": [10, 6, -12] } ],
    "objects": [
      { "id": "floor", "kind": "ground", "color": "#0c0e18" },
      { "id": "downtown", "kind": "city", "rows": 8, "cols": 8, "height": 9, "trees": 3,
        "colors": ["#2b3140", "#353c4c", "#3f4657", "#272c38"],
        "windows": { "lit": 0.55, "glow": 1.4 },
        "animate": [{ "preset": "rise", "at": 0.2, "duration": 1.2, "stagger": 0.03, "ease": "outBack" }] } ],
    "post": { "bloom": 1, "vignette": 0.35 } } }
```

For a day city: `environment: "dawn"`, a light sky gradient, a `key` with `shadow` and a
`hemisphere` ("#dfeeff" over "#6b7f5a"), no `colors` (light façades), `windows.lit` 0.2.

**A landscape** (low-poly nature): a green `ground`, two or three `mountain`s behind
(z −8 to −12), `tree`s of mixed `variant` in the middle, `rock`s and `flower`s in front, a
`cloud` or two high up, a `water` lake, `environment: "dawn"`, camera at [0, 4, 12] looking
at [0, 1.2, 0] with a slow `orbit` of 20.

**A product on a pedestal:** recipe `productSpin` — or the object (built from parts) on a
`cylinder` pedestal, `ground` for the shadow, `environment: "studio"`, `turntable`.

## Step 2 — write the layer

- `start` 0, `end` = how long it shows (6–12 s is good; never past the video's end).
- Text in 3D: **at most 3 words**. Longer sentences go in a normal 2D `text` layer on top.
- Add it with one patch: `[{ "op": "add", "path": "/layers/0", "value": <the layer> }]` —
  at index 0 it sits at the back, so 2D text can go on top. Text over a busy 3D scene
  needs a dark shape behind it (a `shape` layer with a gradient) to stay readable.

## Step 3 — look, then fix one thing per patch

Call `motion_render_frames` at three times (start, middle, end). Then fix **one** problem
per patch:

| you see | do this |
|---|---|
| the frame is black or very dark | `"environment": "studio"` (or dawn), or `"exposure": 1.3`, or a `hemisphere` light |
| the thing is cut off at the edges | move the camera back, or a wider `fov` |
| it looks flat | a `rim` light from behind, `shadow` on the key, a `ground` to catch it |
| it looks like grey boxes | ready-made things instead of boxes; real colours and materials per part; `radius` on boxes |
| nothing moves | a camera `orbit` or keyframed flyover; `animate` with a `stagger` |
| too bright, washed out | `"exposure": 0.7`, less `bloom`, darker façades at night |
| the ground ends in a hard line | `fog` the colour of the horizon |
| Arabic letters look broken | one line, `split` only `"words"` (never `"letters"` for Arabic) |
| the scene is slow to draw | fewer `rows`/`cols` in a city (8×8 is plenty), fewer particles |

## Step 4 — finish

Run `motion_lint`; fix errors. Tell the user in two or three short lines what the 3D shows.

## Rules

- One `scene3d` layer per shot. Two 3D layers on screen at once only when the user asks.
- Times stay inside the layer (`at` and key `t` between `start` and `end`).
- Never more than 20 000 particles; a city at most 16 × 16.
- No sound unless the user asked for it.
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
