import { describe, expect, it } from "vitest";
import { DEFAULT_KIT } from "./brand";
import { easeFn, isAllowedEase } from "./easing";
import { evaluate, formatCount, prepare, splitWords, wrapText, type Measure } from "./evaluate";
import { length, parsePath, trimLines } from "./paths";
import type { Scene } from "./types";

// A stand-in for the browser's measurement: half the font size per character.
const measure: Measure = (text, font) => text.length * Number(/([\d.]+)px/.exec(font)![1]) * 0.5;

function scene(partial: Partial<Scene> = {}): Scene {
  return {
    version: 1,
    composition: { width: 1080, height: 1920, fps: 30, duration: 6, background: "brand.surface", safeArea: "reels", direction: "rtl" },
    layers: [
      {
        id: "title",
        type: "text",
        start: 0.4,
        end: 4,
        text: "قهوة مختصة",
        style: "display",
        layout: { anchor: "center", y: -6 },
        animate: [
          { preset: "fadeUp", at: 0.4, duration: 0.6 },
          { preset: "fadeOut", at: 3.6, duration: 0.4 },
        ],
      },
      {
        id: "price",
        type: "text",
        start: 1.2,
        end: 4,
        text: "{count}",
        style: "headline",
        color: "brand.primary",
        layout: { below: "title", gap: 3 },
        animate: [{ preset: "countUp", at: 1.2, duration: 1.2, to: 25 }],
      },
    ],
    ...partial,
  };
}

describe("motion evaluator", () => {
  it("gives the same frame for the same scene and time", () => {
    const a = evaluate(prepare(scene(), DEFAULT_KIT, measure), 1.7, measure);
    const b = evaluate(prepare(scene(), DEFAULT_KIT, measure), 1.7, measure);
    expect(JSON.stringify(a, (k, v) => (k === "layer" ? undefined : v))).toBe(JSON.stringify(b, (k, v) => (k === "layer" ? undefined : v)));
  });

  it("shows a layer only between its start and end", () => {
    const p = prepare(scene(), DEFAULT_KIT, measure);
    expect(evaluate(p, 0.2, measure).items.map((i) => i.id)).toEqual([]);
    expect(evaluate(p, 1.5, measure).items.map((i) => i.id)).toEqual(["title", "price"]);
    expect(evaluate(p, 4, measure).items.map((i) => i.id)).toEqual([]);
  });

  it("runs fadeUp from below and transparent to its place", () => {
    const p = prepare(scene(), DEFAULT_KIT, measure);
    const start = evaluate(p, 0.4, measure).items[0];
    const end = evaluate(p, 1.1, measure).items[0];
    expect(start.opacity).toBeCloseTo(0, 3);
    expect(start.ty).toBeGreaterThan(0);
    expect(end.opacity).toBeCloseTo(1, 3);
    expect(end.ty).toBeCloseTo(0, 3);
  });

  it("fades out from wherever the opacity is", () => {
    const p = prepare(scene(), DEFAULT_KIT, measure);
    const mid = evaluate(p, 3.8, measure).items[0];
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
  });

  it("counts up and measures the box with the final number", () => {
    const p = prepare(scene(), DEFAULT_KIT, measure);
    const early = evaluate(p, 1.3, measure).items.find((i) => i.id === "price")!;
    const late = evaluate(p, 3, measure).items.find((i) => i.id === "price")!;
    expect(Number(early.textValue)).toBeLessThan(25);
    expect(late.textValue).toBe("25");
    expect(early.box).toEqual(late.box);
  });

  it("puts `below` under its reference, centred like it", () => {
    const p = prepare(scene(), DEFAULT_KIT, measure);
    const title = p.layout.get("title")!.box;
    const price = p.layout.get("price")!.box;
    expect(price.y).toBeCloseTo(title.y + title.h + 3 * p.unit, 5);
    expect(price.x + price.w / 2).toBeCloseTo(title.x + title.w / 2, 5);
  });

  it("flips start and end with the direction", () => {
    const base = scene({
      layers: [{ id: "a", type: "text", start: 0, end: 3, text: "Hi", style: "body", layout: { anchor: "start", x: 2 } }],
    });
    const rtl = prepare(base, DEFAULT_KIT, measure);
    const ltr = prepare({ ...base, composition: { ...base.composition, direction: "ltr" } }, DEFAULT_KIT, measure);
    const r = rtl.layout.get("a")!.box;
    const l = ltr.layout.get("a")!.box;
    // mirror images of each other across the vertical centre line
    expect(r.x + r.w / 2).toBeCloseTo(1080 - (l.x + l.w / 2), 5);
    expect(r.x).toBeGreaterThan(540);
  });

  it("works in grid units that scale with the frame", () => {
    const p = prepare(scene(), DEFAULT_KIT, measure);
    expect(p.unit).toBe(8);
    const big = prepare({ ...scene(), composition: { ...scene().composition, width: 2160, height: 3840 } }, DEFAULT_KIT, measure);
    expect(big.unit).toBe(16);
  });

  it("wraps on words and keeps them whole", () => {
    const lines = wrapText("كلمة واحدة طويلة جداً هون", 120, "500 20px x", measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.text).join(" ")).toBe("كلمة واحدة طويلة جداً هون");
    expect(splitWords("one two").join("")).toBe("one two");
  });

  it("formats counts with Arabic-Indic digits when asked", () => {
    expect(formatCount(1250, { id: "x", type: "text", start: 0, end: 1 }, "arabic")).toBe("١٬٢٥٠");
    expect(formatCount(3.5, { id: "x", type: "text", start: 0, end: 1, format: { decimals: 1 } })).toBe("3.5");
  });

  it("reveals Arabic word by word, never letter by letter", () => {
    const s = scene({
      layers: [{ id: "t", type: "text", start: 0, end: 4, text: "مرحبا بالعالم الجميل", style: "title", animate: [{ preset: "typewriter", at: 0, duration: 1.5 }] }],
    });
    const p = prepare(s, DEFAULT_KIT, measure);
    const words = evaluate(p, 0.6, measure).items[0].lines!.flatMap((l) => l.words ?? []);
    expect(words.map((w) => w.text.trim())).toEqual(["مرحبا", "بالعالم", "الجميل"]);
    expect(words.filter((w) => w.opacity > 0).length).toBe(1);
  });
});

describe("easing and paths", () => {
  it("allows only the listed easings", () => {
    expect(isAllowedEase("outExpo")).toBe(true);
    expect(isAllowedEase("spring(170, 18)")).toBe(true);
    expect(isAllowedEase("bounceWild")).toBe(false);
    const e = easeFn("inOut", DEFAULT_KIT);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    expect(e(0.5)).toBeCloseTo(0.5, 2);
  });

  it("measures and trims a path", () => {
    const lines = parsePath("M0 0 L10 0 L10 10");
    expect(length(lines)).toBeCloseTo(20, 5);
    expect(length(trimLines(lines, 0.5))).toBeCloseTo(10, 5);
    expect(length(parsePath("M0 0 h5 v5 z"))).toBeCloseTo(10 + Math.SQRT2 * 5, 3);
  });
});
