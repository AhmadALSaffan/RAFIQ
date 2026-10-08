/**
 * The scene as a Lottie file that plays the same everywhere (doc: «Lottie — بتشتغل بكل
 * مكان»). Only a conservative subset is written — shape layers, fills and strokes, paths,
 * transforms, opacity, trim paths and simple masks — and text becomes outlines. Motion is
 * baked from the engine itself (every frame, redundant keys dropped), so whatever the engine
 * draws, the file reproduces, whatever player opens it.
 */

import { hexToRgb, isGradient, paintColor, resolveColor } from "./brand";
import { shapeLines } from "./render";
import { isColourIcon } from "./iconSets";
import type { MotionEngine } from "./engine";
import { allLayers } from "./engine";
import { icon } from "./icons";
import { outlineLines, type Contour } from "./outline";
import { rectPath, type Polyline } from "./paths";
import type { DrawItem, Layer } from "./types";

type Json = Record<string, unknown>;

/** Why this layer can't go into a Lottie file (null = it can). */
export function lottieBlocker(layer: Layer): string | null {
  if (layer.type === "video" || layer.type === "image" || layer.type === "lottie") return "picture";
  if (layer.type === "icon" && isColourIcon(layer.icon)) return "picture";
  if (layer.type === "captions") return "captions";
  if (layer.type === "chart" && (layer.chart === "pie" || layer.chart === "number")) return "chart";
  if (layer.blend && layer.blend !== "normal") return "blend";
  if (layer.shadow || layer.glow) return "shadow";
  if (isGradient(layer.fill) || isGradient(layer.color) || isGradient(layer.background?.color)) return "gradient";
  if (layer.outline || layer.dash) return "outline";
  if ((layer.animate ?? []).some((a) => a.preset === "blurIn")) return "blur";
  if (layer.keyframes?.blur || (layer.animate ?? []).some((a) => a.preset === "kenBurns")) return "blur";
  if (layer.filters) return "filters";
  if (layer.type === "text" && /\{count\}/.test(layer.text ?? "")) return "count";
  return null;
}

const rgba = (hex: string): number[] => {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255, 1];
};

// ── Paths → Lottie shape data ────────────────────────────────────────────────────────────

interface ShapeData {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}

