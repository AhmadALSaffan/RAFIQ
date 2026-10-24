/**
 * Where everything in a 3D layer is at time t — no three.js here, only numbers, so it's
 * tested like the 2D tracks. Every value comes from `t` alone (keys, presets, camera moves,
 * seeded noise): the preview, a scrub backwards and the export draw the same frame.
 */

import { mixColor, resolveColor } from "../brand";
import { easeFn, type EaseFn } from "../easing";
import type { Anim3, BrandKit, Camera3, Ease, Key3, Object3, Vec3 } from "../types";

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const DEG = Math.PI / 180;

/** A small fast seeded random (mulberry32): the same seed, the same sequence. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Smooth 3D value noise in [-1, 1] (deterministic). */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const s = (u: number) => u * u * (3 - 2 * u);
  const h = (a: number, b: number, c: number) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  };
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  const u = s(xf);
  const v = s(yf);
  const w = s(zf);
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function bounce(u: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
  return n * (u -= 2.625 / d) * u + 0.984375;
}

export function ease3(name: Ease | "bounce" | undefined, kit: BrandKit, fallback: Ease = "outExpo"): EaseFn {
  if (name === "bounce") return (u) => bounce(clamp01(u));
  return easeFn(name ?? fallback, kit);
}

function lerpV(a: Vec3, b: Vec3, u: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** A key track's value at t: before the first key its value holds, after the last too. */
export function keyValue(keys: Key3[], t: number, kit: BrandKit): number | Vec3 | string | undefined {
  if (!keys.length) return undefined;
  const sorted = [...keys].sort((p, q) => p.t - q.t);
  if (t <= sorted[0].t) return sorted[0].v;
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t < a.t || t > b.t) continue;
    const u = ease3(b.ease, kit, "inOut")(b.t === a.t ? 1 : (t - a.t) / (b.t - a.t));
    if (typeof a.v === "string" || typeof b.v === "string") return mixColor(resolveColor(kit, String(a.v)), resolveColor(kit, String(b.v)), clamp01(u));
    if (Array.isArray(a.v) && Array.isArray(b.v)) return lerpV(a.v, b.v, u);
    return Number(a.v) + (Number(b.v) - Number(a.v)) * u;
  }
  return last.v;
}

export interface State3 {
  position: Vec3;
  /** Radians. */
  rotation: Vec3;
  scale: Vec3;
  opacity: number;
  color?: string;
  glow?: number;
  /** Particles: 0 = their `shape`, 1 = their `to`. */
  morph: number;
  /** Tubes and arcs: how much of them is drawn. */
  trim: number;
}

const ENTRANCES = new Set(["rise", "drop", "pop", "spinIn", "flip", "slideIn", "zoomIn", "fadeIn", "grow", "assemble", "draw"]);

/** A fresh [x, y, z] (never the scene's own array: states are changed in place). */
function vec(v: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number") ? [v[0], v[1], v[2]] : [...fallback];
}

/** The base (unanimated) state of an object. */
export function baseState(o: Object3): State3 {
  const s = o.scale;
  return {
    position: vec(o.position, [0, 0, 0]),
    rotation: vec(o.rotation, [0, 0, 0]).map((d) => d * DEG) as Vec3,
    scale: typeof s === "number" ? [s, s, s] : vec(s, [1, 1, 1]),
    opacity: o.opacity ?? 1,
    morph: 0,
    trim: 1,
  };
}

/** Keys on an object: whole props (position, rotation, scale…) or one axis ("rotation.y"). */
export function applyKeys(state: State3, keys: Record<string, Key3[]> | undefined, t: number, kit: BrandKit): void {
  for (const [prop, list] of Object.entries(keys ?? {})) {
    const v = keyValue(list ?? [], t, kit);
    if (v === undefined) continue;
    const [name, axis] = prop.split(".");
    const i = axis === "x" ? 0 : axis === "y" ? 1 : axis === "z" ? 2 : -1;
    const toRad = name === "rotation" ? DEG : 1;
    if (name === "position" || name === "rotation" || name === "scale") {
      const target: number[] = state[name];
      if (i >= 0 && typeof v === "number") target[i] = v * toRad;
      else if (Array.isArray(v)) for (let k = 0; k < 3; k++) target[k] = v[k] * toRad;
      else if (typeof v === "number" && name === "scale") state.scale = [v, v, v];
    } else if (name === "opacity" && typeof v === "number") state.opacity = v;
    else if (name === "color" && typeof v === "string") state.color = v.startsWith("#") ? v : resolveColor(kit, v);
    else if (name === "glow" && typeof v === "number") state.glow = v;
    else if (name === "morph" && typeof v === "number") state.morph = v;
    else if (name === "trim" && typeof v === "number") state.trim = v;
  }
}

