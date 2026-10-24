/**
 * The director's review (`motion_review`): the video cut into its shots, each one measured
 * the way a motion designer looks at it — is there a hero, is the type big enough, does the
 * content fill the frame and sit in the middle, does anything live while it holds, how long
 * the transitions take. A model that can't see gets concrete notes per shot to fix:
 *   shot 2 · 2.60→6.00s (3.4s) · measured at 4.40s
 *   ✗ the biggest text is 52px — no hero. Make the key word 120–300px.
 */

import type { MotionEngine } from "./engine";
import type { DrawItem, Layer } from "./types";

export interface Shot {
  index: number;
  start: number;
  end: number;
  at: number;
  notes: string[];
  good: string[];
}

const flat = (items: DrawItem[]): DrawItem[] => items.flatMap((i) => (i.children?.length ? [i, ...flat(i.children)] : [i]));

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lives through (nearly) the whole video: background decor, music visuals, a frame. */
function isDecor(layer: Layer, duration: number): boolean {
  if (layer.type === "text" || layer.type === "captions" || layer.important === true) return false;
  return layer.end - layer.start >= duration * 0.8;
}

/** A short layer that covers the whole frame for an instant: a wipe or colour-panel cut. */
function isPanel(item: DrawItem, width: number, height: number): boolean {
  const life = item.layer.end - item.layer.start;
  return item.type === "shape" && life <= 1.6 && item.box.w >= width * 0.8 && item.box.h >= height * 0.8;
}

/** Where the cuts are: a moment where some content ends and other content begins. */
function cuts(layers: Layer[], duration: number): number[] {
  const content = layers.filter((l) => !isDecor(l, duration) && l.end - l.start > 1.2);
  const found: number[] = [];
  for (const end of [...new Set(content.map((l) => r1(l.end)))].sort((a, b) => a - b)) {
    if (end >= duration - 0.3) continue;
    const begins = content.some((l) => Math.abs(l.start - end) <= 0.4);
    if (begins && end - (found[found.length - 1] ?? 0) >= 1) found.push(end);
  }
  return found;
}

