import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTextSize, stepTextSize, textSize } from "./textSize";

describe("text size", () => {
  beforeEach(() => {
    localStorage.clear();
    setTextSize("default");
  });

  it("saves the choice and scales the page", async () => {
    setTextSize("large");
    expect(localStorage.getItem("rafiq-text-size")).toBe("large");
    expect(textSize()).toBe("large");
    // outside the app there's no webview zoom, so CSS zoom stands in
    await vi.waitFor(() => expect(document.documentElement.style.zoom).toBe("1.12"));
  });

  it("steps one size at a time and stops at the ends", () => {
    stepTextSize(1);
    expect(textSize()).toBe("large");
    stepTextSize(1);
    stepTextSize(1);
    expect(textSize()).toBe("larger");
    for (let i = 0; i < 5; i++) stepTextSize(-1);
    expect(textSize()).toBe("small");
  });

  it("ignores a size it doesn't know", () => {
    setTextSize("huge" as never);
    expect(textSize()).toBe("default");
  });
});
