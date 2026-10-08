/**
 * The frame report (`motion_inspect`): what's on screen at a moment, where, how big, how
 * readable — written for a model that can't see images, in the doc's format:
 *   t=2.40s · 1080×1920 · safe area: reels
 *   - title "قهوة مختصة"  box(312,700 → 768,820)  style display  contrast 7.9:1  ✓
 */

import { contrastRatio, hexToRgb, paintColor, relLuminance } from "./brand";
import type { MotionEngine } from "./engine";
import { lintScene, safeZones, type Issue } from "./lint";
import { makeCanvas, renderBelow, type Ctx } from "./render";
import type { Box, DrawItem } from "./types";

const fmt = (b: Box) => `box(${Math.round(b.x)},${Math.round(b.y)} → ${Math.round(b.x + b.w)},${Math.round(b.y + b.h)})`;

function flat(items: DrawItem[]): DrawItem[] {
  return items.flatMap((i) => (i.children?.length ? [i, ...flat(i.children)] : [i]));
}

function meanBackground(ctx: Ctx, box: Box, scale: number): number {
  const x = Math.max(0, Math.floor(box.x * scale));
  const y = Math.max(0, Math.floor(box.y * scale));
  const w = Math.max(1, Math.floor(box.w * scale));
  const h = Math.max(1, Math.floor(box.h * scale));
  const data = ctx.getImageData(x, y, w, h).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += relLuminance([data[i], data[i + 1], data[i + 2]]);
    n++;
  }
  return n ? sum / n : 0;
}

export async function inspectFrames(engine: MotionEngine, times: number[], known?: Issue[]): Promise<string> {
  const comp = engine.scene.composition;
  const issues = known ?? (await lintScene(engine));
  const scale = Math.min(0.5, 480 / Math.max(comp.width, comp.height));
  const canvas = makeCanvas(comp.width * scale, comp.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as Ctx;
  const zones = safeZones(engine.scene);
  const blocks: string[] = [];
  for (const time of times) {
    const t = Math.max(0, Math.min(comp.duration - 1e-3, time));
    const frame = engine.frame(t);
    const lines = [`t=${t.toFixed(2)}s · ${comp.width}×${comp.height} · safe area: ${comp.safeArea ?? "none"}`];
    const items = flat(frame.items);
    if (!items.length) lines.push("- (nothing visible)");
    for (const item of items) {
      const near = issues.filter((i) => i.layer === item.id && (i.t === null || Math.abs(i.t - t) < 1.5));
      const parts = [`- ${item.id}`];
      if (item.textValue !== undefined && item.type === "text") parts.push(`"${item.textValue.slice(0, 40)}"`);
      else parts.push(`(${item.type}${item.layer.icon ? ` ${item.layer.icon}` : ""})`);
      parts.push(fmt(item.bounds));
      if (item.layer.style) parts.push(`style ${item.layer.style}`);
      if (item.opacity < 0.99) parts.push(`opacity ${item.opacity.toFixed(2)}`);
      if (Math.abs(item.scale - 1) > 0.01) parts.push(`scale ${item.scale.toFixed(2)}`);
      if ((item.type === "text" || item.type === "captions") && item.color) {
        let bg: number;
        if (item.layer.background?.color) bg = relLuminance(hexToRgb(paintColor(engine.kit, item.layer.background.color)));
        else {
          renderBelow(ctx, frame, engine.resources, item.z, scale);
          bg = meanBackground(ctx, item.bounds, scale);
        }
        parts.push(`contrast ${contrastRatio(relLuminance(hexToRgb(item.color)), bg).toFixed(1)}:1`);
      }
      const inZone = zones.some((z) => {
        const w = Math.min(z.x + z.w, item.bounds.x + item.bounds.w) - Math.max(z.x, item.bounds.x);
        const h = Math.min(z.y + z.h, item.bounds.y + item.bounds.h) - Math.max(z.y, item.bounds.y);
        return w > 1 && h > 1;
      });
      if (inZone) parts.push("in UI zone");
      parts.push(near.length ? `✗ ${near.map((i) => i.code).join(" ")}` : "✓");
      lines.push(parts.join("  "));
    }
    // gaps between stacked texts, in units
    const texts = items.filter((i) => i.type === "text").sort((a, b) => a.bounds.y - b.bounds.y);
    const gaps: string[] = [];
    for (let i = 1; i < texts.length; i++) {
      const gap = texts[i].bounds.y - (texts[i - 1].bounds.y + texts[i - 1].bounds.h);
      gaps.push(`${texts[i - 1].id}→${texts[i].id} ${Math.round(gap)}px (${(gap / engine.prepared.unit).toFixed(1)} units)`);
    }
    if (gaps.length) lines.push(`gaps: ${gaps.join(" · ")}`);
    blocks.push(lines.join("\n"));
  }
  const summary = issues.length
    ? `\nissues (${issues.length}): ${issues.slice(0, 20).map((i) => `${i.code}${i.layer ? `[${i.layer}]` : ""}`).join(", ")}`
    : "\nissues: none ✓";
  return blocks.join("\n\n") + summary;
}
