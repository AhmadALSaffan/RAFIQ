import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../lib/types";
import { bookmarkedOf, excerptOf } from "./bookmarks";

const msg = (id: string, created_at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: "assistant",
  content: `message ${id}`,
  created_at,
  ...extra,
});

describe("bookmarks", () => {
  it("names a message by its start, on one line", () => {
    expect(excerptOf({ content: "  Put the\n\ninvoices   by month  " })).toBe("Put the invoices by month");
    expect(excerptOf({ content: "x".repeat(200) }, 20)).toBe(`${"x".repeat(19)}…`);
  });

  it("names a reply made of tool calls by its text part", () => {
    const parts = [
      { kind: "tool", tool: "list_dir", args: {} },
      { kind: "text", text: "Found 12\ninvoices." },
    ] as ChatMessage["parts"];
    expect(excerptOf({ content: "", parts })).toBe("Found 12 invoices.");
    expect(excerptOf({ content: "", parts: [] })).toBe("");
  });

  it("lists only starred messages, in conversation order", () => {
    const messages = [
      msg("c", "2026-09-29T10:02:00Z", { bookmarked_at: "2026-09-29T11:00:00Z" }),
      msg("a", "2026-09-29T10:00:00Z", { bookmarked_at: "2026-09-29T12:00:00Z" }),
      msg("b", "2026-09-29T10:01:00Z", { bookmarked_at: null }),
      msg("d", "2026-09-29T10:03:00Z"),
    ];
    expect(bookmarkedOf(messages).map((m) => m.id)).toEqual(["a", "c"]);
  });
});
