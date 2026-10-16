import { describe, expect, it, vi } from "vitest";
import { isGuideKind, onGuide, showGuide } from "./guides";

describe("guides", () => {
  it("opens the guide for a known kind, with the provider's display name", () => {
    const seen = vi.fn();
    const off = onGuide(seen);
    expect(showGuide({ kind: "bad_key", provider: "openai" })).toBe(true);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ kind: "bad_key", provider: "OpenAI" }));
    off();
  });

  it("ignores failures without a guide", () => {
    const seen = vi.fn();
    const off = onGuide(seen);
    expect(showGuide({ kind: null })).toBe(false);
    expect(showGuide({ kind: "something_else" })).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it("opens once when several requests fail for the same reason", () => {
    const seen = vi.fn();
    const off = onGuide(seen);
    showGuide({ kind: "region_blocked" });
    showGuide({ kind: "region_blocked" });
    showGuide({ kind: "region_blocked" });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("knows its kinds", () => {
    expect(isGuideKind("copilot_not_enabled")).toBe(true);
    expect(isGuideKind("nope")).toBe(false);
  });
});