/** Presets on top of the keys. `shift` delays them (a staggered part). */
export function applyPresets(state: State3, anims: Anim3[] | undefined, t: number, kit: BrandKit, shift = 0, staggered = false): void {
  for (const a of anims ?? []) {
    // A staggered preset moves the parts; the whole object only runs the plain ones.
    if (Boolean(a.stagger) !== staggered) continue;
    const at = a.at + shift;
    const dur = Math.max(0.05, a.duration ?? (a.preset === "drop" ? 1.2 : 1));
    const raw = clamp01((t - at) / dur);
    const e = ease3(a.ease, kit, a.preset === "pop" ? "outBack" : a.preset === "drop" ? "bounce" : "outExpo")(raw);
    const since = Math.max(0, t - at);
    const n = a.amount;
    const ax = a.axis === "x" ? 0 : a.axis === "z" ? 2 : 1;
    const shown = t >= at ? 1 : 0;
    switch (a.preset) {
      case "rise":
        state.position[1] -= (n ?? 1.2) * (1 - e);
        state.opacity *= clamp01(raw * 4);
        break;
      case "drop":
        state.position[1] += (n ?? 4) * (1 - e);
        state.opacity *= shown;
        break;
      case "pop":
        state.scale = state.scale.map((s) => s * Math.max(0, e)) as Vec3;
        break;
      case "spinIn":
        state.rotation[1] += -Math.PI * (1 - e);
        state.scale = state.scale.map((s) => s * (0.6 + 0.4 * e)) as Vec3;
        state.opacity *= clamp01(raw * 4);
        break;
      case "flip":
        state.rotation[0] += (Math.PI / 2) * (1 - e);
        state.opacity *= clamp01(raw * 4);
        break;
      case "slideIn": {
        const sign = a.dir === "end" ? 1 : -1;
        if (a.dir === "up" || a.dir === "down") state.position[1] += (a.dir === "up" ? -1 : 1) * (n ?? 4) * (1 - e);
        else state.position[0] += sign * (n ?? 4) * (1 - e);
        state.opacity *= clamp01(raw * 2);
        break;
      }
      case "zoomIn":
        state.position[2] -= (n ?? 6) * (1 - e);
        state.opacity *= clamp01(raw * 2);
        break;
      case "fadeIn":
        state.opacity *= e;
        break;
      case "fadeOut":
        state.opacity *= 1 - e;
        break;
      case "float":
        state.position[1] += (n ?? 0.12) * Math.sin((2 * Math.PI * since) / 3.2) * shown;
        break;
      case "turntable":
        state.rotation[ax] += (n ?? 30) * DEG * since;
        break;
      case "orbit": {
        const angle = (n ?? 20) * DEG * since;
        const [x, y, z] = state.position;
        state.position = [x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle)];
        break;
      }
      case "pulse":
        state.scale = state.scale.map((s) => s * (1 + (n ?? 0.06) * Math.sin((Math.PI * since) / 0.6) ** 2 * shown)) as Vec3;
        break;
      case "grow":
        state.scale[1] *= Math.max(0.0001, e);
        break;
      case "assemble":
        state.morph = e;
        break;
      case "scatter":
        state.morph = 1 - e;
        break;
      case "draw":
        state.trim = e;
        break;
    }
  }
}

/** An object's state at t (keys, then presets). */
export function objectState(o: Object3, t: number, kit: BrandKit): State3 {
  const state = baseState(o);
  applyKeys(state, o.keyframes, t, kit);
  applyPresets(state, o.animate, t, kit);
  return state;
}

/** The state a staggered part adds: part `index` of an object runs its staggered presets
 * `index × stagger` later. Starts from a neutral state; the caller composes it. */
export function partState(o: Object3, index: number, t: number, kit: BrandKit): State3 | null {
  const anims = (o.animate ?? []).filter((a) => a.stagger);
  if (!anims.length) return null;
  const state: State3 = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], opacity: 1, morph: 0, trim: 1 };
  for (const a of anims) applyPresets(state, [a], t, kit, index * (a.stagger ?? 0), true);
  return state;
}

/** Whether an object is already on screen before its first entrance (for checks). */
export function startsHidden(o: Object3): boolean {
  return (o.animate ?? []).some((a) => ENTRANCES.has(a.preset));
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** The camera at t: its place, its move over the layer (or the move's own window), its keys. */
export function cameraState(cam: Camera3 | undefined, t: number, start: number, end: number, kit: BrandKit, seed = 1): CameraState {
  const target = vec(cam?.target, [0, 0, 0]);
  let position = vec(cam?.position, [0, 0.6, 7]);
  let fov = cam?.fov ?? 35;
  const move = cam?.move;
  if (move && move.type !== "none") {
    const at = move.at ?? start;
    const dur = Math.max(0.1, move.duration ?? end - at);
    const u = ease3(move.ease, kit, "inOut")(clamp01((t - at) / dur));
    const rel: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
    switch (move.type) {
      case "orbit": {
        const a = (move.amount ?? 40) * DEG * (u - 0.5);
        position = [target[0] + rel[0] * Math.cos(a) + rel[2] * Math.sin(a), position[1], target[2] - rel[0] * Math.sin(a) + rel[2] * Math.cos(a)];
        break;
      }
      case "dolly":
      case "push": {
        const k = 1 - (move.amount ?? (move.type === "push" ? 0.35 : 0.2)) * u;
        position = [target[0] + rel[0] * k, target[1] + rel[1] * k, target[2] + rel[2] * k];
        break;
      }
      case "crane":
        position = [position[0], position[1] + (move.amount ?? 2) * (1 - u), position[2]];
        break;
      case "handheld": {
        const n = (move.amount ?? 0.05) * Math.hypot(...rel);
        const s = seed % 97;
        position = [position[0] + n * noise3(t * 0.6, s, 0), position[1] + n * noise3(s, t * 0.6, 1), position[2] + n * 0.5 * noise3(2, s, t * 0.5)];
        break;
      }
    }
  }
  const keyed = cam?.keyframes;
  const p = keyed?.position ? keyValue(keyed.position, t, kit) : undefined;
  if (Array.isArray(p)) position = [p[0], p[1], p[2]];
  const tg = keyed?.target ? keyValue(keyed.target, t, kit) : undefined;
  const f = keyed?.fov ? keyValue(keyed.fov, t, kit) : undefined;
  if (typeof f === "number") fov = f;
  return { position, target: Array.isArray(tg) ? [tg[0], tg[1], tg[2]] : target, fov };
}

/** Latitude/longitude on a sphere of `r` (y up; longitude 0 faces the camera at +z). */
export function latLon(lat: number, lon: number, r: number): Vec3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 90) * DEG;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}
