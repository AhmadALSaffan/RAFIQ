import { describe, expect, it } from "vitest";
import type { TaskEvent } from "../../lib/types";
import { canResume, finishedSteps, formatDuration, statusFilterLabel } from "./pieces";

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

describe("canResume", () => {
  it("is offered for a task that stopped, either way", () => {
    expect(canResume("failed")).toBe(true);
    expect(canResume("cancelled")).toBe(true);
  });

  it("is not offered while it is running, waiting, planned or finished", () => {
    for (const status of ["queued", "pending", "running", "planned", "completed"] as const) {
      expect(canResume(status)).toBe(false);
    }
  });
});

describe("finishedSteps", () => {
  const stamp = "2026-01-01T00:00:00Z";
  const result = (id: string, ok: boolean): TaskEvent => ({ id, type: "tool_result", tool: "shell_run", ok, output: "", created_at: stamp });

  it("counts the tool steps that succeeded", () => {
    expect(finishedSteps([result("1", true), result("2", false), result("3", true)])).toBe(2);
  });

  it("starts again from zero after a resume, so only the new run's work counts", () => {
    const resumed: TaskEvent = { id: "r", type: "resumed", from: "failed", created_at: stamp };
    expect(finishedSteps([result("1", true), resumed, result("2", true)])).toBe(1);
    expect(finishedSteps([result("1", true), resumed])).toBe(0);
  });

  it("is zero for an empty transcript", () => {
    expect(finishedSteps([])).toBe(0);
  });
});
