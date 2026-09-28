import { describe, expect, it } from "vitest";
import { fillPrompt, titleFrom, variablesOf } from "./prompts";

// Arabic names built from code points, so the source stays free of Arabic string literals.
const FILE = String.fromCharCode(0x645, 0x644, 0x641); // "ملف"
const LANG = String.fromCharCode(0x644, 0x63a, 0x629); // "لغة"

describe("prompt variables", () => {
  it("finds each name once, in order, Arabic and spaces included", () => {
    const body = `Review {{${FILE}}} in {{ ${LANG} }}, then {{${FILE}}} for {{client name}}.`;
    expect(variablesOf(body)).toEqual([FILE, LANG, "client name"]);
  });

  it("ignores single braces and empty names", () => {
    expect(variablesOf("no {vars} here, nor {{}} or {{   }}")).toEqual([]);
  });

  it("fills what was given and leaves the rest visible", () => {
    const body = `Review {{${FILE}}} in {{ ${LANG} }} — again {{${FILE}}}`;
    expect(fillPrompt(body, { [FILE]: "main.py", [LANG]: " " })).toBe(`Review main.py in {{ ${LANG} }} — again main.py`);
  });

  it("titles a prompt by its first line, short", () => {
    expect(titleFrom("  Fix the bug\nwith details")).toBe("Fix the bug");
    expect(titleFrom("x".repeat(80))).toHaveLength(58);
  });
});
