import { describe, expect, it } from "vitest";
import { parseSources, sourcesOf } from "./sources";
import { winners } from "../routes/ComparePage";
import type { ChatPart } from "./types";

// The shape written by describe() in core/knowledge.py.
const OUTPUT = [
  "[1] deck.pptx · p.2 · C:/kb/deck.pptx",
  "Revenue grew",
  "",
  "[2] lease.txt · C:/kb/lease.txt",
  "The rent is 400",
  "",
  "Answer ONLY from these passages, like [1].",
].join("\n");

describe("sources", () => {
  it("reads the file, page and path of each passage", () => {
    expect(parseSources(OUTPUT)).toEqual([
      { n: 1, file: "deck.pptx", page: 2, path: "C:/kb/deck.pptx" },
      { n: 2, file: "lease.txt", page: null, path: "C:/kb/lease.txt" },
    ]);
  });

  const parts: ChatPart[] = [{ kind: "tool", id: "1", tool: "knowledge_search", args: {}, ok: true, output: OUTPUT }];

  it("lists what the reply cites, or everything it was given when it cites nothing", () => {
    expect(sourcesOf(parts, "The rent is 400 [2].").map((s) => s.n)).toEqual([2]);
    expect(sourcesOf(parts, "The rent is 400.").map((s) => s.n)).toEqual([1, 2]);
    expect(sourcesOf([{ kind: "text", text: "hi" }], "hi")).toEqual([]);
  });
});

describe("comparing", () => {
  const result = (cost_usd: number, total_ms: number) => ({ first_ms: 1, total_ms, prompt_tokens: 1, completion_tokens: 1, cost_usd });

  it("marks the cheapest and the quickest once both finished", () => {
    expect(winners([{ id: "a", result: result(0.1, 900) }, { id: "b", result: result(0.2, 400) }])).toEqual({ cheapest: "a", fastest: "b" });
    expect(winners([{ id: "a", result: result(0.1, 900) }, { id: "b" }])).toEqual({});
  });

  it("names no cheapest when a price is unknown", () => {
    expect(winners([{ id: "a", result: result(0, 900) }, { id: "b", result: result(0.2, 400) }]).cheapest).toBeUndefined();
  });
});
