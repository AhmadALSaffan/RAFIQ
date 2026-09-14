/**
 * The in-progress assistant reply.
 *
 * A reply arrives as a stream of small events; this reducer folds them into the ordered
 * parts the transcript renders (text, tool steps, permission prompts, created tasks).
 * Pure on purpose — it's the piece worth unit-testing.
 */

import type { ChatStreamEvent } from "../../lib/api";
import type { ChatPart } from "../../lib/types";

export type Draft = { parts: ChatPart[]; reasoning: string };

/** Tool steps the transcript never shows — internal reading, not work the user asked for. */
export const SILENT_TOOLS = new Set(["skill_read", "skill_list"]);


export function applyEvent(draft: Draft, ev: ChatStreamEvent): Draft {
  const parts = draft.parts;
  switch (ev.type) {
    case "reasoning":
      return { ...draft, reasoning: draft.reasoning + ev.text };
    case "delta": {
      const last = parts[parts.length - 1];
      if (last?.kind === "text") return { ...draft, parts: [...parts.slice(0, -1), { ...last, text: last.text + ev.text }] };
      return { ...draft, parts: [...parts, { kind: "text", text: ev.text }] };
    }
    case "tool_call":
      return { ...draft, parts: [...parts, { kind: "tool", id: ev.id, tool: ev.tool, args: ev.args }] };
    case "tool_result":
      return { ...draft, parts: parts.map((p) => (p.kind === "tool" && p.id === ev.id ? { ...p, ok: ev.ok, output: ev.output } : p)) };
    case "permission":
      return { ...draft, parts: [...parts, { kind: "permission", id: ev.id, call: ev.call, resolution: "pending" }] };
    case "permission_resolved":
      return { ...draft, parts: parts.map((p) => (p.kind === "permission" && p.id === ev.id ? { ...p, resolution: ev.resolution } : p)) };
    case "task_created":
      return { ...draft, parts: [...parts, { kind: "task", task_id: ev.task.id, title: ev.task.title }] };
    default:
      return draft;
  }
}

export function textOf(parts: ChatPart[]): string {
  return parts.map((p) => (p.kind === "text" ? p.text : "")).join("");
}
