/**
 * Ready-made 3D things — trees, rocks, mountains, clouds, buildings, a whole city, houses,
 * street lamps, cars, people, roads, water — so a scene can say `{ "kind": "tree" }` instead
 * of hand-stacking cylinders and boxes. Each one expands here, before the scene is built,
 * into a `group` of the engine's own pieces (rounded boxes, low-poly rocks, prisms, domes,
 * windowed façades), so materials, shadows and every `animate` preset work on them as on
 * anything else: a group's children are its parts, so `rise` with a `stagger` raises a
 * city one building at a time.
 *
 * Everything stands on its base (y 0 is the ground under it) and comes out the same for the
 * same seed, frame after frame and render after render.
 */

import type { ColorRef, Material3, Material3Name, Object3, Vec3 } from "../types";
import { hashString, noise3, seeded } from "./timeline";

/** The kinds this file turns into groups. */
export const PROPS = new Set([
  "tree", "bush", "flower", "cloud", "building", "city", "house", "streetLamp", "car", "person", "road", "water", "fence", "bench",
]);

type Rnd = () => number;

const pick = <T,>(rnd: Rnd, list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length];
const between = (rnd: Rnd, a: number, b: number) => a + (b - a) * rnd();
/** A hex colour mixed towards white by `k` (0–1): trim a shade lighter than its wall. Brand
 *  colour names pass through. */
