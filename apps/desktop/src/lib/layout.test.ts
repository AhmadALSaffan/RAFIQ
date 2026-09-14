import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, LIST_MAX, NAV_MIN, resetLayout, setLayout } from "./layout";

describe("layout preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    resetLayout();
  });

  it("clamps widths to what the UI can actually use", () => {
    setLayout({ nav: 10, list: 9999 });
    const saved = JSON.parse(localStorage.getItem("rafiq-layout") ?? "{}");
    expect(saved.nav).toBe(NAV_MIN);
    expect(saved.list).toBe(LIST_MAX);
  });

  it("persists a change and restores the defaults on reset", () => {
    setLayout({ reading: "full", navCollapsed: true });
    expect(JSON.parse(localStorage.getItem("rafiq-layout")!).reading).toBe("full");
    resetLayout();
    expect(JSON.parse(localStorage.getItem("rafiq-layout")!)).toMatchObject(DEFAULT_LAYOUT);
  });
});