function fromPolyline(pl: Polyline): ShapeData {
  const pts = pl.closed && pl.points.length > 1 && pl.points[0][0] === pl.points[pl.points.length - 1][0] && pl.points[0][1] === pl.points[pl.points.length - 1][1] ? pl.points.slice(0, -1) : pl.points;
  const v = pts.map(([x, y]) => [round(x), round(y)]);
  return { c: pl.closed, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A glyph contour moved into place — fresh arrays every time: outlines are cached and
 * reused for repeated letters, and some players rewrite shape data where it lies. */
const placed = (c: Contour, at: (p: number[]) => number[]): ShapeData => ({
  c: c.c,
  v: c.v.map(at),
  i: c.i.map((p) => [...p]),
  o: c.o.map((p) => [...p]),
});

const sh = (data: ShapeData, name = "path"): Json => ({ ty: "sh", nm: name, ks: { a: 0, k: data } });
const fill = (color: number[], opacity = 100): Json => ({ ty: "fl", nm: "fill", c: { a: 0, k: color }, o: { a: 0, k: opacity }, r: 1 });
const stroke = (color: number[], width: number): Json => ({ ty: "st", nm: "stroke", c: { a: 0, k: color }, o: { a: 0, k: 100 }, w: { a: 0, k: round(width) }, lc: 2, lj: 2 });
const groupTr = (o: unknown = { a: 0, k: 100 }, s: unknown = { a: 0, k: [100, 100] }, a: number[] = [0, 0], p: number[] = [0, 0]): Json => ({
  ty: "tr",
  p: { a: 0, k: p },
  a: { a: 0, k: a },
  s,
  r: { a: 0, k: 0 },
  o,
});

// ── Baking ──────────────────────────────────────────────────────────────────────────────

/** Keyframes from per-frame samples: a key wherever the value stops changing linearly. */
function bake(samples: { f: number; v: number[] }[], eps = 0.01): unknown {
  if (!samples.length) return { a: 0, k: [0] };
  const first = samples[0].v;
  if (samples.every((s) => s.v.every((x, i) => Math.abs(x - first[i]) <= eps))) return { a: 0, k: first.length === 1 ? first[0] : first };
  const keep: number[] = [0];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[keep[keep.length - 1]];
    const b = samples[i + 1];
    const m = samples[i];
    const u = (m.f - a.f) / (b.f - a.f);
    const predicted = a.v.map((x, j) => x + (b.v[j] - x) * u);
    if (m.v.some((x, j) => Math.abs(x - predicted[j]) > eps)) keep.push(i);
  }
  keep.push(samples.length - 1);
  const k = keep.map((idx, n) => {
    const s = samples[idx];
    const key: Json = { t: s.f, s: s.v };
    if (n < keep.length - 1) {
      key.i = { x: s.v.map(() => 1), y: s.v.map(() => 1) };
      key.o = { x: s.v.map(() => 0), y: s.v.map(() => 0) };
    }
    return key;
  });
  return { a: 1, k };
}

interface Track {
  item: DrawItem;
  frames: { f: number; item: DrawItem }[];
}

function walkItems(items: DrawItem[], out: Map<string, DrawItem>) {
  for (const i of items) {
    out.set(i.id, i);
    if (i.children) walkItems(i.children, out);
  }
}

export interface LottieResult {
  json: Json;
  skipped: { layer: string; reason: string }[];
}

export async function exportLottie(engine: MotionEngine): Promise<LottieResult> {
  const scene = engine.scene;
  const comp = scene.composition;
  const fps = comp.fps;
  const total = Math.max(1, Math.round(comp.duration * fps));
  const kit = engine.kit;
  const unit = engine.prepared.unit;
  const skipped: { layer: string; reason: string }[] = [];
  const layers = allLayers(scene.layers);
  const ok = new Set<string>();
  for (const layer of layers) {
    const why = lottieBlocker(layer);
    if (why) skipped.push({ layer: layer.id, reason: why });
    else if (layer.type !== "group") ok.add(layer.id);
  }

  // Sample every frame once; each layer keeps the frames it's on screen.
  const tracks = new Map<string, Track>();
  for (let f = 0; f < total; f++) {
    const frame = engine.frame(f / fps);
    const flat = new Map<string, DrawItem>();
    walkItems(frame.items, flat);
    for (const [id, item] of flat) {
      if (!ok.has(id)) continue;
      // children of a group move with it: fold the group's transform into theirs
      let tr = tracks.get(id);
      if (!tr) tracks.set(id, (tr = { item, frames: [] }));
      tr.frames.push({ f, item });
    }
  }

  const parents = new Map<string, DrawItem>();
  const out: Json[] = [];
  let ind = 1;
  for (const layer of [...layers].reverse()) {
    const track = tracks.get(layer.id);
    if (!track || !track.frames.length) continue;
    const base = track.item;
    const box = base.box;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const groupOf = engine.prepared.parent.get(layer.id);
    void parents;
    // the group's own motion, sampled at the same frames
    const groupAt = (f: number) => {
      if (!groupOf) return null;
      const frame = engine.frame(f / fps);
      const flat = new Map<string, DrawItem>();
      walkItems(frame.items, flat);
      return flat.get(groupOf) ?? null;
    };
    const opacity = track.frames.map(({ f, item }) => ({ f, v: [round(item.opacity * 100 * (groupAt(f)?.opacity ?? 1))] }));
    const position = track.frames.map(({ f, item }) => {
      const g = groupAt(f);
      return { f, v: [round(cx + item.tx + (g?.tx ?? 0)), round(cy + item.ty + (g?.ty ?? 0))] };
    });
    const scale = track.frames.map(({ f, item }) => ({ f, v: [round(item.scale * 100 * (groupAt(f)?.scale ?? 1)), round(item.scale * 100 * (groupAt(f)?.scale ?? 1))] }));
    const rotation = track.frames.map(({ f, item }) => ({ f, v: [round(item.rotation)] }));

    const shapes: Json[] = [];
    const color = rgba(base.color ?? resolveColor(kit, "brand.onSurface"));
    const colorTrack = track.frames.some(({ item }) => item.color !== base.color)
      ? bake(track.frames.map(({ f, item }) => ({ f, v: rgba(item.color ?? "#ffffff") })), 0.002)
      : null;
    const fillFor = (c: number[]) => (colorTrack ? { ty: "fl", nm: "fill", c: colorTrack, o: { a: 0, k: 100 }, r: 1 } : fill(c));

    if (layer.type === "text" && base.lines?.length) {
      const style = layer.style ?? "body";
      const role = layer.font ?? (style === "display" || style === "headline" || style === "title" ? "display" : "body");
      const family = role === "mono" ? (kit.fonts.mono ?? "IBM Plex Mono") : kit.fonts[role === "latin" ? "latin" : role];
      const weight = Number(/^(\d+)/.exec(base.font ?? "500")?.[1] ?? 500);
      if (layer.background) {
        const bg = rgba(paintColor(kit, layer.background.color ?? "brand.surface2"));
        const r = kit.radius[Math.min(layer.background.radius ?? 2, kit.radius.length - 1)] ?? 0;
        shapes.push({ ty: "gr", nm: "background", it: [...rectPath(box.x, box.y, box.w, box.h, r).map((p) => sh(fromPolyline(p))), fill(bg), groupTr()] });
      }
      // Lines whose words appear one by one become one group per word.
      // once the reveal is over the line is whole again, so take the words from a frame inside it
      const wordCount = (item: DrawItem) => (item.lines ?? []).reduce((n, l) => n + (l.words?.length ?? 0), 0);
      const template = track.frames.reduce((best, fr) => (wordCount(fr.item) > wordCount(best) ? fr.item : best), track.frames[0].item);
      const reveals = wordCount(template) > 0;
      if (reveals) {
        const words = (template.lines ?? []).flatMap((l, li) => (l.words ?? [{ text: l.text, x: l.x, width: l.width, opacity: 1, scale: 1 }]).map((w, wi) => ({ li, wi, w, y: l.y })));
        const outlines = await outlineLines(words.map(({ w }) => ({ text: w.text, family, weight, px: base.fontPx!, dir: base.dir ?? "rtl" })));
        for (const [n, { li, wi, w, y }] of words.entries()) {
          const o = outlines[n];
          const contours = o.contours.map((c: Contour) => placed(c, ([x, yy]) => [round(x + w.x), round(yy + y)]));
          const series = track.frames.map(({ f, item }) => {
            const word = item.lines?.[li]?.words?.[wi];
            return { f, o: [round((word ? word.opacity : 1) * 100)], s: [round((word?.scale ?? 1) * 100), round((word?.scale ?? 1) * 100)] };
          });
          const anchor = [round(w.x + w.width / 2), round(y - base.fontPx! * 0.35)];
          shapes.push({
            ty: "gr",
            nm: `word ${li}.${wi}`,
            it: [...contours.map((c) => sh(c)), fillFor(color), groupTr(bake(series.map((s) => ({ f: s.f, v: s.o }))), bake(series.map((s) => ({ f: s.f, v: s.s }))), anchor, anchor)],
          });
        }
      } else {
        const outlines = await outlineLines(base.lines.map((line) => ({ text: line.text, family, weight, px: base.fontPx!, dir: base.dir ?? "rtl" })));
        for (const [n, line] of base.lines.entries()) {
          const o = outlines[n];
          const dx = line.x + (line.width - o.width) / 2; // centre the outline where the browser put the line
          const contours = o.contours.map((c: Contour) => placed(c, ([x, y]) => [round(x + dx), round(y + line.y)]));
          shapes.push({ ty: "gr", nm: line.text.slice(0, 30), it: [...contours.map((c) => sh(c)), fillFor(color), groupTr()] });
        }
      }
    } else if (layer.type === "shape") {
      // the same outlines the canvas draws
      const lines: Polyline[] = shapeLines(base, { kit, unit });
      const it: Json[] = lines.map((pl) => sh(fromPolyline(pl)));
      const strokeColor = layer.stroke ? rgba(resolveColor(kit, layer.stroke)) : layer.shape === "line" ? color : null;
      const trimmed = track.frames.some(({ item }) => item.trim < 0.999);
      if (trimmed) it.push({ ty: "tm", nm: "trim", s: { a: 0, k: 0 }, e: bake(track.frames.map(({ f, item }) => ({ f, v: [round(item.trim * 100)] }))), o: { a: 0, k: 0 }, m: 1 });
      if (layer.shape !== "line" && layer.fill !== "transparent") it.push({ ...fillFor(color), r: layer.shape === "ring" ? 2 : 1 });
      if (strokeColor) it.push(stroke(strokeColor, (layer.strokeWidth ?? (layer.shape === "line" ? 2 : 1)) * unit * 0.5));
      it.push(groupTr());
      shapes.push({ ty: "gr", nm: layer.shape ?? "rect", it });
    } else if (layer.type === "icon" && layer.icon) {
      const shape = icon(layer.icon);
      if (shape && shape.kind !== "image") {
        const k = Math.min(box.w / shape.box.w, box.h / shape.box.h);
        const ox = box.x + (box.w - shape.box.w * k) / 2;
        const oy = box.y + (box.h - shape.box.h * k) / 2;
        const trimmed = track.frames.some(({ item }) => item.trim < 0.999);
        // each part as the canvas draws it: filled (even-odd where the icon says) or stroked
        shape.parts.forEach((part, n) => {
          const lines = part.lines.map((pl) => ({ closed: pl.closed, points: pl.points.map(([px, py]) => [ox + px * k, oy + py * k] as [number, number]) }));
          const it: Json[] = lines.map((pl) => sh(fromPolyline(pl)));
          if (part.kind === "fill") {
            it.push({ ...fillFor(color), r: part.evenodd ? 2 : 1, o: { a: 0, k: round(part.opacity * 100) } });
          } else {
            if (trimmed) it.push({ ty: "tm", nm: "trim", s: { a: 0, k: 0 }, e: bake(track.frames.map(({ f, item }) => ({ f, v: [round(item.trim * 100)] }))), o: { a: 0, k: 0 }, m: 1 });
            it.push({ ...stroke(color, part.width * k), o: { a: 0, k: round(part.opacity * 100) } });
          }
          it.push(groupTr());
          shapes.push({ ty: "gr", nm: `${layer.icon} ${n}`, it });
        });
      }
    } else if (layer.type === "chart" && (layer.chart === "bar" || layer.chart === "line")) {
      // bars grow: each bar's rectangle, re-sampled while it builds
      const values = layer.data?.values ?? [];
      const max = Math.max(1e-9, ...values.map(Math.abs));
      const labelPx = unit * 3.2;
      const plotH = box.h - (layer.data?.labels?.length ? labelPx * 1.8 : 0) - labelPx * 1.6;
      const top = box.y + labelPx * 1.6;
      const n = values.length;
      const slot = box.w / n;
      const rtl = base.dir === "rtl";
      values.forEach((v, i) => {
        const idx = rtl ? n - 1 - i : i;
        const x = box.x + slot * idx + slot / 2;
        const bw = slot * 0.62;
        const keys = track.frames.map(({ f }) => {
          const built = Math.min(1, Math.max(0, (f / fps - layer.start) / 1.0));
          const k = 1 - (1 - built) ** 3;
          const bh = (Math.max(0, v) / max) * plotH * k;
          return { f, v: [round(bh)] };
        });
        const heights = bake(keys) as { a: number; k: unknown };
        // a rectangle anchored at its bottom edge, scaled vertically by its height
        shapes.push({
          ty: "gr",
          nm: `bar ${i}`,
          it: [
            ...rectPath(x - bw / 2, top, bw, plotH, 0).map((p) => sh(fromPolyline(p))),
            fill(color),
            groupTr(
              { a: 0, k: 100 },
              heights.a ? { a: 1, k: (heights.k as { t: number; s: number[] }[]).map((kf) => ({ ...kf, s: [100, round((kf.s[0] / plotH) * 100)] })) } : { a: 0, k: [100, round(((heights.k as number) / plotH) * 100)] },
              [x, top + plotH],
              [x, top + plotH],
            ),
          ],
        });
      });
    }
    if (!shapes.length) continue;

    const lottieLayer: Json = {
      ddd: 0,
      ind: ind++,
      ty: 4,
      nm: layer.id,
      sr: 1,
      ks: {
        o: bake(opacity, 0.5),
        r: bake(rotation, 0.05),
        p: bake(position, 0.25),
        a: { a: 0, k: [round(cx), round(cy), 0] },
        s: bake(scale, 0.1),
      },
      ao: 0,
      shapes,
      ip: track.frames[0].f,
      op: track.frames[track.frames.length - 1].f + 1,
      st: 0,
      bm: 0,
    };
    // A reveal mask: the visible rectangle, baked.
    if (track.frames.some(({ item }) => item.mask)) {
      const keys = track.frames.map(({ f, item }) => {
        const p = item.mask ? item.mask.p : 1;
        let dir = item.mask?.dir ?? "start";
        const rtl = item.dir === "rtl";
        if (dir === "start") dir = rtl ? "end" : "start";
        else if (dir === "end") dir = rtl ? "start" : "end";
        let x0 = box.x - 2, x1 = box.x + box.w + 2, y0 = box.y - box.h, y1 = box.y + box.h * 2;
        if (dir === "start") x1 = x0 + (box.w + 4) * p;
        else if (dir === "end") x0 = x1 - (box.w + 4) * p;
        else if (dir === "up") { y0 = box.y + box.h + 2 - (box.h + 4) * p; y1 = box.y + box.h + 2; }
        else { y0 = box.y - 2; y1 = y0 + (box.h + 4) * p; }
        // always four corners, even when the rectangle is flat: players only tween equal vertex counts
        const v = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [round(x), round(y)]);
        return { f, data: { c: true, v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]) } };
      });
      const k = keys.map((key, n) => (n < keys.length - 1 ? { t: key.f, s: [key.data], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } } : { t: key.f, s: [key.data] }));
      lottieLayer.hasMask = true;
      lottieLayer.masksProperties = [{ inv: false, mode: "a", pt: { a: 1, k }, o: { a: 0, k: 100 }, x: { a: 0, k: 0 }, nm: "reveal" }];
    }
    out.push(lottieLayer);
  }

  // the background, at the very bottom
  const bg = paintColor(kit, comp.background ?? "brand.surface", "surface");
  out.push({ ddd: 0, ind, ty: 1, nm: "background", sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [comp.width / 2, comp.height / 2, 0] }, a: { a: 0, k: [comp.width / 2, comp.height / 2, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, sw: comp.width, sh: comp.height, sc: bg, ip: 0, op: total, st: 0, bm: 0 });

  return {
    json: { v: "5.7.4", fr: fps, ip: 0, op: total, w: comp.width, h: comp.height, nm: scene.title ?? "Rafiq motion", ddd: 0, assets: [], layers: out, meta: { g: "Rafiq Motion" } },
    skipped,
  };
}

