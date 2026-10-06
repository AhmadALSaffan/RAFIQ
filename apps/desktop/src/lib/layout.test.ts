import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, LIST_MAX, LIST_MIN, resetLayout, setLayout } from "./layout";

describe("layout preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    resetLayout();
  });

  it("clamps widths to what the UI can actually use", () => {
    setLayout({ list: 9999 });
    expect(JSON.parse(localStorage.getItem("rafiq-layout") ?? "{}").list).toBe(LIST_MAX);
    setLayout({ list: 10 });
    expect(JSON.parse(localStorage.getItem("rafiq-layout") ?? "{}").list).toBe(LIST_MIN);
  });

  it("persists a change and restores the defaults on reset", () => {
    setLayout({ reading: "full", listHidden: true });
    expect(JSON.parse(localStorage.getItem("rafiq-layout")!).reading).toBe("full");
    resetLayout();
    expect(JSON.parse(localStorage.getItem("rafiq-layout")!)).toMatchObject(DEFAULT_LAYOUT);
  });
});
