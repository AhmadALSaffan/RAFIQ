import { describe, expect, it } from "vitest";
import { DEFAULT_KIT } from "./brand";
import type { MotionEngine } from "./engine";
import { evaluate, prepare, type Measure } from "./evaluate";
import { formatReview, reviewScene } from "./review";
import type { Layer, Scene } from "./types";

// half the font size per character, like the evaluator's tests
const measure: Measure = (text, font) => text.length * Number(/([\d.]+)px/.exec(font)![1]) * 0.5;

function scene(layers: Layer[], partial: Partial<Scene> = {}): Scene {
  return {
    version: 1,
    composition: { width: 1080, height: 1920, fps: 30, duration: 6, background: "brand.surface", safeArea: "reels", direction: "rtl" },
    layers,
    ...partial,
  };
}

function fakeEngine(s: Scene, m: Measure = measure): MotionEngine {
  const prepared = prepare(s, DEFAULT_KIT, m);
  return { scene: s, frame: (t: number) => evaluate(prepared, t, m) } as unknown as MotionEngine;
}

const text = (id: string, start: number, end: number, extra: Partial<Layer> = {}): Layer => ({
  id, type: "text", start, end, text: "كلمة", style: "body", layout: { anchor: "center" }, ...extra,
});

describe("the sweep transition", () => {
  const panel: Layer = {
    id: "cut", type: "shape", shape: "rect", start: 2.72, end: 3.28, important: false, fill: "brand.primary",
    layout: { anchor: "center", width: 143, height: 248 }, animate: [{ preset: "sweep", at: 2.72, duration: 0.56 }],
  };
  const p = prepare(scene([panel]), DEFAULT_KIT, measure);
  const at = (t: number) => evaluate(p, t, measure).items[0];

  it("comes in from off the frame, covers it at the cut, and leaves the other side", () => {
    const W = 1080;
    const off = (b: { x: number; w: number }) => b.x + b.w <= 1 || b.x >= W - 1;
    const first = at(2.72).bounds;
    expect(off(first)).toBe(true);
    expect(Math.abs(at(3.0).bounds.x - (W - at(3.0).bounds.w) / 2)).toBeLessThan(1);
    const last = at(3.279).bounds;
    expect(off({ x: last.x, w: last.w }) || Math.abs(last.x) > W * 0.9).toBe(true);
    // RTL: "start" is the right edge, so it leaves on the left
    expect(Math.sign(last.x - (W - last.w) / 2)).toBe(-Math.sign(first.x - (W - first.w) / 2));
  });
});

describe("text boxes and deep glyphs", () => {
  it("grows a text box when the face draws below it", () => {
    const deep: Measure = Object.assign((t: string, f: string) => measure(t, f), { descent: (_t: string, f: string) => Number(/([\d.]+)px/.exec(f)![1]) * 0.6 });
    const s = scene([text("hero", 0, 3, { size: 250, style: "display" })]);
    const plain = evaluate(prepare(s, DEFAULT_KIT, measure), 1, measure).items[0].box.h;
    const grown = evaluate(prepare(s, DEFAULT_KIT, deep), 1, deep).items[0].box.h;
    expect(grown).toBeGreaterThan(plain);
  });
});

describe("the director's review", () => {
  it("cuts the video into its shots", () => {
    const r = reviewScene(fakeEngine(scene([text("a", 0, 3, { size: 260 }), text("b", 3, 6, { size: 260 })])));
    expect(r.shots.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 6]]);
  });

  it("asks for a hero when every text is small", () => {
    const r = reviewScene(fakeEngine(scene([text("a", 0, 6), text("b", 0, 6, { layout: { below: "a", gap: 2 } })])));
    expect(formatReview(r)).toContain("no hero");
  });

  it("notices a shot that floats small in an empty frame", () => {
    const r = reviewScene(fakeEngine(scene([text("a", 0, 6, { size: 120 })])));
    expect(r.shots[0].notes.join(" ")).toContain("floats small");
  });

  it("flags a transition panel that grows from the middle", () => {
    const burst: Layer = {
      id: "burst", type: "shape", shape: "rect", start: 2.72, end: 3.28, important: false, fill: "brand.primary",
      layout: { anchor: "center", width: 143, height: 248 },
      keyframes: { scale: [{ t: 2.72, v: 0.04 }, { t: 3.0, v: 1, ease: "linear" }, { t: 3.28, v: 0.04, ease: "linear" }] },
    };
    const r = reviewScene(fakeEngine(scene([text("a", 0, 3, { size: 260 }), text("b", 3, 6, { size: 260 }), burst])));
    expect(r.overall.join(" ")).toContain("floating mid-frame");
  });
});
