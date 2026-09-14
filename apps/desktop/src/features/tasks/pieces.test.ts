import { describe, expect, it } from "vitest";
import { formatDuration, statusFilterLabel } from "./pieces";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + seconds * 1000).toISOString();

describe("formatDuration", () => {
  it("reads in seconds under a minute", () => {
    expect(formatDuration(at(0), at(45))).toBe("45 ثانية");
  });

  it("splits minutes and seconds", () => {
    expect(formatDuration(at(0), at(200))).toBe("3 د و20 ث");
  });

  it("drops the remainder on a whole minute", () => {
    expect(formatDuration(at(0), at(180))).toBe("3 دقيقة");
  });

  it("switches to hours past sixty minutes", () => {
    expect(formatDuration(at(0), at(3900))).toBe("1 س و5 د");
  });

  it("never goes negative when the clocks disagree", () => {
    expect(formatDuration(at(30), at(0))).toBe("0 ثانية");
  });

  it("gives up on unparseable timestamps", () => {
    expect(formatDuration("not a date", at(0))).toBeNull();
  });
});

describe("statusFilterLabel", () => {
  it("names the filters in Arabic", () => {
    expect(statusFilterLabel("active")).toBe("شغّالة");
    expect(statusFilterLabel("queued")).toBe("بالدور");
  });

  it("falls back to the raw key", () => {
    expect(statusFilterLabel("unknown")).toBe("unknown");
  });
});
