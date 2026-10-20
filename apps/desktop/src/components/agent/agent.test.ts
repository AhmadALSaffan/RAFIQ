import { describe, expect, it } from "vitest";
import { byFolder, diffOf } from "./CommitSummary";
import { buildTree, treeOrder } from "./FileTree";
import { thoughtSteps } from "./ThoughtChain";
import { nextReveal } from "../../lib/smoothText";
import { argsSubtitle, prettyOutput } from "../steps";
import { docTemplates, templatePrompt } from "../../lib/docTemplates";
import type { ChangedFile } from "../../lib/types";

const file = (path: string, additions = 1, deletions = 0): ChangedFile => ({ path, status: "modified", additions, deletions, binary: false });

describe("commit summary", () => {
  it("groups files by folder, root first", () => {
    const groups = byFolder([file("src/a.ts"), file("README.md"), file("src/b.ts"), file("src/lib/c.ts")]);
    expect(groups.map(([dir, list]) => [dir, list.length])).toEqual([["", 1], ["src", 2], ["src/lib", 1]]);
  });

  it("finds one file's part of a diff", () => {
    const diff = "diff --git a/x.ts b/x.ts\n+one\ndiff --git a/src/y.ts b/src/y.ts\n+two\n";
    expect(diffOf(diff, "src/y.ts")).toBe("diff --git a/src/y.ts b/src/y.ts\n+two\n");
    expect(diffOf(diff, "z.ts")).toBe("");
  });
});

describe("file tree", () => {
  it("builds folders first, then files, by name", () => {
    const tree = buildTree(["src/b.ts", "src/a/x.ts", "README.md", "src/a.ts"]);
    expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
    expect(tree[0].children!.map((n) => n.name)).toEqual(["a", "a.ts", "b.ts"]);
    expect(treeOrder(["src/b.ts", "src/a/x.ts", "README.md", "src/a.ts"])).toEqual(["src/a/x.ts", "src/a.ts", "src/b.ts", "README.md"]);
  });
});

describe("thought chain", () => {
  it("makes a step of each paragraph, and cuts a very long one at sentence ends", () => {
    const a = "First idea, long enough to be a step of its own: ".repeat(7).trim();
    const b = "Second idea, long enough as well, so it stays apart: ".repeat(7).trim();
    expect(thoughtSteps(`${a}\n\n${b}`)).toEqual([a, b]);
    // short lines fold into their neighbours
    expect(thoughtSteps("Plan shots:\n\nPalette:\n\nFonts:")).toEqual(["Plan shots:\nPalette:\nFonts:"]);
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} goes here.`).join(" ");
    const steps = thoughtSteps(long);
    expect(steps.length).toBeGreaterThan(1);
    for (const s of steps) expect(s.endsWith(".")).toBe(true);
  });
});

describe("streaming text", () => {
  it("reveals whole words, faster when far behind", () => {
    const text = "one two three four five six";
    expect(text.slice(0, nextReveal(text, 0))).toBe("one two ");
    expect(nextReveal(text, text.length)).toBe(text.length);
    const big = Array.from({ length: 400 }, () => "word").join(" ");
    expect(nextReveal(big, 0)).toBeGreaterThan(40);
  });
});

describe("tool cards", () => {
  it("sorts the arguments into one line, and pretty-prints JSON output", () => {
    expect(argsSubtitle({ query: "payment", path: "a.md" })).toBe("path: a.md · query: payment");
    expect(prettyOutput('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', json: true });
    expect(prettyOutput("plain text")).toEqual({ text: "plain text", json: false });
  });
});

describe("document templates", () => {
  it("says what's known, asks for what's missing, and names the tool and file", () => {
    const cv = docTemplates().find((x) => x.id === "cv")!;
    const prompt = templatePrompt(cv, { name: "سارة", role: "مصممة" });
    expect(prompt).toContain("سارة");
    expect(prompt).toContain("word_write");
    expect(prompt).toContain(cv.fields.find((f) => f.key === "education")!.label);
    expect(prompt).not.toContain(`${cv.fields.find((f) => f.key === "name")!.label}،`);
    const full = Object.fromEntries(cv.fields.map((f) => [f.key, "x"]));
    expect(templatePrompt(cv, full)).not.toContain(cv.fields[0].label + "،");
  });

  it("covers Word, Excel and PowerPoint", () => {
    expect(new Set(docTemplates().map((x) => x.tool))).toEqual(new Set(["word_write", "excel_write", "slides_write"]));
  });
});