function lighter(color: ColorRef, k: number): ColorRef {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const mix = (i: number) => Math.round(parseInt(color.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** A prop's own material for a part, unless the prop asked for one look for all of it
 *  (a clay town, a gold tree). Glowing parts — lamps, lit windows — keep glowing. */
function look(o: Object3, own: Material3Name | Material3, color: ColorRef, glows = false): Pick<Object3, "material" | "color"> {
  if (glows || !o.material) return { material: own, color };
  return { material: o.material, color };
}

function group(o: Object3, children: Object3[]): Object3 {
  const { id, name, position, rotation, scale, animate, keyframes, opacity, shadow } = o;
  return { id, name, kind: "group", position, rotation, scale, animate, keyframes, opacity, shadow, children };
}

const part = (o: Object3, suffix: string, rest: Omit<Object3, "id">): Object3 => ({ id: `${o.id ?? o.kind}.${suffix}`, shadow: o.shadow, ...rest });

// ── Nature ────────────────────────────────────────────────────────────────────────────

const GREENS = ["#4e8f3a", "#5fa046", "#3f7a33", "#6aa84f"];
const AUTUMN = ["#d9822b", "#c8562b", "#e3a53a", "#b5452a"];
const BARK = "#6b4a30";

function tree(o: Object3, rnd: Rnd): Object3 {
  const h = o.height ?? (o.size ?? 1) * 2.2;
  const variant = o.variant ?? "round";
  const leaves = o.colors?.length ? o.colors : variant === "autumn" ? AUTUMN : GREENS;
  const leaf = (i: number) => o.color ?? leaves[i % leaves.length];
  const kids: Object3[] = [];
  if (variant === "pine") {
    kids.push(part(o, "trunk", { kind: "cylinder", radius: h * 0.045, height: h * 0.3, pivot: "bottom", ...look(o, "matte", BARK) }));
    for (let i = 0; i < 3; i++) {
      const r = h * (0.3 - i * 0.07);
      kids.push(part(o, `tier${i}`, { kind: "cone", radius: r, height: h * 0.42, pivot: "bottom", position: [0, h * (0.2 + i * 0.22), 0], rotation: [0, rnd() * 60, 0], ...look(o, { preset: "matte", flat: true }, o.color ?? leaves[2 % leaves.length]) }));
    }
  } else if (variant === "palm") {
    // a trunk leaning a little more with every segment, fronds drooping from the top
    const segs = 7;
    const lean = between(rnd, 4, 9);
    let x = 0;
    let y = 0;
    for (let i = 0; i < segs; i++) {
      const len = (h * 0.8) / segs;
      const angle = lean * (i / segs) * 1.6;
      kids.push(part(o, `trunk${i}`, { kind: "cylinder", radius: h * (0.045 - i * 0.003), height: len * 1.05, pivot: "bottom", position: [x, y, 0], rotation: [0, 0, -angle], ...look(o, "matte", i % 2 ? "#8a6a45" : "#7a5b3a") }));
      x += Math.sin((angle * Math.PI) / 180) * len;
      y += Math.cos((angle * Math.PI) / 180) * len;
    }
    const fronds = 8;
    for (let i = 0; i < fronds; i++) {
      const yaw = (360 / fronds) * i + rnd() * 20;
      kids.push(part(o, `frond${i}`, {
        kind: "group", position: [x, y, 0], rotation: [0, yaw, 0],
        children: [part(o, `frond${i}.leaf`, { kind: "box", width: h * 0.1, height: h * 0.012, depth: h * 0.5, radius: h * 0.005, position: [0, -h * 0.07, h * 0.22], rotation: [-28 - rnd() * 12, 0, 0], ...look(o, { preset: "matte", flat: true }, leaf(i)) })],
      }));
    }
    kids.push(part(o, "nuts", { kind: "sphere", radius: h * 0.05, position: [x, y - h * 0.03, 0], ...look(o, "matte", "#5a3d22") }));
  } else {
    // round (and autumn): a trunk, then a crown of low-poly lumps
    kids.push(part(o, "trunk", { kind: "cylinder", radius: h * 0.055, height: h * 0.5, pivot: "bottom", ...look(o, "matte", BARK) }));
    const lumps = 4;
    kids.push(part(o, "crown", { kind: "rock", radius: h * 0.3, noise: 0.18, position: [0, h * 0.68, 0], ...look(o, { preset: "matte", flat: true }, leaf(0)) }));
    for (let i = 0; i < lumps; i++) {
      const a = (i / lumps) * Math.PI * 2 + rnd();
      kids.push(part(o, `lump${i}`, { kind: "rock", radius: h * between(rnd, 0.16, 0.22), noise: 0.2, position: [Math.cos(a) * h * 0.2, h * between(rnd, 0.58, 0.8), Math.sin(a) * h * 0.2], ...look(o, { preset: "matte", flat: true }, leaf(i + 1)) }));
    }
  }
  return group(o, kids);
}

function bush(o: Object3, rnd: Rnd): Object3 {
  const s = o.size ?? 0.8;
  const leaves = o.colors?.length ? o.colors : GREENS;
  const kids: Object3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    kids.push(part(o, `lump${i}`, { kind: "rock", radius: s * between(rnd, 0.32, 0.45), noise: 0.2, position: [Math.cos(a) * s * 0.25, s * 0.3, Math.sin(a) * s * 0.25], ...look(o, { preset: "matte", flat: true }, o.color ?? leaves[i % leaves.length]) }));
  }
  return group(o, kids);
}

function flower(o: Object3, rnd: Rnd): Object3 {
  const h = o.height ?? 0.6;
  const petal = o.color ?? pick(rnd, ["#ff6b8a", "#ffd23f", "#b388ff", "#ff8c42", "#ffffff"]);
  const kids: Object3[] = [
    part(o, "stem", { kind: "cylinder", radius: h * 0.025, height: h, pivot: "bottom", ...look(o, "matte", "#4e8f3a") }),
    part(o, "heart", { kind: "sphere", radius: h * 0.08, position: [0, h, 0], ...look(o, "matte", "#ffcc33") }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kids.push(part(o, `petal${i}`, { kind: "sphere", radius: h * 0.09, scale: [1.4, 0.35, 0.8], position: [Math.cos(a) * h * 0.13, h, Math.sin(a) * h * 0.13], rotation: [0, (-a * 180) / Math.PI, 0], ...look(o, "plastic", petal) }));
  }
  return group(o, kids);
}

function cloud(o: Object3, rnd: Rnd): Object3 {
  const s = o.size ?? 1.6;
  const kids: Object3[] = [];
  const puffs = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < puffs; i++) {
    const x = (i / (puffs - 1) - 0.5) * s * 1.6;
    const r = s * (0.32 + 0.28 * Math.sin((i / (puffs - 1)) * Math.PI)) * between(rnd, 0.85, 1.1);
    kids.push(part(o, `puff${i}`, { kind: "sphere", radius: r, position: [x, r * 0.55, between(rnd, -0.15, 0.15) * s], ...look(o, { preset: "matte", roughness: 1 }, o.color ?? "#ffffff") }));
  }
  return group(o, kids);
}

// ── Buildings and the city ─────────────────────────────────────────────────────────────

/** Façade colours: concrete and stone for the windowed kinds, glass tints for the glazed. */
const CONCRETE = ["#cbc6ba", "#b6b1a6", "#d9d4c9", "#a19e95", "#aaa59b", "#c2b8a6", "#8f8f8a"];
const GLASS = ["#4f6f8f", "#5b7f99", "#3f5f7a", "#6f8fa8", "#2f4f6a", "#7f9fb5", "#45706f", "#6e6a58", "#8a95a0", "#3a4a5e"];

type BuildingVariant = "tower" | "glass" | "classic" | "setback" | "spire" | "residential";
const VARIANTS: BuildingVariant[] = ["tower", "glass", "classic", "setback", "spire", "residential"];
export const FORMS = ["box", "slab", "round", "tapered", "twisted", "stepped", "triangle", "lshape"] as const;
export const TOPS = ["flat", "spire", "pyramid", "gable", "dome", "crown", "helipad", "antenna"] as const;
export const FACADE_STYLES = ["grid", "bands", "fins", "curtain", "diagrid"] as const;
type Form = (typeof FORMS)[number];
type Top = (typeof TOPS)[number];
type FacadeStyle = (typeof FACADE_STYLES)[number];

/** What a `variant` means when the form, the top or the façade isn't given. */
const VARIANT_LOOK: Record<BuildingVariant, { form: Form; top: Top; facade: FacadeStyle }> = {
  tower: { form: "box", top: "antenna", facade: "bands" },
  glass: { form: "box", top: "flat", facade: "curtain" },
  classic: { form: "box", top: "flat", facade: "grid" },
  setback: { form: "stepped", top: "flat", facade: "fins" },
  spire: { form: "box", top: "spire", facade: "curtain" },
  residential: { form: "box", top: "flat", facade: "grid" },
};

const SQRT2 = Math.SQRT2;

function building(o: Object3, rnd: Rnd): Object3 {
  const variant = (VARIANTS.includes(o.variant as BuildingVariant) ? o.variant : "tower") as BuildingVariant;
  const base = VARIANT_LOOK[variant];
  const form = (FORMS.includes(o.form as Form) ? o.form : base.form) as Form;
  const win = typeof o.windows === "object" ? o.windows : {};
  const style = (FACADE_STYLES.includes(win.style as FacadeStyle) ? win.style : base.facade) as FacadeStyle;
  const top = (TOPS.includes(o.top as Top) ? o.top : base.top) as Top;
  const w = o.width ?? o.size ?? 1.2;
  const d = form === "slab" ? (o.depth ?? w * 0.42) : (o.depth ?? w);
  const h = o.height ?? 4;
  const floorH = h / Math.max(1, o.floors ?? Math.round(h / 0.24));
  const glazed = style === "curtain" || style === "bands" || style === "diagrid";
  const facade = o.color ?? (glazed ? pick(rnd, GLASS) : pick(rnd, o.colors?.length ? o.colors : CONCRETE));
  const windows = o.windows === false ? undefined : { lit: 0.35, ...win, style };
  // glass reflects the sky (needs an environment); concrete and stone stay matte
  const skin: Material3 = glazed ? { preset: "metal", metalness: 0.55, roughness: 0.12 } : { preset: "matte", roughness: 0.85 };
  const trim = lighter(facade, 0.3);
  const kids: Object3[] = [];

  // a podium: a wider, lower base the tower stands on
  let y0 = 0;
  const podiumFloors = o.podium === true ? 3 : typeof o.podium === "number" ? Math.max(1, Math.round(o.podium)) : 0;
  if (podiumFloors && h > floorH * (podiumFloors + 3)) {
    const ph = floorH * podiumFloors * 1.3;
    kids.push(part(o, "podium", { kind: "box", width: w * 1.45, height: ph, depth: d * 1.45, radius: 0.02, pivot: "bottom", floors: podiumFloors, windows: windows && { ...windows, style: "grid" }, ...look(o, { preset: "matte", roughness: 0.7 }, lighter(facade, 0.12)) }));
    kids.push(part(o, "podiumRoof", { kind: "box", width: w * 1.47, height: floorH * 0.3, depth: d * 1.47, radius: 0.01, pivot: "bottom", position: [0, ph, 0], ...look(o, "matte", trim) }));
    y0 = ph + floorH * 0.3;
  }
  const bh = h - y0;
  const floorsOf = (height: number) => Math.max(1, Math.round(height / floorH));
  const box = (id: string, bw: number, height: number, bd: number, y: number, extra: Partial<Object3> = {}): Object3 =>
    part(o, id, { kind: "box", width: bw, height, depth: bd, radius: Math.min(bw, bd) * 0.02, pivot: "bottom", position: [0, y, 0], floors: floorsOf(height), windows, ...look(o, skin, facade), ...extra });
  // the top's footprint, for the roof
  let topY = h;
  let topW = w;
  let topD = d;
  let round = false;
  switch (form) {
    case "round": {
      kids.push(part(o, "body", { kind: "cylinder", radius: Math.min(w, d) / 2, height: bh, pivot: "bottom", position: [0, y0, 0], floors: floorsOf(bh), windows, ...look(o, skin, facade) }));
      round = true;
      topW = topD = Math.min(w, d);
      break;
    }
    case "triangle": {
      kids.push(part(o, "body", { kind: "cylinder", sides: 3, radius: w * 0.62, height: bh, pivot: "bottom", position: [0, y0, 0], floors: floorsOf(bh), windows, ...look(o, skin, facade) }));
      topW = topD = w * 0.6;
      break;
    }
    case "tapered": {
      // a square tower narrowing as it rises (a four-sided frustum, its faces square to the axes)
      const taper = Math.max(0, Math.min(0.85, o.taper ?? 0.35));
      const r = Math.min(w, d) / SQRT2;
      kids.push(part(o, "body", { kind: "cylinder", sides: 4, radius: r, radiusTop: r * (1 - taper), height: bh, pivot: "bottom", position: [0, y0, 0], rotation: [0, 45, 0], floors: floorsOf(bh), windows, ...look(o, skin, facade) }));
      topW = topD = Math.min(w, d) * (1 - taper);
      break;
    }
    case "twisted": {
      // slices, each turned a little more than the one under it
      const slices = Math.max(6, Math.min(24, Math.round(bh / (floorH * 3))));
      const twist = o.twist ?? 90;
      const sh = bh / slices;
      for (let i = 0; i < slices; i++) {
        kids.push(box(`slice${i}`, w, sh * 1.002, d, y0 + i * sh, { rotation: [0, (twist * i) / slices, 0], radius: Math.min(w, d) * 0.06 }));
      }
      break;
    }
    case "stepped": {
      // art deco: three tiers, each narrower, a ledge between
      const tiers = [0.55, 0.28, 0.17];
      let y = y0;
      tiers.forEach((share, i) => {
        const k = 1 - i * 0.22;
        kids.push(box(`tier${i}`, w * k, bh * share, d * k, y));
        kids.push(part(o, `ledge${i}`, { kind: "box", width: w * k * 1.04, height: floorH * 0.35, depth: d * k * 1.04, radius: 0.01, pivot: "bottom", position: [0, y + bh * share, 0], ...look(o, "matte", trim) }));
        y += bh * share;
        topW = w * k;
        topD = d * k;
      });
      topY = y;
      break;
    }
    case "lshape": {
      // a main block and a lower wing at its side
      kids.push(box("body", w * 0.6, bh, d, y0, { position: [-w * 0.2, y0, 0] }));
      kids.push(box("wing", w * 0.4, bh * between(rnd, 0.45, 0.7), d * 0.55, y0, { position: [w * 0.3, y0, d * 0.225] }));
      topW = w * 0.6;
      break;
    }
    default:
      kids.push(box("body", w, bh, d, y0));
      if (variant === "classic" || variant === "residential") {
        kids.push(part(o, "cornice", { kind: "box", width: w * 1.06, height: floorH * 0.4, depth: d * 1.06, radius: 0.01, pivot: "bottom", position: [0, h, 0], ...look(o, "matte", trim) }));
        topY = h + floorH * 0.4;
      }
  }
  const at = (x: number, y: number, z: number): Vec3 => [form === "lshape" ? x - w * 0.2 : x, y, z];
  const span = Math.min(topW, topD);
  switch (top) {
    case "spire":
      kids.push(part(o, "crown", { kind: round ? "cylinder" : "box", width: topW * 0.55, depth: topD * 0.55, radius: round ? span * 0.28 : 0.02, height: floorH * 0.6, pivot: "bottom", position: at(0, topY, 0), ...look(o, "matte", trim) }));
      kids.push(part(o, "spire", { kind: "cone", radius: span * 0.12, height: h * 0.2, pivot: "bottom", position: at(0, topY + floorH * 0.6, 0), ...look(o, "metal", "#aeb4bd") }));
      kids.push(part(o, "tip", { kind: "sphere", radius: 0.035, position: at(0, topY + floorH * 0.6 + h * 0.2, 0), ...look(o, "glow", "#ff3b3b", true) }));
      break;
    case "pyramid":
      kids.push(part(o, "roof", round
        ? { kind: "cone", radius: span / 2, height: span * 0.6, pivot: "bottom", position: at(0, topY, 0), ...look(o, skin, facade) }
        : { kind: "cone", sides: 4, radius: span / SQRT2, height: span * 0.6, pivot: "bottom", rotation: [0, 45, 0], position: at(0, topY, 0), ...look(o, skin, facade) }));
      break;
    case "gable":
      kids.push(part(o, "roof", { kind: "prism", sides: 3, radius: 0.5, width: topW, pivot: "bottom", position: at(0, topY, 0), scale: [1, (span * 0.45) / 0.75, topD / 0.866], ...look(o, { preset: "matte", flat: true }, "#5a4a42") }));
      break;
    case "dome":
      kids.push(part(o, "roof", { kind: "dome", radius: span * 0.45, position: at(0, topY, 0), ...look(o, "metal", lighter(facade, 0.2)) }));
      break;
    case "crown":
      // a band of light round the top, then a cap
      kids.push(part(o, "crownLight", { kind: round ? "cylinder" : "box", width: topW * 1.01, depth: topD * 1.01, radius: round ? span * 0.505 : 0.01, height: floorH * 1.2, pivot: "bottom", position: at(0, topY - floorH * 1.4, 0), shadow: false, ...look(o, "glow", win.light ?? "#bfe3ff", true) }));
      kids.push(part(o, "cap", { kind: round ? "cylinder" : "box", width: topW * 1.03, depth: topD * 1.03, radius: round ? span * 0.515 : 0.01, height: floorH * 0.5, pivot: "bottom", position: at(0, topY, 0), ...look(o, "metal", trim) }));
      break;
    case "helipad":
      kids.push(part(o, "pad", { kind: "cylinder", radius: span * 0.42, height: floorH * 0.25, pivot: "bottom", position: at(0, topY + floorH * 0.4, 0), ...look(o, "matte", "#3a3d42") }));
      kids.push(part(o, "padRing", { kind: "torus", radius: span * 0.36, thickness: 0.012, rotation: [90, 0, 0], position: at(0, topY + floorH * 0.66, 0), shadow: false, ...look(o, "glow", "#ffd23f", true) }));
      break;
    case "antenna":
      kids.push(part(o, "plant", { kind: "box", width: topW * 0.45, height: floorH * 0.9, depth: topD * 0.4, radius: 0.02, pivot: "bottom", position: at(topW * 0.1, topY, -topD * 0.1), ...look(o, "matte", "#9aa1ab") }));
      kids.push(part(o, "mast", { kind: "cylinder", radius: 0.016, height: h * 0.14, pivot: "bottom", position: at(-topW * 0.18, topY, topD * 0.16), ...look(o, "metal", "#b9bec6") }));
      kids.push(part(o, "beacon", { kind: "sphere", radius: 0.032, position: at(-topW * 0.18, topY + h * 0.14, topD * 0.16), ...look(o, "glow", "#ff4a3d", true) }));
      break;
    default:
      if (!round && form !== "triangle") {
        kids.push(part(o, "plant", { kind: "box", width: topW * 0.4, height: floorH * 0.8, depth: topD * 0.35, radius: 0.02, pivot: "bottom", position: at(topW * 0.12, topY, -topD * 0.12), ...look(o, "matte", "#8f969f") }));
        if (h < 3 && rnd() < 0.5) kids.push(part(o, "tank", { kind: "cylinder", radius: topW * 0.11, height: floorH * 1.2, pivot: "bottom", position: at(-topW * 0.22, topY, topD * 0.2), ...look(o, "matte", "#7d5a3c") }));
      }
  }
  return group(o, kids);
}

/** One lot of a generated skyline: every tower its own form, top, façade and colour. */
function skylineTower(rnd: Rnd, h: number, tallest: number, lot: number, o: Object3): Partial<Object3> {
  if (o.variant && VARIANTS.includes(o.variant as BuildingVariant)) return { variant: o.variant };
  const share = h / tallest;
  const form: Form = share > 0.75
    ? pick(rnd, ["tapered", "twisted", "round", "box", "stepped", "triangle", "box"] as const)
    : share > 0.35
      ? pick(rnd, ["box", "box", "slab", "round", "lshape", "tapered", "box", "stepped"] as const)
      : pick(rnd, ["box", "box", "lshape", "slab"] as const);
  const top: Top = share > 0.75
    ? pick(rnd, ["spire", "crown", "pyramid", "antenna", "helipad", "flat"] as const)
    : share > 0.35
      ? pick(rnd, ["flat", "antenna", "crown", "flat", "flat", "helipad"] as const)
      : pick(rnd, ["flat", "flat", "antenna"] as const);
  const style: FacadeStyle = share > 0.5
    ? pick(rnd, ["curtain", "curtain", "bands", "fins", "diagrid"] as const)
    : pick(rnd, ["grid", "grid", "bands", "fins", "curtain"] as const);
  return {
    variant: share < 0.3 ? "residential" : "tower",
    form, top,
    podium: share > 0.45 && rnd() < 0.45,
    taper: between(rnd, 0.2, 0.5),
    twist: pick(rnd, [60, 90, 120]),
    width: lot * (form === "round" || form === "tapered" ? between(rnd, 0.6, 0.8) : between(rnd, 0.6, 0.9)),
    windows: { lit: 0.35, ...(typeof o.windows === "object" ? o.windows : {}), style },
  };
}

/** A whole downtown: blocks of towers, tallest in the middle, with streets between. */
function city(o: Object3, rnd: Rnd, seed: number): Object3 {
  const rows = Math.max(1, Math.min(16, o.rows ?? 7));
  const cols = Math.max(1, Math.min(16, o.cols ?? 7));
  const lot = o.size ?? 1.6;
  const street = (o.gap ?? 0.45) * lot;
  const tallest = o.height ?? 7;
  const step = lot + street;
  const kids: Object3[] = [];
  const cx = ((cols - 1) * step) / 2;
  const cz = ((rows - 1) * step) / 2;
  const reach = Math.hypot(cx, cz) || 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * step - cx;
      const z = r * step - cz;
      // tall towards the centre, with noise so the skyline isn't a cone, and now and then a
      // landmark well above its neighbours
      const centre = 1 - Math.min(1, Math.hypot(x, z) / reach);
      const n = (noise3(c * 0.35, r * 0.35, (seed % 997) * 0.01) + 1) / 2;
      const landmark = rnd() < 0.06 ? 1.5 : 1;
      const h = Math.min(tallest, Math.max(0.6, tallest * (0.1 + 0.9 * Math.pow(centre, 1.5)) * (0.45 + 0.7 * n) * between(rnd, 0.75, 1.15) * landmark));
      const look3 = skylineTower(rnd, h, tallest, lot, o);
      kids.push(building({
        id: `${o.id ?? "city"}.b${r}_${c}`, kind: "building", height: h, depth: lot * between(rnd, 0.6, 0.9),
        position: [x + between(rnd, -0.08, 0.08) * lot, 0, z + between(rnd, -0.08, 0.08) * lot], rotation: [0, pick(rnd, [0, 0, 0, 90, 15, -10]), 0],
        colors: o.colors, material: o.material, shadow: o.shadow, ...look3,
        ...(o.windows === false ? { windows: false } : {}),
      }, rnd));
    }
  }
  const children: Object3[] = [...kids];
  if (o.roads !== false) {
    const w = cols * step + street;
    const dpt = rows * step + street;
    children.unshift(part(o, "asphalt", { kind: "box", width: w, height: 0.02, depth: dpt, radius: 0, pivot: "bottom", position: [0, -0.02, 0], ...look(o, "matte", "#2b2e33") }));
    // pavements: a raised plate under each lot
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        children.unshift(part(o, `kerb${r}_${c}`, { kind: "box", width: lot * 1.02, height: 0.04, depth: lot * 1.02, radius: 0.02, pivot: "bottom", position: [c * step - cx, -0.02, r * step - cz], shadow: false, ...look(o, "matte", "#4d525b") }));
      }
    }
    // lane markings down the middle of every street
    for (let c = 0; c <= cols; c++) {
      const x = c * step - cx - step / 2;
      children.unshift(part(o, `laneX${c}`, { kind: "box", width: 0.035, height: 0.005, depth: dpt * 0.96, radius: 0, pivot: "bottom", position: [x, 0.001, 0], shadow: false, ...look(o, "matte", "#cfcab0") }));
    }
    for (let r = 0; r <= rows; r++) {
      const z = r * step - cz - step / 2;
      children.unshift(part(o, `laneZ${r}`, { kind: "box", width: w * 0.96, height: 0.005, depth: 0.035, radius: 0, pivot: "bottom", position: [0, 0.001, z], shadow: false, ...look(o, "matte", "#cfcab0") }));
    }
  }
  if (o.trees) {
    const every = typeof o.trees === "number" ? Math.max(1, Math.round(o.trees)) : 2;
    let n = 0;
    for (let r = 0; r <= rows; r += 1) {
      for (let c = 0; c < cols; c++) {
        if (n++ % every) continue;
        const x = c * step - cx;
        const z = r * step - cz - step / 2;
        children.push(tree({ id: `${o.id ?? "city"}.t${r}_${c}`, kind: "tree", height: lot * 0.45, position: [x + lot * 0.3, 0, z + street * 0.3], material: o.material, shadow: o.shadow }, rnd));
      }
    }
  }
  // the buildings are the parts a stagger walks through; the streets come first, all at once
  return { ...group(o, children), children: [part(o, "streets", { kind: "group", children: children.filter((k) => !kids.includes(k)) }), ...kids] };
}

