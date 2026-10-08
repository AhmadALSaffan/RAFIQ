/**
 * The only easings a scene may use (anything else is check M007). All are pure functions of
 * u in [0, 1] — no state, so a frame is the same on every machine.
 */

import type { BrandKit, Ease } from "./types";

export type EaseFn = (u: number) => number;

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  // Newton–Raphson on x(t), then y(t). Good to well under a pixel at any frame size.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const err = x(t) - u;
      const d = dx(t);
      if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // A bisection fallback for the flat ends of steep curves.
    if (Math.abs(x(t) - u) > 1e-4) {
      let lo = 0;
      let hi = 1;
      t = u;
      for (let i = 0; i < 30; i++) {
        if (x(t) < u) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return y(t);
  };
}

/** A spring step 0→1. The animation's duration covers the time the spring takes to settle
 * (to within about 0.1%), so `duration` still means what it says. */
function spring(stiffness: number, damping: number): EaseFn {
  const w = Math.sqrt(Math.max(1, stiffness));
  const z = Math.min(2, Math.max(0.05, damping / (2 * w)));
  const settle = Math.min(7 / (z * w), 20 / w);
  const raw = (tau: number) => {
    if (tau <= 0) return 0;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau));
    }
    return 1 - Math.exp(-w * tau) * (1 + w * tau);
  };
  return (u) => (u >= 1 ? 1 : raw(clamp01(u) * settle));
}

const NAMED: Record<string, EaseFn> = {
  linear: (u) => clamp01(u),
  in: cubicBezier(0.42, 0, 1, 1),
  out: cubicBezier(0, 0, 0.58, 1),
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  outExpo: cubicBezier(0.16, 1, 0.3, 1),
  // "light" overshoot: about 6%.
  outBack: cubicBezier(0.34, 1.4, 0.64, 1),
  spring: spring(170, 18),
};

const SPRING = /^spring\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/;

export function isAllowedEase(ease: Ease | undefined): boolean {
  if (ease === undefined) return true;
  return ease in NAMED || ease === "brand" || SPRING.test(ease);
}

const cache = new Map<string, EaseFn>();

export function easeFn(ease: Ease | undefined, kit: BrandKit): EaseFn {
  const name = ease ?? kit.motion.ease ?? "outExpo";
  if (name === "brand") {
    const b = kit.motion.bezier;
    if (b) return cubicBezier(...b);
    return easeFn(kit.motion.ease === "brand" ? "outExpo" : kit.motion.ease, kit);
  }
  const hit = cache.get(name);
  if (hit) return hit;
  let fn = NAMED[name];
  if (!fn) {
    const m = SPRING.exec(name);
    fn = m ? spring(Number(m[1]), Number(m[2])) : NAMED.outExpo;
  }
  cache.set(name, fn);
  return fn;
}
