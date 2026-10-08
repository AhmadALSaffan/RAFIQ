/**
 * Presets and keyframes become one thing: per-property segments. A property's value at t
 * comes from the latest segment that has started ("the newest wins"); additive ones (shake,
 * float) and multiplicative ones (zoomPunch, kenBurns) ride on top. Expanded once per layer
 * and cached, so evaluating a frame is just lookups.
 */

import { easeFn, type EaseFn } from "./easing";
import { mixColor, resolveColor } from "./brand";
import type { AnimProp, Animation, BrandKit, Layer } from "./types";

export interface Segment {
  prop: AnimProp | "mask";
  t0: number;
  t1: number;
  /** undefined = whatever the property is at t0 (exits start from where things are). */
  from?: number | string;
  to: number | string;
  ease: EaseFn;
  mode?: "add" | "mul";
  /** add/mul segments: the offset as a function of local time u ∈ [0,1] and seconds since t0. */
  wave?: (u: number, s: number) => number;
}

export interface Reveal {
  t0: number;
  t1: number;
  unit: "chars" | "words" | "lines";
  style: "type" | "pop" | "line";
  ease: EaseFn;
  stagger: number;
}

export interface MaskSpec {
  t0: number;
  t1: number;
  dir: "start" | "end" | "up" | "down";
  soft: number;
  ease: EaseFn;
}

export interface LayerTracks {
  segments: Map<string, Segment[]>;
  reveal?: Reveal;
  masks: MaskSpec[];
}