function house(o: Object3, rnd: Rnd): Object3 {
  const w = o.width ?? o.size ?? 1.4;
  const d = o.depth ?? w * 0.9;
  const h = o.height ?? w * 0.75;
  const wall = o.color ?? pick(rnd, ["#f1e6d2", "#e8d9c4", "#dfe7ee", "#f4efe8", "#e9d3c0"]);
  const roof = o.colors?.[0] ?? pick(rnd, ["#a8432f", "#7c3f2b", "#4d5563", "#8a5a3c"]);
  const roofH = h * 0.55;
  return group(o, [
    part(o, "walls", { kind: "box", width: w, height: h, depth: d, radius: 0.02, pivot: "bottom", ...look(o, "matte", wall) }),
    // a prism of radius 0.5 is 0.75 tall and 0.866 wide: stretched to the roof's size
    part(o, "roof", { kind: "prism", sides: 3, radius: 0.5, width: w * 1.1, pivot: "bottom", position: [0, h, 0], scale: [1, roofH / 0.75, (d * 1.12) / 0.866], ...look(o, { preset: "matte", flat: true }, roof) }),
    part(o, "door", { kind: "box", width: w * 0.18, height: h * 0.55, depth: 0.03, radius: 0.01, pivot: "bottom", position: [0, 0, d / 2 + 0.01], ...look(o, "matte", "#5b3b26") }),
    part(o, "windowL", { kind: "box", width: w * 0.18, height: h * 0.25, depth: 0.03, radius: 0.01, position: [-w * 0.3, h * 0.58, d / 2 + 0.01], ...look(o, { preset: "plastic", emissive: "#ffd28a", emissiveIntensity: 0.6 }, "#9fc3e0", true) }),
    part(o, "windowR", { kind: "box", width: w * 0.18, height: h * 0.25, depth: 0.03, radius: 0.01, position: [w * 0.3, h * 0.58, d / 2 + 0.01], ...look(o, { preset: "plastic", emissive: "#ffd28a", emissiveIntensity: 0.6 }, "#9fc3e0", true) }),
    part(o, "chimney", { kind: "box", width: w * 0.12, height: roofH * 0.8, depth: w * 0.12, radius: 0.01, pivot: "bottom", position: [w * 0.25, h + roofH * 0.25, -d * 0.15], ...look(o, "matte", "#8b5a44") }),
  ]);
}

