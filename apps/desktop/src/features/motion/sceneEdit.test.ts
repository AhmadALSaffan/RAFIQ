import { describe, expect, it } from "vitest";
import { applyOps, clipPatch, tracksFromScene } from "./sceneEdit";
import type { Scene } from "./engine/types";

const scene = (): Scene => ({
  version: 1,
  composition: { width: 1920, height: 1080, fps: 30, duration: 32 },
  layers: [
    {
      id: "orbit",
      type: "shape",
      shape: "ring",
      start: 29,
      end: 32,
      animate: [{ preset: "fadeIn", at: 29.5 }],
      keyframes: { rotation: [{ t: 30, v: 0 }, { t: 31.5, v: 90 }], x: [{ t: 40, v: 4 }] },
    },
  ],
});

describe("the timeline's rows", () => {
  it("gives keys from the clip's start, so a late layer's keys sit on its clip (not past the video)", () => {
    const [row] = tracksFromScene(scene());
    expect(row.clips[0]).toMatchObject({ start: 29, end: 32 });
    // fadeIn at 29.5 and the keys at 30 and 31.5; the key at 40 is past the layer
    expect(row.keyframes).toEqual([0.5, 1, 2.5]);
    for (const k of row.keyframes ?? []) expect(row.clips[0].start + k).toBeLessThanOrEqual(32);
  });

  it("moving a clip carries its keys with it; trimming leaves them", () => {
    const moved = applyOps(scene(), clipPatch(scene(), "orbit", 20, 23).ops);
    expect(moved.layers[0].keyframes?.rotation?.map((k) => k.t)).toEqual([21, 22.5]);
    expect(moved.layers[0].animate?.[0].at).toBe(20.5);
    const trimmed = applyOps(scene(), clipPatch(scene(), "orbit", 29, 31).ops);
    expect(trimmed.layers[0].keyframes?.rotation?.map((k) => k.t)).toEqual([30, 31.5]);
  });
});