export const BASE: Record<string, number> = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blur: 0, trim: 1, count: 0, cornerRadius: -1 };

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function isArabic(text: string): boolean {
  return ARABIC.test(text);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** How long a preset runs when the scene doesn't say. */
export function defaultDuration(a: Animation, layer: Layer, kit: BrandKit): number {
  const life = Math.max(0.1, layer.end - a.at);
  switch (a.preset) {
    case "fadeOut":
    case "slideOut":
    case "scaleOut":
      return kit.motion.exit;
    case "typewriter":
      return Math.min(4, Math.max(0.4, (layer.text ?? "").length * (isArabic(layer.text ?? "") ? 0.05 : 0.035)));
    case "wordPop":
      return Math.min(4, 0.3 + 0.12 * wordCount(layer.text ?? ""));
    case "lineReveal":
      return 0.8;
    case "countUp":
      return 1.2;
    case "drawOn":
      return 0.9;
    case "kenBurns":
    case "float":
    case "pulse":
      return life;
    case "spin":
      return Math.min(life, 1.2);
    case "bounceIn":
      return 0.7;
    case "shake":
      return 0.45;
    case "zoomPunch":
      return 0.35;
    default:
      return kit.motion.enter;
  }
}

function add(map: Map<string, Segment[]>, seg: Segment) {
  const list = map.get(seg.prop) ?? [];
  list.push(seg);
  map.set(seg.prop, list);
}

export function expand(layer: Layer, kit: BrandKit): LayerTracks {
  const segments = new Map<string, Segment[]>();
  const masks: MaskSpec[] = [];
  let reveal: Reveal | undefined;

  for (const a of layer.animate ?? []) {
    const d = a.duration ?? defaultDuration(a, layer, kit);
    const t0 = a.at;
    const t1 = a.at + d;
    const e = easeFn(a.ease, kit);
    const lin = easeFn("linear", kit);
    const amt = a.amount;
    const seg = (prop: AnimProp, from: number | undefined, to: number, ease = e, start = t0, end = t1) =>
      add(segments, { prop, t0: start, t1: end, from, to, ease });
    switch (a.preset) {
      case "fadeIn":
        seg("opacity", 0, 1);
        break;
      case "fadeOut":
        seg("opacity", undefined, 0);
        break;
      case "fadeUp":
        seg("opacity", 0, 1);
        seg("y", amt ?? 3, 0);
        break;
      case "fadeDown":
        seg("opacity", 0, 1);
        seg("y", -(amt ?? 3), 0);
        break;
      case "slideIn": {
        const dir = a.dir ?? "start";
        const n = amt ?? 12;
        if (dir === "start") seg("x", -n, 0);
        else if (dir === "end") seg("x", n, 0);
        else if (dir === "up") seg("y", n, 0);
        else seg("y", -n, 0);
        seg("opacity", 0, 1, e, t0, t0 + d * 0.6);
        break;
      }
      case "slideOut": {
        const dir = a.dir ?? "end";
        const n = amt ?? 12;
        if (dir === "start") seg("x", undefined, -n);
        else if (dir === "end") seg("x", undefined, n);
        else if (dir === "up") seg("y", undefined, -n);
        else seg("y", undefined, n);
        seg("opacity", undefined, 0, e, t0 + d * 0.3, t1);
        break;
      }
      case "scaleIn":
        seg("scale", amt ?? 0.85, 1);
        seg("opacity", 0, 1);
        break;
      case "scaleOut":
        seg("scale", undefined, amt ?? 0.9);
        seg("opacity", undefined, 0);
        break;
      case "pop":
        seg("scale", amt ?? 0.5, 1, a.ease ? e : easeFn("outBack", kit));
        seg("opacity", 0, 1, lin, t0, t0 + d * 0.4);
        break;
      case "typewriter":
        reveal = { t0, t1, unit: isArabic(layer.text ?? "") ? "words" : "chars", style: "type", ease: lin, stagger: 0 };
        break;
      case "wordPop":
        reveal = { t0, t1, unit: "words", style: "pop", ease: a.ease ? e : easeFn("outBack", kit), stagger: a.stagger ?? 0 };
        break;
      case "lineReveal":
        reveal = { t0, t1, unit: "lines", style: "line", ease: e, stagger: a.stagger ?? 0 };
        break;
      case "maskReveal":
        masks.push({ t0, t1, dir: a.dir ?? "start", soft: 0, ease: e });
        break;
      case "wipe":
        masks.push({ t0, t1, dir: a.dir ?? "start", soft: 0.12, ease: e });
        break;
      case "countUp":
        seg("count", amt ?? 0, a.to ?? 100, a.ease ? e : easeFn("outExpo", kit));
        break;
      case "drawOn":
        seg("trim", 0, 1);
        break;
      case "kenBurns": {
        const z = amt ?? 0.08;
        add(segments, { prop: "scale", t0, t1, to: 0, ease: lin, mode: "mul", wave: (u) => 1 + z * u });
        add(segments, { prop: "x", t0, t1, to: 0, ease: lin, mode: "add", wave: (u) => (a.dir === "end" ? 1 : -1) * 1.5 * u });
        break;
      }
      case "zoomPunch": {
        const z = amt ?? 0.08;
        add(segments, { prop: "scale", t0, t1, to: 0, ease: lin, mode: "mul", wave: (u) => 1 + z * Math.sin(Math.PI * u) });
        break;
      }
      case "shake": {
        const n = amt ?? 0.6;
        add(segments, { prop: "x", t0, t1, to: 0, ease: lin, mode: "add", wave: (u, s) => n * Math.sin(2 * Math.PI * 11 * s) * (1 - u) });
        break;
      }
      case "float": {
        const n = amt ?? 0.8;
        add(segments, { prop: "y", t0, t1, to: 0, ease: lin, mode: "add", wave: (_u, s) => n * Math.sin((2 * Math.PI * s) / 3.2) });
        break;
      }
      case "blurIn":
        seg("blur", amt ?? 12, 0);
        seg("opacity", 0, 1, e, t0, t0 + d * 0.7);
        break;
      case "bounceIn":
        seg("scale", amt ?? 0.3, 1, a.ease ? e : easeFn("spring", kit));
        seg("opacity", 0, 1, lin, t0, t0 + d * 0.3);
        break;
      case "rotateIn":
        seg("rotation", a.dir === "end" ? (amt ?? 90) : -(amt ?? 90), 0);
        seg("scale", 0.8, 1);
        seg("opacity", 0, 1, e, t0, t0 + d * 0.6);
        break;
      case "spin": {
        // turns (1 = a full turn) across the duration, on top of the layer's own rotation
        const turns = amt ?? 1;
        add(segments, { prop: "rotation", t0, t1, to: 0, ease: lin, mode: "add", wave: (u) => (a.dir === "start" ? -1 : 1) * 360 * turns * e(u) });
        break;
      }
      case "pulse": {
        const z = amt ?? 0.06;
        add(segments, { prop: "scale", t0, t1, to: 0, ease: lin, mode: "mul", wave: (_u, s) => 1 + z * Math.sin((2 * Math.PI * s) / 1.1) ** 2 });
        break;
      }
    }
  }

  // Explicit keyframes: consecutive keys become segments; before the first key the first
  // value holds (a one-key track is a constant from its time on).
  for (const [prop, keys] of Object.entries(layer.keyframes ?? {})) {
    if (!keys?.length) continue;
    const sorted = [...keys].sort((p, q) => p.t - q.t);
    if (sorted.length === 1) {
      add(segments, { prop: prop as AnimProp, t0: sorted[0].t, t1: sorted[0].t, from: sorted[0].v, to: sorted[0].v, ease: easeFn("linear", kit) });
      continue;
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      add(segments, { prop: prop as AnimProp, t0: a.t, t1: b.t, from: a.v, to: b.v, ease: easeFn(b.ease ?? "inOut", kit) });
    }
  }

  for (const list of segments.values()) list.sort((p, q) => p.t0 - q.t0);
  return { segments, reveal, masks };
}

function lerpValue(prop: string, from: number | string, to: number | string, u: number, kit: BrandKit): number | string {
  if (prop === "color") {
    return mixColor(resolveColor(kit, String(from)), resolveColor(kit, String(to)), Math.min(1, Math.max(0, u)));
  }
  const a = Number(from);
  const b = Number(to);
  return a + (b - a) * u;
}

/** A property's value at t. `base` is what it is when nothing animates it. */
export function valueAt(tracks: LayerTracks, prop: string, t: number, base: number | string, kit: BrandKit): number | string {
  const list = tracks.segments.get(prop);
  if (!list?.length) return base;
  const plain = list.filter((s) => !s.mode);
  let value: number | string = base;
  if (plain.length) {
    let active = -1;
    for (let i = 0; i < plain.length; i++) if (plain[i].t0 <= t) active = i;
    if (active === -1) {
      const first = plain[0];
      value = first.from ?? base;
    } else {
      const s = plain[active];
      const from = s.from ?? (active > 0 ? valueAt({ ...tracks, segments: new Map([[prop, plain.slice(0, active)]]) }, prop, s.t0, base, kit) : base);
      if (t >= s.t1 || s.t1 <= s.t0) value = s.to;
      else value = lerpValue(prop, from, s.to, s.ease((t - s.t0) / (s.t1 - s.t0)), kit);
    }
  }
  if (prop === "color") return resolveColor(kit, String(value));
  if (typeof value === "number") {
    for (const s of list) {
      if (!s.mode || !s.wave || t < s.t0) continue;
      const u = s.t1 > s.t0 ? Math.min(1, (t - s.t0) / (s.t1 - s.t0)) : 1;
      if (t > s.t1 && s.mode === "add") continue; // a wave ends where it ends
      const w = s.wave(u, Math.min(t, s.t1) - s.t0);
      value = s.mode === "mul" ? value * (t > s.t1 ? s.wave(1, s.t1 - s.t0) : w) : value + w;
    }
  }
  return value;
}

/** The largest number this layer's {count} reaches — what the layout measures. */
export function countExtent(tracks: LayerTracks): number {
  let max = 0;
  for (const s of tracks.segments.get("count") ?? []) {
    max = Math.max(max, Math.abs(Number(s.from ?? 0)), Math.abs(Number(s.to)));
  }
  return max;
}