// ── Street things ──────────────────────────────────────────────────────────────────────

function streetLamp(o: Object3): Object3 {
  const h = o.height ?? 1.6;
  const light = o.color ?? "#ffd9a0";
  return group(o, [
    part(o, "base", { kind: "cylinder", radius: h * 0.04, height: h * 0.06, pivot: "bottom", ...look(o, "metal", "#2f3338") }),
    part(o, "pole", { kind: "cylinder", radius: h * 0.016, height: h, pivot: "bottom", ...look(o, "metal", "#2f3338") }),
    part(o, "arm", { kind: "box", width: h * 0.22, height: h * 0.02, depth: h * 0.03, radius: 0.004, position: [h * 0.1, h * 0.99, 0], ...look(o, "metal", "#2f3338") }),
    part(o, "head", { kind: "box", width: h * 0.1, height: h * 0.03, depth: h * 0.06, radius: 0.008, position: [h * 0.2, h * 0.975, 0], ...look(o, "glow", light, true) }),
  ]);
}

function car(o: Object3, rnd: Rnd): Object3 {
  const l = o.width ?? o.size ?? 1;
  const paint = o.color ?? pick(rnd, ["#d23b3b", "#2f6fd1", "#f2f2f2", "#1d1f24", "#f2b632", "#3aa36b"]);
  const kids: Object3[] = [
    part(o, "body", { kind: "box", width: l, height: l * 0.22, depth: l * 0.45, radius: l * 0.06, position: [0, l * 0.2, 0], ...look(o, { preset: "plastic", clearcoat: 1, roughness: 0.25 }, paint) }),
    part(o, "cabin", { kind: "box", width: l * 0.55, height: l * 0.18, depth: l * 0.4, radius: l * 0.06, position: [-l * 0.05, l * 0.36, 0], ...look(o, { preset: "glass", transmission: 0, roughness: 0.1, metalness: 0.4 }, "#22303f") }),
    part(o, "lightL", { kind: "box", width: 0.02, height: l * 0.04, depth: l * 0.08, radius: 0, position: [l * 0.5, l * 0.22, l * 0.14], ...look(o, "glow", "#fff4d6", true) }),
    part(o, "lightR", { kind: "box", width: 0.02, height: l * 0.04, depth: l * 0.08, radius: 0, position: [l * 0.5, l * 0.22, -l * 0.14], ...look(o, "glow", "#fff4d6", true) }),
  ];
  for (const [i, [x, z]] of ([[0.32, 0.22], [0.32, -0.22], [-0.32, 0.22], [-0.32, -0.22]] as const).entries()) {
    kids.push(part(o, `wheel${i}`, { kind: "cylinder", radius: l * 0.1, height: l * 0.06, rotation: [90, 0, 0], position: [x * l, l * 0.1, z * l], ...look(o, "rubber", "#141518") }));
  }
  return group(o, kids);
}

