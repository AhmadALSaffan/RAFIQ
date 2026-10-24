/**
 * Recipes: a finished 3D look from a few params (`{ recipe: "logoReveal", params: { text } }`).
 * Each expands into a full scene — camera, lights, objects, timing over the layer — and
 * whatever the layer also says (`camera`, `objects`, `post`…) goes on top: objects are
 * added, the rest overrides. A model that knows little still gets a scene that works.
 */

import type { Anim3, ColorRef, Environment3, Light3, Material3Name, Object3, Paint, Recipe3, Scene3D, Vec3 } from "../types";

export const RECIPES: Recipe3[] = [
  "logoReveal", "productSpin", "particleText", "galaxy", "solarSystem", "globeArcs", "cardStack",
  "voxelCity", "kineticType3D", "chromeBlob", "bars3D", "physicsDrop",
];

type Params = Record<string, unknown>;

const str = (p: Params, k: string, d: string) => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string) : d);
const num = (p: Params, k: string, d: number) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : d);
const list = <T,>(p: Params, k: string): T[] => (Array.isArray(p[k]) ? (p[k] as T[]) : []);

const MOODS: Record<string, { env: Environment3; bg: Paint; fog: ColorRef }> = {
  night: { env: "night", bg: { type: "radial", stops: [{ at: 0, color: "#141a33" }, { at: 1, color: "#05060c" }] }, fog: "#05060c" },
  studio: { env: "studio", bg: { type: "radial", stops: [{ at: 0, color: "#2a2d34" }, { at: 1, color: "#0c0d10" }] }, fog: "#0c0d10" },
  sunset: { env: "sunset", bg: { type: "linear", angle: 90, stops: [{ at: 0, color: "#2b1530" }, { at: 1, color: "#0d0710" }] }, fog: "#120a14" },
  dawn: { env: "dawn", bg: { type: "linear", angle: 90, stops: [{ at: 0, color: "#dfe7f2" }, { at: 1, color: "#b9c6d8" }] }, fog: "#c9d3e2" },
  city: { env: "city", bg: { type: "radial", stops: [{ at: 0, color: "#18202b" }, { at: 1, color: "#07090d" }] }, fog: "#07090d" },
};

function mood(p: Params, fallback = "night") {
  return MOODS[str(p, "mood", fallback)] ?? MOODS[fallback];
}

const LIGHTS = (rim: ColorRef = "brand.primary"): Light3[] => [
  { type: "key", color: "#ffffff", intensity: 1.9, position: [4, 6, 5], shadow: true },
  { type: "rim", color: rim, intensity: 2.4, position: [-5, 3, -4] },
  { type: "fill", color: "#a9b8ff", intensity: 0.5, position: [-4, 1, 5] },
  { type: "ambient", intensity: 0.25 },
];

const dust = (count = 1400, color: ColorRef = "brand.accent"): Object3 => ({
  id: "dust", kind: "particles", shape: "sphere", radius: 9, count, size: 0.03, color, opacity: 0.6, drift: 0.25, glow: true,
});

/** Text or a mark: a 3D title made of the text, an SVG path or an icon. */
function mark(p: Params, size: number, material: Material3Name, extra: Partial<Object3> = {}): Object3 {
  const svg = str(p, "svg", "");
  const icon = str(p, "icon", "");
  if (svg) return { id: "mark", kind: "extrude", svg, size, depth: size * 0.25, bevel: size * 0.03, material, ...extra };
  if (icon) return { id: "mark", kind: "extrude", icon, size, depth: size * 0.25, bevel: size * 0.03, material, ...extra };
  return { id: "title", kind: "text3d", text: str(p, "text", "Rafiq"), size, depth: size * 0.26, bevel: size * 0.028, material, font: "display", fit: true, ...extra };
}

