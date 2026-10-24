import { describe, expect, it } from "vitest";
import { DEFAULT_KIT } from "../brand";
import type { Object3 } from "../types";
import { RECIPES, expandScene3D } from "./recipes";
import { cameraState, keyValue, latLon, noise3, objectState, partState, seeded } from "./timeline";

const kit = DEFAULT_KIT;

describe("3D timing", () => {
  it("reads keys like the 2D tracks: held before the first, eased between, held after", () => {
    const keys = [
      { t: 1, v: 0 },
      { t: 3, v: 10, ease: "linear" },
    ];
    expect(keyValue(keys, 0, kit)).toBe(0);
    expect(keyValue(keys, 2, kit)).toBeCloseTo(5);
    expect(keyValue(keys, 9, kit)).toBe(10);
    expect(keyValue([{ t: 0, v: [0, 0, 0] }, { t: 2, v: [2, 4, 6], ease: "linear" }], 1, kit)).toEqual([1, 2, 3]);
  });

  it("hides an object before its entrance and shows it whole after", () => {
    const o: Object3 = { kind: "box", animate: [{ preset: "pop", at: 2, duration: 1 }] };
    expect(objectState(o, 1, kit).scale[0]).toBe(0);
    expect(objectState(o, 4, kit).scale[0]).toBeCloseTo(1);
    const rise: Object3 = { kind: "box", position: [0, 1, 0], animate: [{ preset: "rise", at: 0 }] };
    expect(objectState(rise, 0, kit).opacity).toBe(0);
    expect(objectState(rise, 3, kit).position[1]).toBeCloseTo(1);
    // the scene itself is never changed by reading a frame
    expect(rise.position).toEqual([0, 1, 0]);
  });

  it("turns at its speed and keys win over the base", () => {
    const o: Object3 = { kind: "box", rotation: [0, 10, 0], animate: [{ preset: "turntable", at: 0, amount: 90 }] };
    expect(objectState(o, 1, kit).rotation[1]).toBeCloseTo(((10 + 90) * Math.PI) / 180);
    const keyed: Object3 = { kind: "box", keyframes: { "position.x": [{ t: 0, v: 3 }] } };
    expect(objectState(keyed, 5, kit).position[0]).toBe(3);
  });

  it("staggers the parts one after another, not the whole", () => {
    const o: Object3 = { kind: "text3d", text: "a b c", animate: [{ preset: "fadeIn", at: 0, duration: 0.5, stagger: 1 }] };
    expect(objectState(o, 0, kit).opacity).toBe(1);
    expect(partState(o, 0, 0.6, kit)!.opacity).toBeCloseTo(1);
    expect(partState(o, 2, 0.6, kit)!.opacity).toBe(0);
    expect(partState({ kind: "box" }, 0, 1, kit)).toBeNull();
  });

  it("moves the camera the same way for the same time, whatever came before", () => {
    const cam = { position: [0, 0, 8] as [number, number, number], move: { type: "orbit" as const, amount: 60 } };
    const a = cameraState(cam, 2, 0, 4, kit);
    cameraState(cam, 3.7, 0, 4, kit);
    expect(cameraState(cam, 2, 0, 4, kit)).toEqual(a);
    expect(Math.hypot(...a.position)).toBeCloseTo(8);
  });

  it("is deterministic: the same seed, the same numbers", () => {
    const r1 = seeded(42);
    const r2 = seeded(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(noise3(1.3, 2.7, 0.4)).toBe(noise3(1.3, 2.7, 0.4));
  });

  it("puts latitude and longitude on the sphere (east to the right)", () => {
    const [x, y, z] = latLon(0, 0, 2);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(2);
    expect(latLon(0, 90, 1)[0]).toBeCloseTo(1);
    expect(latLon(90, 0, 1)[1]).toBeCloseTo(1);
  });
});

describe("recipes", () => {
  it("every recipe expands to a scene with objects, timed inside the layer", () => {
    for (const recipe of RECIPES) {
      const scene = expandScene3D({ recipe, params: { text: "رفيق" } }, 2, 9);
      expect(scene.objects?.length, recipe).toBeGreaterThan(0);
      const times = JSON.stringify(scene.objects).match(/"(?:at|t)":(\d+(?:\.\d+)?)/g) ?? [];
      for (const m of times) {
        const t = Number(m.split(":")[1]);
        expect(t, `${recipe} ${m}`).toBeGreaterThanOrEqual(2);
        expect(t, `${recipe} ${m}`).toBeLessThanOrEqual(9);
      }
    }
  });

  it("what the layer says goes on top: objects are added, the rest overrides", () => {
    const scene = expandScene3D({ recipe: "logoReveal", params: { text: "x" }, objects: [{ kind: "sphere", id: "extra" }], post: { bloom: 2 }, camera: { fov: 50 } }, 0, 5);
    expect(scene.objects?.some((o) => o.id === "extra")).toBe(true);
    expect(scene.objects?.some((o) => o.id === "title")).toBe(true);
    expect(scene.post?.bloom).toBe(2);
    expect(scene.post?.vignette).toBeGreaterThan(0);
    expect(scene.camera?.fov).toBe(50);
    expect(scene.camera?.move).toBeDefined();
  });

  it("a scene without a recipe is left as written", () => {
    const own = { objects: [{ kind: "box" as const }] };
    expect(expandScene3D(own, 0, 4)).toBe(own);
  });
});