function person(o: Object3, rnd: Rnd): Object3 {
  const h = o.height ?? 0.9;
  const shirt = o.color ?? pick(rnd, ["#3d6fd6", "#d6533d", "#3aa36b", "#e0b33a", "#7a4fd6", "#2b2f36"]);
  return group(o, [
    part(o, "legs", { kind: "capsule", radius: h * 0.11, height: h * 0.35, position: [0, h * 0.28, 0], ...look(o, "matte", "#2c3440") }),
    part(o, "body", { kind: "capsule", radius: h * 0.16, height: h * 0.25, position: [0, h * 0.62, 0], ...look(o, "matte", shirt) }),
    part(o, "head", { kind: "sphere", radius: h * 0.1, position: [0, h * 0.92, 0], ...look(o, "matte", pick(rnd, ["#e7c3a0", "#c99a74", "#8d5f3e", "#f1d3b6"])) }),
  ]);
}

function road(o: Object3): Object3 {
  const len = o.depth ?? o.size ?? 10;
  const w = o.width ?? 1.4;
  const kids: Object3[] = [part(o, "asphalt", { kind: "box", width: w, height: 0.02, depth: len, radius: 0, pivot: "bottom", ...look(o, "matte", o.color ?? "#2b2e33") })];
  const dash = 0.5;
  for (let z = -len / 2 + dash; z < len / 2 - dash / 2; z += dash * 2) {
    kids.push(part(o, `dash${Math.round(z * 10)}`, { kind: "box", width: 0.05, height: 0.005, depth: dash, radius: 0, pivot: "bottom", position: [0, 0.02, z], shadow: false, ...look(o, "glow", "#f2edd2", true) }));
  }
  return group(o, kids);
}

