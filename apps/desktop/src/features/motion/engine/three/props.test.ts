import { describe, expect, it } from "vitest";
import type { Object3 } from "../types";
import { expandProps, FORMS, PROPS, TOPS } from "./props";

/** Every kind a list draws once expanded (groups opened). */
function kinds(list: Object3[]): string[] {
  return list.flatMap((o) => (o.kind === "group" ? kinds(o.children ?? []) : [o.kind]));
}

describe("ready-made 3D things", () => {
  it("turns every ready-made kind into a group of plain pieces, at any depth", () => {
    for (const kind of PROPS) {
      const [out] = expandProps([{ id: kind, kind: kind as Object3["kind"], position: [1, 0, 2] }], 7);
      expect(out.kind).toBe("group");
      expect(out.position).toEqual([1, 0, 2]);
      expect(kinds([out]).length).toBeGreaterThan(0);
      expect(kinds([out]).some((k) => PROPS.has(k))).toBe(false);
    }
    const [nested] = expandProps([{ kind: "group", children: [{ id: "t", kind: "tree" }] }], 1);
    expect(nested.children?.[0].kind).toBe("group");
  });

  it("keeps the thing's own motion, and leaves plain shapes alone", () => {
    const animate = [{ preset: "rise" as const, at: 0.5, stagger: 0.05 }];
    const [tree, box] = expandProps([{ id: "t", kind: "tree", animate }, { id: "b", kind: "box" }], 3);
    expect(tree.animate).toEqual(animate);
    expect(box).toEqual({ id: "b", kind: "box" });
  });

  it("comes out the same for the same seed, and differently for another", () => {
    const city: Object3 = { id: "c", kind: "city", rows: 4, cols: 4 };
    expect(JSON.stringify(expandProps([city], 11))).toBe(JSON.stringify(expandProps([city], 11)));
    expect(JSON.stringify(expandProps([city], 11))).not.toBe(JSON.stringify(expandProps([{ ...city, seed: 5 }], 11)));
  });

  it("builds a city whose parts are its buildings, streets first", () => {
    const [city] = expandProps([{ id: "c", kind: "city", rows: 3, cols: 5, windows: { lit: 0.6 } }], 2);
    const parts = city.children ?? [];
    expect(parts[0].id).toBe("c.streets");
    expect(parts.length).toBe(1 + 15);
    // the tallest buildings stand near the middle
    const height = (b: Object3) => Math.max(...(b.children ?? []).map((p) => (p.position?.[1] ?? 0) + (p.height ?? 0)));
    const middle = parts.find((b) => b.id === "c.b1_2")!;
    const corner = parts.find((b) => b.id === "c.b0_0")!;
    expect(height(middle)).toBeGreaterThan(height(corner));
    // windows reach every façade
    const facades = parts.slice(1).flatMap((b) => (b.children ?? []).filter((p) => p.windows));
    expect(facades.length).toBeGreaterThanOrEqual(15);
    expect(facades.every((f) => typeof f.windows === "object" && f.windows.lit === 0.6)).toBe(true);
  });

  it("builds every tower form and top, each its own way", () => {
    const shapes = new Set<string>();
    for (const form of FORMS) {
      for (const top of TOPS) {
        const [b] = expandProps([{ id: `b-${form}-${top}`, kind: "building", form, top, height: 6, podium: true }], 4);
        const pieces = kinds([b]);
        expect(pieces.length).toBeGreaterThan(1);
        shapes.add(pieces.join(","));
      }
    }
    // forms and tops really change the pieces, not just a label
    expect(shapes.size).toBeGreaterThan(FORMS.length * 2);
    const [twisted] = expandProps([{ id: "tw", kind: "building", form: "twisted", twist: 120, height: 8 }], 1);
    const turns = (twisted.children ?? []).filter((p) => p.id?.includes("slice")).map((p) => p.rotation?.[1] ?? 0);
    expect(Math.max(...turns)).toBeGreaterThan(90);
  });

  it("gives a generated skyline towers of different forms, tops and façades", () => {
    const [city] = expandProps([{ id: "c", kind: "city", rows: 6, cols: 6, height: 10 }], 9);
    const towers = (city.children ?? []).slice(1);
    const looks = new Set(towers.map((b) => (b.children ?? []).map((p) => `${p.kind}:${typeof p.windows === "object" ? p.windows.style : ""}`).join("|")));
    expect(looks.size).toBeGreaterThan(towers.length / 2);
  });

  it("makes water a mirror", () => {
    const [lake] = expandProps([{ id: "w", kind: "water" }], 1);
    expect(lake.children?.[0].reflect).toBeGreaterThan(0);
  });

  it("gives the whole thing one look when asked, but lamps and lit windows keep glowing", () => {
    const [lamp] = expandProps([{ id: "l", kind: "streetLamp", material: "clay" }], 1);
    const head = lamp.children?.find((p) => p.id === "l.head");
    const pole = lamp.children?.find((p) => p.id === "l.pole");
    expect(pole?.material).toBe("clay");
    expect(head?.material).toBe("glow");
  });
});