export function reviewScene(engine: MotionEngine): { shots: Shot[]; overall: string[] } {
  const scene = engine.scene;
  const comp = scene.composition;
  const { width: W, height: H, duration } = comp;
  const short = Math.min(W, H);
  const vertical = H > W * 1.2;
  const top = scene.layers;
  const bounds = [0, ...cuts(top, duration), duration];
  // transitions: short layers that cover the frame at their middle
  const panels = new Map<string, number>();
  for (const l of top) {
    const life = l.end - l.start;
    if (l.type !== "shape" || life > 1.6) continue;
    const it = flat(engine.frame((l.start + l.end) / 2).items).find((i) => i.id === l.id);
    if (it && isPanel(it, W, H)) panels.set(l.id, life);
  }
  // a panel that grows from the middle shows as a box floating in the frame on its way
  const floating = [...panels.keys()].filter((id) => {
    const l = top.find((x) => x.id === id)!;
    const it = flat(engine.frame(l.start + (l.end - l.start) * 0.25).items).find((i) => i.id === id);
    if (!it || it.opacity < 0.3) return false;
    const b = it.bounds;
    const cover = (Math.min(W, b.x + b.w) - Math.max(0, b.x)) * (Math.min(H, b.y + b.h) - Math.max(0, b.y)) / (W * H);
    const edge = b.x <= 1 || b.y <= 1 || b.x + b.w >= W - 1 || b.y + b.h >= H - 1;
    return cover > 0.02 && cover < 0.6 && !edge;
  });
  const shots: Shot[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const len = end - start;
    // the shot settled: entrances done, before it leaves
    const at = r2(start + Math.min(Math.max(1.2, len * 0.55), len - 0.35));
    const frame = engine.frame(at);
    const all = flat(frame.items).filter((it) => it.opacity > 0.05);
    const seen = all.filter((it) => !isPanel(it, W, H) && !isDecor(it.layer, duration) && it.type !== "group");
    const notes: string[] = [];
    const good: string[] = [];

    if (!seen.length) {
      notes.push("nothing of this shot is on screen at the moment measured — it's empty or still entering. Content should be settled by 1s into a shot.");
      shots.push({ index: i + 1, start, end, at, notes, good });
      continue;
    }

    // ── type: a hero and readable text ──
    const texts = seen.filter((it) => (it.type === "text" || it.type === "captions") && it.fontPx);
    const px = (it: DrawItem) => Math.round(((it.fontPx ?? 0) * 1080) / short);
    if (texts.length) {
      const sizes = texts.map(px).sort((a, b) => b - a);
      const biggest = sizes[0];
      const smallest = sizes[sizes.length - 1];
      if (biggest < 88) notes.push(`the biggest text is ${biggest}px — the shot has no hero. Give its key word or number 120–300px (a "size" on that layer) and keep the rest smaller.`);
      else if (texts.length > 1 && sizes[1] >= biggest * 0.85) notes.push(`the two biggest texts are ${biggest}px and ${sizes[1]}px — nearly equal, so nothing leads. Make one clearly bigger (×1.6 or more) or the other smaller.`);
      else good.push(`hero text ${biggest}px`);
      const floor = vertical ? 32 : 28;
      if (smallest < floor) notes.push(`a text is ${smallest}px — too small to read on a phone. Nothing under ${floor}px; body text 44–52, captions and tags 32–40.`);
    } else if (!seen.some((it) => it.type === "image" || it.type === "video")) {
      const biggest = seen.reduce((a, b) => (a.bounds.w * a.bounds.h > b.bounds.w * b.bounds.h ? a : b));
      if (biggest.bounds.w * biggest.bounds.h < W * H * 0.06) notes.push("no text and no element bigger than 6% of the frame — the shot has no focal point. Make one element big.");
    }

    // ── composition: fill and centre ──
    const x0 = Math.min(...seen.map((it) => it.bounds.x));
    const y0 = Math.min(...seen.map((it) => it.bounds.y));
    const x1 = Math.max(...seen.map((it) => it.bounds.x + it.bounds.w));
    const y1 = Math.max(...seen.map((it) => it.bounds.y + it.bounds.h));
    const fillW = (x1 - x0) / W;
    const fillH = (y1 - y0) / H;
    const centre = (y0 + y1) / 2 / H;
    const area = fillW * fillH;
    if (area < 0.15 || fillW < 0.45)
      notes.push(
        `the content block is ${Math.round(fillW * 100)}% of the width × ${Math.round(fillH * 100)}% of the height (${Math.round(area * 100)}% of the frame) — it floats small in an empty frame. Aim for ${vertical ? "75–95% of the width and 25–60% of the height" : "50–85% of the width and 30–70% of the height"}: bigger type, wider cards, more gap between elements.`,
      );
    else good.push(`fills ${Math.round(fillW * 100)}% × ${Math.round(fillH * 100)}% of the frame`);
    if (centre < 0.36) notes.push(`the content's centre sits at ${Math.round(centre * 100)}% of the height — too high, the bottom half is empty. Move the group down so its centre is at 42–55%.`);
    else if (centre > 0.64) notes.push(`the content's centre sits at ${Math.round(centre * 100)}% of the height — too low (the platform UI covers the bottom). Centre it at 42–55%.`);
    if (seen.length > 14) notes.push(`${seen.length} elements at once — busy. One idea per shot; split it into two shots or cut elements.`);

    // ── life: does anything move while the shot holds? ──
    const holdFrom = at;
    const holdTo = end - 0.4;
    if (holdTo - holdFrom > 1.4) {
      const later = new Map(flat(engine.frame(holdTo).items).map((it) => [it.id, it]));
      const moving = seen.some((it) => {
        const b = later.get(it.id);
        if (!b) return false;
        return Math.abs(b.bounds.x - it.bounds.x) + Math.abs(b.bounds.y - it.bounds.y) > short * 0.004 || Math.abs(b.scale - it.scale) > 0.01 || Math.abs(b.rotation - it.rotation) > 0.5;
      });
      if (!moving) notes.push(`nothing moves for ${r1(holdTo - holdFrom)}s while the shot holds — it reads as a still slide. Give the hero a slow push (scale 1→1.05 over the hold), a float, or animate a detail late in the shot.`);
      else good.push("alive while it holds");
    }

    // ── staging: everything at once? ──
    const enters = top
      .filter((l) => l.start < end && l.end > start && !isDecor(l, duration))
      .flatMap((l) => (l.animate ?? []).map((a) => a.at ?? l.start))
      .filter((t) => t >= start && t <= start + len * 0.6);
    if (seen.length >= 3 && enters.length >= 3 && Math.max(...enters) - Math.min(...enters) < 0.15)
      notes.push("every element enters at the same moment — no staging. Lead with the hero, then the rest 0.1–0.2s apart.");

    shots.push({ index: i + 1, start, end, at, notes, good });
  }

  // ── the whole video ──
  const overall: string[] = [];
  if (floating.length)
    overall.push(`transition${floating.length > 1 ? "s" : ""} ${floating.map((id) => `"${id}"`).join(", ")} show${floating.length > 1 ? "" : "s"} as a box floating mid-frame on the way in and out — it reads as a mistake. Use the sweep preset (the panel crosses from edge to edge) instead of scaling it from the middle.`);
  for (const [id, life] of panels) if (life > 0.8) overall.push(`transition "${id}" covers the screen for ${r1(life)}s — slow; a cut panel crosses in 0.4–0.6s (the cut ±0.28s).`);
  if (!scene.palette || !Object.keys(scene.palette).length) overall.push("no scene.palette — the video uses the default kit colours. Choose colours for this video's idea.");
  if (!scene.fonts || !Object.keys(scene.fonts).length) overall.push("no scene.fonts — the video uses the default fonts. Pick a display/body pair that fits the idea.");
  const bg = comp.background;
  const flatBg = !bg || typeof bg === "string" || (bg as { type?: string }).type === "solid";
  if (flatBg && !top.some((l) => isDecor(l, duration) && l.type === "shape")) overall.push("a flat background with no decor — add depth: a gradient background, a soft large shape drifting slowly, or a texture.");
  if (shots.length < 3 && duration >= 8) overall.push(`only ${shots.length} shot${shots.length === 1 ? "" : "s"} in ${r1(duration)}s — reels cut every 2–4s. Split the idea into more shots.`);
  const long = shots.filter((s) => s.end - s.start > 5.5);
  if (long.length) overall.push(`shot${long.length > 1 ? "s" : ""} ${long.map((s) => s.index).join(", ")} hold${long.length > 1 ? "" : "s"} over 5.5s — cut sooner or add a second beat inside.`);
  return { shots, overall };
}

export function formatReview(review: ReturnType<typeof reviewScene>): string {
  const lines: string[] = [];
  for (const s of review.shots) {
    lines.push(`shot ${s.index} · ${s.start.toFixed(2)}→${s.end.toFixed(2)}s (${(s.end - s.start).toFixed(1)}s) · measured at ${s.at.toFixed(2)}s`);
    for (const n of s.notes) lines.push(`  ✗ ${n}`);
    if (s.good.length) lines.push(`  ✓ ${s.good.join(" · ")}`);
    if (!s.notes.length) lines.push("  (nothing to fix here)");
  }
  if (review.overall.length) {
    lines.push("", "the whole video:");
    for (const n of review.overall) lines.push(`  ✗ ${n}`);
  }
  const count = review.shots.reduce((n, s) => n + s.notes.length, 0) + review.overall.length;
  lines.push("", count ? `${count} note${count === 1 ? "" : "s"} to fix.` : "no notes — the video passes the review ✓");
  return lines.join("\n");
}