function water(o: Object3): Object3 {
  return group(o, [
    part(o, "surface", { kind: "box", width: o.width ?? o.size ?? 12, height: 0.02, depth: o.depth ?? o.size ?? 12, radius: 0, pivot: "bottom", shadow: false, reflect: o.reflect ?? 0.7, ...look(o, { preset: "glass", transmission: 0, roughness: 0.06, metalness: 0.2, clearcoat: 1 }, o.color ?? "#2a6f9e") }),
  ]);
}

function fence(o: Object3): Object3 {
  const len = o.width ?? o.size ?? 3;
  const h = o.height ?? 0.5;
  const posts = Math.max(2, Math.round(len / 0.4));
  const wood = o.color ?? "#c9a57a";
  const kids: Object3[] = [
    part(o, "railTop", { kind: "box", width: len, height: h * 0.08, depth: h * 0.05, radius: 0.005, position: [0, h * 0.8, 0], ...look(o, "matte", wood) }),
    part(o, "railLow", { kind: "box", width: len, height: h * 0.08, depth: h * 0.05, radius: 0.005, position: [0, h * 0.35, 0], ...look(o, "matte", wood) }),
  ];
  for (let i = 0; i < posts; i++) {
    kids.push(part(o, `post${i}`, { kind: "box", width: h * 0.1, height: h, depth: h * 0.1, radius: 0.01, pivot: "bottom", position: [(i / (posts - 1) - 0.5) * len, 0, 0], ...look(o, "matte", wood) }));
  }
  return group(o, kids);
}

