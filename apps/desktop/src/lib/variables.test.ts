import { describe, expect, it } from "vitest";
import { defaultFor, fillPrompt, localDate, variablesOf } from "./variables";

const FOLDER_AR = String.fromCharCode(0x645, 0x62c, 0x644, 0x62f); // "مجلد"
const BRANCH_AR = String.fromCharCode(0x627, 0x644, 0x641, 0x631, 0x639); // "الفرع"
const ctx = { folder: "C:\\work\\shop", branch: "feature/cart", today: "2026-10-04" };

describe("template blanks", () => {
  it("collects the blanks of several texts once, in order", () => {
    expect(variablesOf("Review {{branch}} against {{base}}", "PR {{branch}}")).toEqual(["branch", "base"]);
  });

  it("fills well-known blanks from the task, in any language", () => {
    expect(defaultFor("folder", ctx)).toBe("C:\\work\\shop");
    expect(defaultFor(FOLDER_AR, ctx)).toBe("C:\\work\\shop");
    expect(defaultFor("Branch", ctx)).toBe("feature/cart");
    expect(defaultFor(BRANCH_AR, ctx)).toBe("feature/cart");
    expect(defaultFor("today", ctx)).toBe("2026-10-04");
    expect(defaultFor("git_branch", ctx)).toBe("feature/cart");
    expect(defaultFor("customer", ctx)).toBe("");
    expect(defaultFor("branch", { today: "x" })).toBe("");
  });

  it("puts the values in, leaving unfilled blanks visible", () => {
    expect(fillPrompt("Review {{branch}} against {{base}}", { branch: "feature/cart", base: " " })).toBe("Review feature/cart against {{base}}");
  });

  it("writes today as YYYY-MM-DD in local time", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
