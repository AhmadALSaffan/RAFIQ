import { describe, expect, it } from "vitest";
import { clampClip, formatTime, rulerStep } from "./pieces";

describe("motion timeline helpers", () => {
  it("formats seconds as m:ss.cc", () => {
    expect(formatTime(4.2)).toBe("0:04.20");
    expect(formatTime(75.5)).toBe("1:15.50");
    expect(formatTime(12, false)).toBe("0:12");
    expect(formatTime(-3)).toBe("0:00.00");
  });

  it("keeps ruler ticks at least 80px apart", () => {
    expect(rulerStep(60) * 60).toBeGreaterThanOrEqual(80);
    expect(rulerStep(600)).toBe(0.25);
    expect(rulerStep(1)).toBe(120);
  });

  it("keeps a moved clip inside the track and its length intact", () => {
    expect(clampClip(-1, 2, 10)).toEqual({ start: 0, end: 3 });
    expect(clampClip(9, 12, 10)).toEqual({ start: 7, end: 10 });
    expect(clampClip(5, 5, 10).end - clampClip(5, 5, 10).start).toBeCloseTo(0.1);
  });
});
