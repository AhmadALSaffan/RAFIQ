import { describe, expect, it } from "vitest";
import { bodyOf, lineRange, newFilePath, skillTemplate } from "./skillDraft";

describe("skill editor helpers", () => {
  it("shows the body without the front matter", () => {
    expect(bodyOf("---\nname: x\ndescription: y\n---\n\n# Title\nText")).toBe("# Title\nText");
    expect(bodyOf("# No header")).toBe("# No header");
  });

  it("turns a typed name into a safe file inside the skill", () => {
    expect(newFilePath("reference", "Style guide")).toBe("Style-guide.md");
    expect(newFilePath("reference", "notes.md")).toBe("notes.md");
    expect(newFilePath("command", "Release Notes")).toBe("commands/release-notes.md");
    expect(newFilePath("reference", "../../etc")).toBe("etc.md");
    expect(newFilePath("command", "   ")).toBeNull();
  });

  it("starts a new skill with a header the check accepts", () => {
    const draft = skillTemplate();
    expect(draft.startsWith("---\nname: my-skill\ndescription: ")).toBe(true);
    expect(bodyOf(draft).length).toBeGreaterThan(0);
  });

  it("finds a line's offsets to select it", () => {
    const text = "a\nbc\ndef";
    expect(lineRange(text, 1)).toEqual([0, 1]);
    expect(lineRange(text, 2)).toEqual([2, 4]);
    expect(lineRange(text, 9)).toEqual([5, 8]);
  });
});
