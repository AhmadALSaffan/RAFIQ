import { describe, expect, it } from "vitest";
import { MAX_QUICK_ACTIONS, actionMessage, builtinActions, draftAction, questionAbout } from "./quickAsk";
import type { QuickAction } from "./types";

describe("quick actions", () => {
  it("offers the five built-in actions, each with a prompt for the model", () => {
    const ids = builtinActions().map((a) => a.id);
    expect(ids).toEqual(["translate", "fix", "rephrase", "summarize", "reply"]);
    for (const action of builtinActions()) expect(action.prompt.length).toBeGreaterThan(20);
  });

  it("sends the text fenced under the instruction, and a question with the text it's about", () => {
    expect(actionMessage("  Make it formal. ", "مرحبا")).toBe('Make it formal.\n\n"""\nمرحبا\n"""');
    expect(questionAbout("شو معناها؟", "carpe diem")).toContain('"""\ncarpe diem\n"""');
  });

  it("keeps a new action tidy and refuses the ones that can't be saved", () => {
    const made = draftAction("  تغريدة ", " اكتبها تغريدة ", []);
    expect(typeof made).toBe("object");
    expect(made).toMatchObject({ label: "تغريدة", prompt: "اكتبها تغريدة" });
    expect(typeof draftAction("", "x", [])).toBe("string");
    expect(typeof draftAction("x".repeat(41), "x", [])).toBe("string");
    // A name a built-in action already has.
    expect(typeof draftAction(builtinActions()[0].label, "x", [])).toBe("string");
  });

  it("edits an action in place, and stops adding at the limit", () => {
    const one: QuickAction = { id: "a1", label: "رسمي", prompt: "رسمي" };
    const edited = draftAction("رسمي", "بلغة رسمية", [one], "a1");
    expect(edited).toEqual({ id: "a1", label: "رسمي", prompt: "بلغة رسمية" });
    const full = Array.from({ length: MAX_QUICK_ACTIONS }, (_, i) => ({ id: `a${i}`, label: `n${i}`, prompt: "p" }));
    expect(typeof draftAction("جديد", "p", full)).toBe("string");
    expect(typeof draftAction("n0", "changed", full, "a0")).toBe("object");
  });
});