// ── dotLottie: a stored (uncompressed) zip with a manifest ────────────────────────────

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function dotLottie(json: Json, id = "animation"): Uint8Array {
  const enc = new TextEncoder();
  const files: [string, Uint8Array][] = [
    ["manifest.json", enc.encode(JSON.stringify({ version: "1", generator: "Rafiq Motion", animations: [{ id }] }))],
    [`animations/${id}.json`, enc.encode(JSON.stringify(json))],
  ];
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const part of all) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// ── Checking the file against the engine ──────────────────────────────────────────────

function gray(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number): Float32Array {
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}

/** Mean SSIM over 8×8 windows (Wang et al. 2004 constants). */
export function ssim(a: Float32Array, b: Float32Array, w: number, h: number): number {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let total = 0;
  let n = 0;
  for (let y = 0; y + 8 <= h; y += 4) {
    for (let x = 0; x + 8 <= w; x += 4) {
      let ma = 0, mb = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        ma += a[(y + j) * w + x + i];
        mb += b[(y + j) * w + x + i];
      }
      ma /= 64;
      mb /= 64;
      let va = 0, vb = 0, cov = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const da = a[(y + j) * w + x + i] - ma;
        const db = b[(y + j) * w + x + i] - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= 63;
      vb /= 63;
      cov /= 63;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? total / n : 1;
}

/** Plays the file with lottie-web and compares frames with the engine's own. */
export async function verifyLottie(engine: MotionEngine, json: Json, times: number[]): Promise<{ t: number; ssim: number }[]> {
  const lottie = (await import("lottie-web")).default;
  const comp = engine.scene.composition;
  // large enough that glyph edges (antialiasing) don't dominate the comparison
  const scale = Math.min(1, 720 / Math.max(comp.width, comp.height));
  const w = Math.round(comp.width * scale);
  const h = Math.round(comp.height * scale);
  const playerCanvas = document.createElement("canvas");
  playerCanvas.width = w;
  playerCanvas.height = h;
  const pctx = playerCanvas.getContext("2d", { willReadFrequently: true })!;
  const anim = lottie.loadAnimation({
    renderer: "canvas",
    loop: false,
    autoplay: false,
    animationData: structuredClone(json),
    rendererSettings: { context: pctx, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
  } as Parameters<typeof lottie.loadAnimation>[0]);
  const engineCanvas = new OffscreenCanvas(w, h);
  const ectx = engineCanvas.getContext("2d", { willReadFrequently: true })!;
  const out: { t: number; ssim: number }[] = [];
  for (const t of times) {
    anim.goToAndStop(Math.round(t * comp.fps), true);
    engine.draw(ectx, t, scale);
    out.push({ t, ssim: ssim(gray(pctx, w, h), gray(ectx, w, h), w, h) });
  }
  anim.destroy();
  return out;
}