function bench(o: Object3): Object3 {
  const l = o.width ?? o.size ?? 1.2;
  const wood = o.color ?? "#a5743f";
  return group(o, [
    part(o, "seat", { kind: "box", width: l, height: l * 0.04, depth: l * 0.3, radius: 0.01, position: [0, l * 0.36, 0], ...look(o, "matte", wood) }),
    part(o, "back", { kind: "box", width: l, height: l * 0.22, depth: l * 0.04, radius: 0.01, position: [0, l * 0.55, -l * 0.14], rotation: [-10, 0, 0], ...look(o, "matte", wood) }),
    part(o, "legL", { kind: "box", width: l * 0.04, height: l * 0.36, depth: l * 0.3, radius: 0.005, pivot: "bottom", position: [-l * 0.42, 0, 0], ...look(o, "metal", "#30343a") }),
    part(o, "legR", { kind: "box", width: l * 0.04, height: l * 0.36, depth: l * 0.3, radius: 0.005, pivot: "bottom", position: [l * 0.42, 0, 0], ...look(o, "metal", "#30343a") }),
  ]);
}

// ── Expansion ──────────────────────────────────────────────────────────────────────────

function expandOne(o: Object3, layerSeed: number): Object3 {
  if (!PROPS.has(o.kind)) {
    return o.children?.length ? { ...o, children: o.children.map((c) => expandOne(c, layerSeed)) } : o;
  }
  const seed = (o.seed ?? layerSeed) ^ hashString(o.id ?? o.kind);
  const rnd = seeded(seed);
  switch (o.kind) {
    case "tree":
      return tree(o, rnd);
    case "bush":
      return bush(o, rnd);
    case "flower":
      return flower(o, rnd);
    case "cloud":
      return cloud(o, rnd);
    case "building":
      return building(o, rnd);
    case "city":
      return city(o, rnd, seed);
    case "house":
      return house(o, rnd);
    case "streetLamp":
      return streetLamp(o);
    case "car":
      return car(o, rnd);
    case "person":
      return person(o, rnd);
    case "road":
      return road(o);
    case "water":
      return water(o);
    case "fence":
      return fence(o);
    case "bench":
      return bench(o);
    default:
      return o;
  }
}

/** Every ready-made thing in the list (at any depth) as a group of plain pieces. */
export function expandProps(objects: Object3[], layerSeed: number): Object3[] {
  return objects.map((o) => expandOne(o, layerSeed));
}

