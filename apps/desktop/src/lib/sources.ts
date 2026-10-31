/**
 * Where a reply's facts came from: read from what the knowledge_search tool actually returned,
 * not from what the model says, so the list under a reply can be trusted. The header lines
 * are written by `describe` in core/knowledge.py; keep the two in step.
 */

import type { ChatPart } from "./types";

export interface Source {
  n: number;
  file: string;
  page: number | null;
  path: string;
}

const HEADER = /^\[(\d+)\] (.+?) · (?:p\.(\d+) · )?(.+)$/gm;

export function parseSources(output: string): Source[] {
  const found: Source[] = [];
  for (const m of output.matchAll(HEADER)) {
    found.push({ n: Number(m[1]), file: m[2], page: m[3] ? Number(m[3]) : null, path: m[4].trim() });
  }
  return found;
}

/** The sources the reply actually cites, or all it was given when it cites none by number. */
export function sourcesOf(parts: ChatPart[], text: string): Source[] {
  const all = parts.flatMap((p) => (p.kind === "tool" && p.tool === "knowledge_search" && p.ok ? parseSources(p.output ?? "") : []));
  const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const used = all.filter((s) => cited.has(s.n));
  return used.length ? used : all;
}
