import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockTime, dayLabel, isNewDay, parseUtc, timeAgo } from "./time";

describe("timestamps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("treats a bare ISO string as UTC, the way SQLite stores it", () => {
    expect(parseUtc("2026-03-10T11:00:00").toISOString()).toBe("2026-03-10T11:00:00.000Z");
    expect(parseUtc("2026-03-10T11:00:00Z").toISOString()).toBe("2026-03-10T11:00:00.000Z");
  });

  it("describes recent times in Arabic", () => {
    expect(timeAgo("2026-03-10T11:59:30")).toContain("ثانية");
    expect(timeAgo("2026-03-10T11:00:00")).toContain("ساعة");
  });

  it("labels today and yesterday by name", () => {
    expect(dayLabel("2026-03-10T09:00:00")).toBe("اليوم");
    expect(dayLabel("2026-03-09T09:00:00")).toBe("أمس");
    expect(dayLabel("2026-03-01T09:00:00")).not.toBe("اليوم");
  });

  it("spots the first message of a new day", () => {
    // Compared in the reader's local day, which is what a date divider means.
    expect(isNewDay(undefined, "2026-03-10T09:00:00")).toBe(true);
    expect(isNewDay("2026-03-08T09:00:00", "2026-03-10T09:00:00")).toBe(true);
    expect(isNewDay("2026-03-10T08:00:00", "2026-03-10T09:00:00")).toBe(false);
  });

  it("formats a clock time", () => {
    expect(clockTime("2026-03-10T09:05:00")).toMatch(/\d/);
  });
});
