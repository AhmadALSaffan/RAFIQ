import { describe, expect, it } from "vitest";
import type { DesignVersion } from "../../lib/types";
import { previousOf } from "./HistoryPane";

const v = (id: string, document: string, number: number): DesignVersion => ({
  id,
  document,
  number,
  message_id: id.split(".")[0],
  created_at: "2026-10-06T10:00:00Z",
  lines: 10,
  added: 1,
  removed: 0,
  summary: "",
});

describe("design history", () => {
  // Newest first, two documents interleaved.
  const versions = [v("m4.0", "cart", 2), v("m3.0", "home", 3), v("m3.1", "cart", 1), v("m2.0", "home", 2), v("m1.0", "home", 1)];

  it("compares a version with the one before it of the same document", () => {
    expect(previousOf(versions, "m3.0")).toBe("m2.0");
    expect(previousOf(versions, "m4.0")).toBe("m3.1");
  });

  it("has nothing to compare a document's first version with", () => {
    expect(previousOf(versions, "m1.0")).toBeNull();
    expect(previousOf(versions, "m3.1")).toBeNull();
    expect(previousOf(versions, "nope")).toBeNull();
  });
});
