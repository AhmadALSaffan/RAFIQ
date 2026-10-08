/**
 * Text as outlines, for Lottie. The agent shapes each line with HarfBuzz from the same font
 * files the app draws with (rafiq_agent/motion/outline.py) and returns the glyph contours
 * ready for Lottie; lines are batched and remembered.
 */

import { request } from "../../../lib/api/client";

export interface Contour {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}

export interface Outline {
  /** Contours in px, origin at the start of the baseline, y down. */
  contours: Contour[];
  width: number;
}

export interface OutlineRequest {
  text: string;
  family: string;
  weight: number;
  px: number;
  dir: "rtl" | "ltr";
}

const cache = new Map<string, Outline>();
const key = (r: OutlineRequest) => `${r.family}|${r.weight}|${r.px.toFixed(2)}|${r.dir}|${r.text}`;

export async function outlineLines(lines: OutlineRequest[]): Promise<Outline[]> {
  const missing = lines.filter((l) => !cache.has(key(l)));
  for (let i = 0; i < missing.length; i += 200) {
    const batch = missing.slice(i, i + 200);
    const out = await request<Outline[]>("/motion/outline", { method: "POST", body: JSON.stringify({ lines: batch }) });
    batch.forEach((l, n) => cache.set(key(l), out[n]));
  }
  return lines.map((l) => cache.get(key(l))!);
}
