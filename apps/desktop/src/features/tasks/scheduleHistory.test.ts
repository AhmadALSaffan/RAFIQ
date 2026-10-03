import { describe, expect, it } from "vitest";
import { formatDuration, runTone, successRate } from "./scheduleHistory";

describe("schedule history", () => {
  it("shows durations short but exact", () => {
    const digits = (s: string | null) => s?.replace(/[^\d ]/g, "").replace(/\s+/g, " ").trim();
    expect(digits(formatDuration(42))).toBe("42");
    expect(digits(formatDuration(185))).toBe("3 05");
    expect(digits(formatDuration(4320))).toBe("1 12");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });

  it("counts successes among the runs that ended, not the ones still going", () => {
    expect(successRate(["completed", "failed", "running", "not_started", "completed", "queued"])).toEqual({ ok: 2, done: 4 });
    expect(successRate([])).toEqual({ ok: 0, done: 0 });
  });

  it("marks a run that never started like a failure", () => {
    expect(runTone("not_started")).toBe(runTone("failed"));
    expect(runTone("completed")).not.toBe(runTone("failed"));
  });
});
