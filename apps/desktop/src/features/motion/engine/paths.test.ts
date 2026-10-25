import { describe, expect, it } from "vitest";
import { OUTLINES, outlinePath } from "./paths";

describe("outlines", () => {
  it("draws every named outline closed, inside its box", () => {
    for (const name of OUTLINES) {
      const lines = outlinePath(name, 10, 20, 100, 50);
      expect(lines, name).not.toBeNull();
      for (const line of lines!) {
        expect(line.closed, name).toBe(true);
        expect(line.points.length, name).toBeGreaterThan(3);
        for (const [x, y] of line.points) {
          expect(x, name).toBeGreaterThanOrEqual(10 - 1e-6);
          expect(x, name).toBeLessThanOrEqual(110 + 1e-6);
          expect(y, name).toBeGreaterThanOrEqual(20 - 1e-6);
          expect(y, name).toBeLessThanOrEqual(70 + 1e-6);
        }
      }
    }
    expect(outlinePath("nothing", 0, 0, 1, 1)).toBeNull();
  });

  it("takes points for the shapes that count them", () => {
    expect(outlinePath("gear", 0, 0, 1, 1, 8)![0].points.length).toBe(8 * 4 + 1);
    expect(outlinePath("burst", 0, 0, 1, 1, 12)![0].points.length).toBe(12 * 2 + 1);
  });
});