function build(recipe: Recipe3, p: Params, s: number, e: number): Scene3D {
  const d = Math.max(0.5, e - s);
  const material = str(p, "material", "chrome") as Material3Name;
  const color = str(p, "color", "");
  const tint = color ? { color } : {};
  switch (recipe) {
    case "logoReveal": {
      const m = mood(p);
      return {
        background: m.bg,
        environment: m.env === "night" ? { preset: "studio", intensity: 0.9 } : m.env,
        fog: { color: m.fog, near: 9, far: 22 },
        camera: { position: [0, 0.3, 7.6], fov: 32, move: { type: "dolly", amount: 0.16, ease: "inOut" } },
        lights: LIGHTS(),
        objects: [
          {
            ...mark(p, 1.25, material, tint),
            animate: [{ preset: "spinIn", at: s + 0.15, duration: 1.6 }, { preset: "float", at: s + 1.8, amount: 0.06 }],
            keyframes: { "rotation.y": [{ t: s + 1.6, v: -8 }, { t: e, v: 10, ease: "inOut" }] },
          },
          { id: "floor", kind: "ground", position: [0, -1.25, 0], opacity: 0.4 },
          dust(),
        ],
        post: { bloom: 0.55, vignette: 0.35, grain: 0.04 },
      };
    }
    case "productSpin": {
      const m = mood(p, "studio");
      const asset = str(p, "asset", "");
      const hero: Object3 = asset
        ? { id: "product", kind: "model", asset, size: 2.4, position: [0, 0.15, 0] }
        : { id: "product", kind: (str(p, "shape", "box") as Object3["kind"]), size: 1.7, radius: 0.9, material, ...tint, position: [0, 0.35, 0] };
      return {
        background: m.bg,
        environment: m.env === "night" ? "studio" : m.env,
        camera: { position: [0, 1.4, 7], target: [0, 0.2, 0], fov: 30, move: { type: "crane", amount: 1.2, ease: "outExpo", duration: Math.min(d, 3) } },
        lights: LIGHTS(),
        objects: [
          { ...hero, animate: [{ preset: "rise", at: s + 0.1, duration: 1.2 }, { preset: "turntable", at: s, amount: (360 * num(p, "turns", 1)) / d }] },
          ...(p.pedestal === false ? [] : [{ id: "pedestal", kind: "cylinder", radius: 1.6, height: 0.3, position: [0, -1.05, 0], material: "matte", color: "brand.surface2" } as Object3]),
          { id: "floor", kind: "ground", position: [0, -1.2, 0], opacity: 0.45 },
        ],
        post: { bloom: 0.3, vignette: 0.3 },
      };
    }
    case "particleText": {
      const hold = Math.min(d * 0.5, 2.6);
      const out = d > 5 ? [{ t: e - 1.2, v: 1 }, { t: e - 0.1, v: 0, ease: "in" }] : [];
      return {
        background: mood(p).bg,
        camera: { position: [0, 0, 8], fov: 34, move: { type: "orbit", amount: 22, ease: "inOut" } },
        objects: [
          {
            id: "letters", kind: "particles", shape: (str(p, "from", "sphere") as Object3["shape"]), to: "text", toText: str(p, "text", "Rafiq"),
            count: num(p, "count", 9000), size: 0.045, radius: 6, height: 1.6,
            colors: list<ColorRef>(p, "colors").length ? list<ColorRef>(p, "colors") : ["brand.primary", "brand.accent", "#ffffff"],
            drift: 0.04, glow: true,
            keyframes: { morph: [{ t: s + 0.3, v: 0 }, { t: s + 0.3 + hold, v: 1, ease: "inOut" }, ...out] },
          },
          dust(800),
        ],
        post: { bloom: 0.9, vignette: 0.4 },
      };
    }
    case "galaxy": {
      const colors = list<ColorRef>(p, "colors");
      return {
        background: { type: "radial", stops: [{ at: 0, color: "#0b0b1e" }, { at: 1, color: "#010104" }] },
        camera: { position: [0, 6, 9], fov: 40, keyframes: { position: [{ t: s, v: [0, 9, 4] }, { t: e, v: [0, 2.2, 9], ease: "inOut" }] } },
        objects: [
          {
            id: "galaxy", kind: "particles", shape: "galaxy", arms: num(p, "arms", 3), count: num(p, "count", 14000), radius: 6, size: 0.04,
            colors: colors.length ? colors : ["brand.primary", "brand.accent", "#ffffff", "#9fb4ff"], glow: true, drift: 0.02,
            animate: [{ preset: "turntable", at: s, amount: num(p, "spin", 14) }],
          },
          { id: "core", kind: "sphere", radius: 0.28, material: "glow", color: "#fff1d6" },
          { id: "stars", kind: "particles", shape: "shell", radius: 40, count: 1500, size: 0.08, color: "#ffffff", opacity: 0.8 },
        ],
        post: { bloom: 1.1, vignette: 0.45 },
      };
    }
    case "solarSystem": {
      const planets = list<{ name?: string; color?: string; radius?: number; orbit?: number; speed?: number }>(p, "planets");
      const set = planets.length
        ? planets
        : [
            { color: "#b8b1a6", radius: 0.18, orbit: 2 },
            { color: "#e3b26b", radius: 0.3, orbit: 3 },
            { color: "#3f8fe0", radius: 0.32, orbit: 4.1 },
            { color: "#d0613d", radius: 0.24, orbit: 5.1 },
            { color: "#d9b37d", radius: 0.7, orbit: 6.8 },
          ];
      const objects: Object3[] = [
        { id: "sun", kind: "sphere", radius: 1, material: "glow", color: str(p, "sun", "#ffb547"), animate: [{ preset: "pulse", at: s, amount: 0.03 }] },
        { id: "stars", kind: "particles", shape: "shell", radius: 45, count: 1800, size: 0.09, color: "#ffffff", opacity: 0.85 },
      ];
      set.forEach((pl, i) => {
        const r = pl.orbit ?? 2 + i * 1.2;
        objects.push({ id: `orbit${i}`, kind: "ring", radius: r, thickness: 0.012, rotation: [90, 0, 0], material: "glow", color: "#ffffff", opacity: 0.18 });
        objects.push({
          id: `planet${i}`, kind: "sphere", radius: pl.radius ?? 0.3, position: [r, 0, 0], material: "plastic", color: pl.color ?? "#cccccc",
          animate: [{ preset: "orbit", at: s, amount: pl.speed ?? 60 / Math.pow(r, 1.2) }, { preset: "turntable", at: s, amount: 40 }],
        });
      });
      return {
        background: { type: "radial", stops: [{ at: 0, color: "#0a0d1c" }, { at: 1, color: "#010205" }] },
        camera: { position: [0, 5.5, 12], fov: 38, move: { type: "orbit", amount: 30, ease: "inOut" } },
        lights: [{ type: "point", color: "#fff2d6", intensity: 60, position: [0, 0, 0] }, { type: "ambient", intensity: 0.12 }],
        objects,
        post: { bloom: 1, vignette: 0.4 },
      };
    }
    case "globeArcs": {
      const pts = list<[number, number]>(p, "points");
      const points = pts.length >= 2 ? pts : ([[24.7, 46.7], [51.5, -0.1], [40.7, -74], [35.7, 139.7], [-33.9, 151.2], [25.2, 55.3], [30, 31.2]] as [number, number][]);
      const hub = p.hub !== false;
      const arcs = points.slice(1).map((to, i) => ({ from: hub ? points[0] : points[i], to, at: s + 0.8 + i * 0.35, duration: 1.3 }));
      return {
        background: mood(p).bg,
        camera: { position: [0, 0.5, 11], fov: 32, move: { type: "dolly", amount: 0.12 } },
        lights: [{ type: "key", intensity: 1.6, position: [5, 3, 5] }, { type: "ambient", intensity: 0.4 }],
        objects: [
          {
            id: "globe", kind: "globe", radius: 2.2, style: (str(p, "style", "dots") as Object3["style"]), color: str(p, "color", "brand.primary"),
            atmosphere: "brand.accent", arcs, markers: points,
            rotation: [12, -(points[0]?.[1] ?? 0) - 10, 0],
            animate: [{ preset: "fadeIn", at: s, duration: 0.8 }, { preset: "turntable", at: s, amount: num(p, "spin", 6) }],
          },
          { id: "stars", kind: "particles", shape: "shell", radius: 40, count: 1200, size: 0.08, color: "#ffffff", opacity: 0.7 },
        ],
        post: { bloom: 0.8, vignette: 0.4 },
      };
    }
    case "cardStack": {
      const images = list<string>(p, "images");
      const layout = str(p, "layout", "fan");
      const n = Math.max(1, images.length || 3);
      const cards: Object3[] = Array.from({ length: n }, (_, i) => {
        const k = i - (n - 1) / 2;
        const asset = images[i];
        const place: { position: Vec3; rotation: Vec3 } =
          layout === "stack"
            ? { position: [0, 0, -i * 0.5], rotation: [0, 0, 0] }
            : layout === "carousel"
              ? { position: [Math.sin((i / n) * Math.PI * 2) * 3, 0, Math.cos((i / n) * Math.PI * 2) * 3], rotation: [0, (i / n) * 360, 0] }
              : { position: [k * 1.25, -Math.abs(k) * 0.12, -Math.abs(k) * 0.3], rotation: [0, -k * 14, -k * 6] };
        return asset
          ? { id: `card${i}`, kind: "image", asset, height: 3.2, cornerRadius: 0.16, ...place }
          : { id: `card${i}`, kind: "box", width: 2, height: 3.2, depth: 0.06, radius: 0.12, material: "plastic", color: i % 2 ? "brand.accent" : "brand.primary", ...place };
      });
      return {
        background: mood(p).bg,
        environment: "studio",
        camera: { position: [0, 0.3, 8.5], fov: 34, move: { type: layout === "carousel" ? "orbit" : "dolly", amount: layout === "carousel" ? 50 : 0.12 } },
        lights: LIGHTS(),
        objects: [{ id: "cards", kind: "group", children: cards, animate: [{ preset: "rise", at: s + 0.2, duration: 1, stagger: 0.14 }, { preset: "float", at: s + 1.5, amount: 0.05 }] }],
        post: { bloom: 0.25, vignette: 0.3 },
      };
    }
    case "voxelCity": {
      const size = Math.min(40, Math.max(4, num(p, "size", 14)));
      const palette = list<ColorRef>(p, "palette");
      return {
        background: { type: "linear", angle: 90, stops: [{ at: 0, color: "#1a1d3a" }, { at: 1, color: "#05060d" }] },
        environment: "night",
        fog: { color: "#05060d", near: 10, far: 30 },
        camera: {
          fov: 40,
          keyframes: { position: [{ t: s, v: [size * 1.15, size * 0.95, size * 1.15] }, { t: e, v: [size * 0.6, size * 0.38, size * 0.95], ease: "inOut" }] },
        },
        lights: [
          { type: "key", color: "#ffe2bf", intensity: 1.7, position: [8, 14, 6], shadow: true },
          { type: "rim", color: "brand.primary", intensity: 1.4, position: [-10, 6, -8] },
          { type: "hemisphere", color: "#9fb0ff", ground: "#1a1420", intensity: 0.9 },
        ],
        objects: [
          {
            id: "city", kind: "instances", of: "box", layout: "city", rows: size, cols: size, gap: 0.12,
            colors: palette.length ? palette : ["#4a5488", "#5b67a3", "#3a4372", "#6f7cc0", "#4a5488", "#5b67a3", "brand.primary", "brand.accent"],
            material: "clay", position: [-size / 2, 0, -size / 2],
            animate: [{ preset: "grow", at: s + 0.1, duration: 0.9, stagger: Math.min(0.012, 2 / (size * size)) }],
          } as Object3,
          { id: "floor", kind: "ground", position: [0, 0, 0], color: "#0b0d18" },
        ],
        post: { bloom: 0.35, vignette: 0.4 },
      };
    }
    case "kineticType3D": {
      const lines = list<string>(p, "lines").length ? list<string>(p, "lines") : [str(p, "text", "Rafiq")];
      const style = str(p, "style", "stack");
      const step = Math.min(1, (d * 0.6) / lines.length);
      const objects: Object3[] = lines.map((line, i) => ({
        id: `line${i}`, kind: "text3d", text: line, size: 0.9, depth: 0.22, bevel: 0.02, material, ...tint, split: "words", fit: true,
        position: style === "tunnel" ? [0, 0, -i * 6] : style === "wave" ? [0, (lines.length / 2 - i - 0.5) * 1.3, 0] : [0, (lines.length / 2 - i - 0.5) * 1.25, 0],
        animate: [{ preset: style === "wave" ? "flip" : "rise", at: s + 0.2 + i * step, duration: 0.9, stagger: 0.08 } as Anim3],
      }));
      return {
        background: mood(p).bg,
        environment: "studio",
        camera:
          style === "tunnel"
            ? { position: [0, 0.2, 6], fov: 40, keyframes: { position: [{ t: s, v: [0, 0.2, 6] }, { t: e, v: [0, 0.2, 6 - lines.length * 6 + 4], ease: "inOut" }] } }
            : { position: [0, 0, 8.5], fov: 34, move: { type: "orbit", amount: 18, ease: "inOut" } },
        lights: LIGHTS(),
        objects,
        post: { bloom: 0.45, vignette: 0.35 },
      };
    }
    case "chromeBlob": {
      const colors = list<ColorRef>(p, "colors");
      return {
        background: { type: "radial", stops: [{ at: 0, color: colors[0] ?? "#1d2a4a" }, { at: 1, color: colors[1] ?? "#05060c" }] },
        environment: { preset: "studio", intensity: 0.75 },
        camera: { position: [0, 0, 6.5], fov: 32, move: { type: "orbit", amount: 25 } },
        lights: LIGHTS(),
        objects: [
          {
            id: "blob", kind: "blob", radius: 1.3, noise: num(p, "noise", 0.22), speed: num(p, "speed", 0.5), material, ...tint,
            animate: [{ preset: "pop", at: s + 0.1, duration: 1.2 }, { preset: "float", at: s + 1.2, amount: 0.1 }],
          },
        ],
        post: { bloom: 0.15, vignette: 0.35 },
      };
    }
    case "bars3D": {
      const data = (p.data as { values?: number[]; labels?: string[] } | undefined) ?? {};
      const values = data.values?.length ? data.values : [3, 5, 4, 8, 6];
      const max = Math.max(...values.map(Math.abs), 1e-6);
      const n = values.length;
      const objects: Object3[] = values.map((v, i) => ({
        id: `bar${i}`, kind: "box", width: 0.7, depth: 0.7, height: (Math.abs(v) / max) * 3.2, radius: 0.08, pivot: "bottom",
        position: [(i - (n - 1) / 2) * 1.05, -1.4, 0], material: (str(p, "material", "plastic") as Material3Name), color: i === values.indexOf(Math.max(...values)) ? "brand.primary" : str(p, "color", "brand.accent"),
        animate: [{ preset: "grow", at: s + 0.3 + i * 0.12, duration: 1.1 }],
      }));
      (data.labels ?? []).slice(0, n).forEach((label, i) =>
        objects.push({ id: `label${i}`, kind: "text3d", text: String(label), size: 0.28, depth: 0.04, material: "matte", color: "brand.muted", position: [(i - (n - 1) / 2) * 1.05, -1.75, 0.4], animate: [{ preset: "fadeIn", at: s + 0.5 + i * 0.12 }] }),
      );
      return {
        background: mood(p, "studio").bg,
        environment: "studio",
        camera: { position: [0, 1.2, 8.2], target: [0, 0, 0], fov: 34, move: { type: "orbit", amount: 24 } },
        lights: LIGHTS(),
        objects: [...objects, { id: "floor", kind: "ground", position: [0, -1.4, 0], opacity: 0.4 }],
        post: { bloom: 0.25, vignette: 0.3 },
      };
    }
    case "physicsDrop": {
      const colors = list<ColorRef>(p, "colors");
      return {
        background: mood(p, "studio").bg,
        environment: "studio",
        camera: { position: [0, 2.2, 9], target: [0, 0, 0], fov: 36, move: { type: "dolly", amount: 0.1 } },
        lights: LIGHTS(),
        objects: [
          {
            id: "pieces", kind: "instances", of: (str(p, "of", "icosahedron") as Object3["of"]), layout: "random", count: num(p, "count", 26), size: 0.55,
            width: 6, height: 0.6, depth: 3, position: [0, -0.9, 0], material, colors: colors.length ? colors : ["brand.primary", "brand.accent", "#ffffff"],
            animate: [{ preset: "drop", at: s + 0.1, duration: 1.3, amount: 6, stagger: 0.06 }],
          },
          { id: "floor", kind: "ground", position: [0, -1.2, 0], opacity: 0.45 },
        ],
        post: { bloom: 0.3, vignette: 0.3 },
      };
    }
  }
}

/** The layer's scene with its recipe expanded and its own fields on top. */
export function expandScene3D(spec: Scene3D | undefined, start: number, end: number): Scene3D {
  const own = spec ?? {};
  if (!own.recipe || !RECIPES.includes(own.recipe)) return own;
  const base = build(own.recipe, own.params ?? {}, start, end);
  return {
    ...base,
    ...Object.fromEntries(Object.entries(own).filter(([k, v]) => v !== undefined && k !== "objects" && k !== "recipe" && k !== "params" && k !== "camera" && k !== "post")),
    camera: own.camera ? { ...base.camera, ...own.camera } : base.camera,
    post: own.post ? { ...base.post, ...own.post } : base.post,
    objects: [...(base.objects ?? []), ...(own.objects ?? [])],
  };
}
