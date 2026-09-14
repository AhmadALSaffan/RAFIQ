import { describe, expect, it } from "vitest";
import { applyEvent, textOf, type Draft } from "./draft";

const empty: Draft = { parts: [], reasoning: "" };

describe("applyEvent", () => {
  it("appends text deltas into a single part", () => {
    const a = applyEvent(empty, { type: "delta", text: "مر" });
    const b = applyEvent(a, { type: "delta", text: "حبا" });
    expect(b.parts).toHaveLength(1);
    expect(textOf(b.parts)).toBe("مرحبا");
  });

  it("starts a new text part after a tool step", () => {
    let draft = applyEvent(empty, { type: "delta", text: "قبل" });
    draft = applyEvent(draft, { type: "tool_call", id: "1", tool: "shell_run", args: {} });
    draft = applyEvent(draft, { type: "delta", text: "بعد" });
    expect(draft.parts.map((p) => p.kind)).toEqual(["text", "tool", "text"]);
    expect(textOf(draft.parts)).toBe("قبلبعد");
  });

  it("fills a tool result into the matching call", () => {
    let draft = applyEvent(empty, { type: "tool_call", id: "t1", tool: "filesystem_list", args: { path: "." } });
    draft = applyEvent(draft, { type: "tool_result", id: "t1", ok: true, output: "a\nb" });
    const tool = draft.parts[0];
    expect(tool.kind === "tool" && tool.ok).toBe(true);
    expect(tool.kind === "tool" && tool.output).toBe("a\nb");
  });

  it("keeps reasoning out of the visible parts", () => {
    const draft = applyEvent(empty, { type: "reasoning", text: "بفكر" });
    expect(draft.parts).toHaveLength(0);
    expect(draft.reasoning).toBe("بفكر");
  });

  it("resolves a permission in place", () => {
    let draft = applyEvent(empty, {
      type: "permission",
      id: "p1",
      call: { tool: "shell_run", category: "exec", args: {} },
    });
    draft = applyEvent(draft, { type: "permission_resolved", id: "p1", resolution: "denied" });
    const part = draft.parts[0];
    expect(part.kind === "permission" && part.resolution).toBe("denied");
  });

  it("adds a card for a task the model created", () => {
    const draft = applyEvent(empty, {
      type: "task_created",
      task: { id: "t9", title: "رتّب الملفات", status: "queued" },
    });
    expect(draft.parts[0]).toMatchObject({ kind: "task", task_id: "t9" });
  });

  it("ignores events it doesn't know", () => {
    // @ts-expect-error — deliberately unknown event shape
    expect(applyEvent(empty, { type: "nonsense" })).toBe(empty);
  });
});
