/**
 * frame(scene, t) → what to draw. Pure: the same scene, kit and t give the same list on any
 * machine (text measurement is the one thing that comes from outside, injected as
 * `measure`, so the browser's real shaping decides widths and tests can use a stand-in).
 */

import { DEFAULT_KIT, LINE_HEIGHT, TEXT_WEIGHT, fontStack, isGradient, paintColor, stylePx, unitPx } from "./brand";
import { BASE, countExtent, expand, isArabic, valueAt, type LayerTracks } from "./tracks";
import type { Anchor, Box, BrandKit, DrawItem, Frame, Layer, Scene, TextLine, TypeStyle } from "./types";

export type Measure = (text: string, font: string) => number;

export interface LaidOut {
  box: Box;
  lines?: { text: string; width: number }[];
  font?: string;
  fontPx?: number;
  lineHeight?: number;
  dir?: "rtl" | "ltr";
  align?: "start" | "center" | "end";
  pad?: number;
  /** The text the box was measured with. */
  sample?: string;
}

export interface Prepared {
  scene: Scene;
  kit: BrandKit;
  unit: number;
  dir: "rtl" | "ltr";
  frame: Box; // the content frame (canvas inset by the margin)
  layout: Map<string, LaidOut>;
  tracks: Map<string, LayerTracks>;
  order: Layer[]; // every layer, depth first, in drawing order
  parent: Map<string, string>;
}

// ── Text ────────────────────────────────────────────────────────────────────────────────

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/** Words with the spaces that follow them, so joining them back gives the original text. */
export function splitWords(text: string): string[] {
  if (!segmenter) return text.split(/(?<=\s)/);
  const out: string[] = [];
  let current = "";
  for (const part of segmenter.segment(text)) {
    if (/^\s+$/.test(part.segment)) {
      current += part.segment;
      out.push(current);
      current = "";
    } else if (current && !/\s$/.test(current) && part.isWordLike && /[\p{L}\p{N}]$/u.test(current)) {
      // two word-like segments touching (rare): keep them as one word
      current += part.segment;
    } else {
      current += part.segment;
    }
  }
  if (current) out.push(current);
  return out.filter((w) => w.length);
}

export function wrapText(text: string, maxWidth: number, font: string, measure: Measure): { text: string; width: number }[] {
  const lines: { text: string; width: number }[] = [];
  for (const paragraph of text.split("\n")) {
    const words = splitWords(paragraph);
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (line && measure(candidate.trimEnd(), font) > maxWidth) {
        lines.push({ text: line.trimEnd(), width: measure(line.trimEnd(), font) });
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push({ text: line.trimEnd(), width: measure(line.trimEnd(), font) });
  }
  return lines;
}

export function textDirection(text: string, fallback: "rtl" | "ltr"): "rtl" | "ltr" {
  const strong = /[A-Za-z\u00C0-\u024F]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(text);
  if (!strong) return fallback;
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(strong[0]) ? "rtl" : "ltr";
}

// Arabic-Indic digits (U+0660…U+0669) and the Arabic thousands and decimal separators
const ARABIC_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(0x660 + i));
const ARABIC_THOUSANDS = String.fromCharCode(0x66c);
const ARABIC_DECIMAL = String.fromCharCode(0x66b);

export function formatCount(value: number, layer: Layer, digits: "latin" | "arabic" = "latin"): string {
  const decimals = layer.format?.decimals ?? 0;
  let s = Math.abs(value).toFixed(decimals);
  if (layer.format?.group ?? true) {
    const [int, frac] = s.split(".");
    s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
  }
  if (value < 0) s = `-${s}`;
  if (digits === "arabic") s = s.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]).replace(/,/g, ARABIC_THOUSANDS).replace(/\./g, ARABIC_DECIMAL);
  return s;
}

export function textOf(layer: Layer, count: number, digits: "latin" | "arabic" = "latin"): string {
  return (layer.text ?? "").replace(/\{count\}/g, formatCount(count, layer, digits));
}

function fontFor(layer: Layer, kit: BrandKit, px: number): string {
  const style = layer.style ?? "body";
  const weight = layer.weight ?? TEXT_WEIGHT[style];
  const role = layer.font ?? (style === "display" || style === "headline" || style === "title" ? "display" : "body");
  return `${weight} ${px.toFixed(2)}px ${fontStack(kit, role)}`;
}

// ── Layout ──────────────────────────────────────────────────────────────────────────────

function walk(layers: Layer[], out: Layer[], parent: Map<string, string>, parentId?: string) {
  for (const layer of layers) {
    out.push(layer);
    if (parentId) parent.set(layer.id, parentId);
    if (layer.children?.length) walk(layer.children, out, parent, layer.id);
  }
}

function intrinsic(layer: Layer, p: Prepared, container: Box, measure: Measure): LaidOut {
  const { unit, kit } = p;
  const L = layer.layout ?? {};
  const W = L.width !== undefined ? L.width * unit : undefined;
  const H = L.height !== undefined ? L.height * unit : undefined;
  const comp = p.scene.composition;

  if (layer.type === "text") {
    const style: TypeStyle = layer.style ?? "body";
    const px = stylePx(kit, comp, style);
    const font = fontFor(layer, kit, px);
    const tracks = p.tracks.get(layer.id)!;
    // Measure with the widest number the count will show, so the box never jumps.
    const sample = textOf(layer, countExtent(tracks), comp.digits);
    const pad = layer.background ? (layer.background.padding ?? 2) * unit : 0;
    const maxW = (W ?? container.w) - pad * 2;
    const lines = wrapText(sample, Math.max(unit, maxW), font, measure);
    const lineHeight = px * LINE_HEIGHT[style];
    const w = W ?? Math.min(container.w, Math.max(...lines.map((l) => l.width)) + pad * 2);
    const h = H ?? lines.length * lineHeight + pad * 2;
    const dir = textDirection(sample, p.dir);
    return { box: { x: 0, y: 0, w, h }, lines, font, fontPx: px, lineHeight, dir, pad, sample };
  }
  if (layer.type === "captions") {
    const px = stylePx(kit, comp, layer.style ?? "title");
    const font = fontFor({ ...layer, style: layer.style ?? "title" }, kit, px);
    const lineHeight = px * LINE_HEIGHT[layer.style ?? "title"];
    return { box: { x: 0, y: 0, w: W ?? container.w, h: H ?? lineHeight * 2 + 4 * unit }, font, fontPx: px, lineHeight, dir: p.dir };
  }
  const full = { x: 0, y: 0, w: W ?? container.w, h: H ?? container.h };
  switch (layer.type) {
    case "video":
    case "image":
    case "lottie":
    case "group":
      // Pictures fill the frame unless told otherwise.
      return L.width === undefined && L.height === undefined
        ? { box: { x: 0, y: 0, w: comp.width, h: comp.height } }
        : { box: { x: 0, y: 0, w: W ?? H!, h: H ?? W! } };
    case "icon":
      return { box: { x: 0, y: 0, w: W ?? H ?? 12 * unit, h: H ?? W ?? 12 * unit } };
    case "chart":
      return { box: { x: 0, y: 0, w: W ?? container.w, h: H ?? Math.min(container.h, 48 * unit) } };
    case "shape": {
      if (layer.shape === "line") return { box: { x: 0, y: 0, w: W ?? 24 * unit, h: H ?? Math.max(1, (layer.strokeWidth ?? 1) * unit * 0.5) } };
      const side = W ?? H ?? 12 * unit;
      return { box: { x: 0, y: 0, w: W ?? side, h: H ?? (layer.shape === "circle" ? side : side) } };
    }
    default:
      return { box: full };
  }
}

/** Where an anchor puts a box of size (w, h) inside `frame`, before offsets. */
function anchorAt(anchor: Anchor, w: number, h: number, frame: Box, rtl: boolean): { x: number; y: number } {
  const left = frame.x;
  const right = frame.x + frame.w - w;
  const cx = frame.x + (frame.w - w) / 2;
  const top = frame.y;
  const bottom = frame.y + frame.h - h;
  const cy = frame.y + (frame.h - h) / 2;
  const start = rtl ? right : left;
  const end = rtl ? left : right;
  switch (anchor) {
    case "top":
      return { x: cx, y: top };
    case "bottom":
      return { x: cx, y: bottom };
    case "start":
      return { x: start, y: cy };
    case "end":
      return { x: end, y: cy };
    case "topStart":
      return { x: start, y: top };
    case "topEnd":
      return { x: end, y: top };
    case "bottomStart":
      return { x: start, y: bottom };
    case "bottomEnd":
      return { x: end, y: bottom };
    default:
      return { x: cx, y: cy };
  }
}

function defaultAlign(anchor: Anchor | undefined): "start" | "center" | "end" {
  if (!anchor || anchor === "center" || anchor === "top" || anchor === "bottom") return "center";
  return anchor.toLowerCase().includes("end") ? "end" : "start";
}

export function prepare(scene: Scene, kit: BrandKit = DEFAULT_KIT, measure: Measure): Prepared {
  const comp = scene.composition;
  const unit = unitPx(comp);
  const dir = comp.direction ?? "rtl";
  const margin = (comp.margin ?? 8) * unit;
  const frame = { x: margin, y: margin, w: comp.width - margin * 2, h: comp.height - margin * 2 };
  const order: Layer[] = [];
  const parent = new Map<string, string>();
  walk(scene.layers, order, parent);
  const p: Prepared = { scene, kit, unit, dir, frame, layout: new Map(), tracks: new Map(), order, parent };
  for (const layer of order) p.tracks.set(layer.id, expand(layer, kit));

  const byId = new Map(order.map((l) => [l.id, l]));
  const rtl = dir === "rtl";
  const sign = rtl ? -1 : 1;
  const visiting = new Set<string>();

  const place = (layer: Layer): LaidOut => {
    const done = p.layout.get(layer.id);
    if (done) return done;
    // Inside a group, the group's box is the frame (no margin of its own).
    const parentId = parent.get(layer.id);
    const container = parentId && byId.get(parentId) ? place(byId.get(parentId)!).box : frame;
    const out = intrinsic(layer, p, container, measure);
    const L = layer.layout ?? {};
    const { w, h } = out.box;
    let x: number;
    let y: number;
    const ref = L.below ?? L.above ?? L.beside;
    if (ref && byId.has(ref) && !visiting.has(ref)) {
      visiting.add(layer.id);
      const r = place(byId.get(ref)!).box;
      visiting.delete(layer.id);
      const gap = (L.gap ?? 3) * unit;
      const refLayer = byId.get(ref)!;
      const align = L.align ?? defaultAlign(refLayer.layout?.anchor);
      const alignX = () =>
        align === "center" ? r.x + (r.w - w) / 2 : (align === "start") !== rtl ? r.x : r.x + r.w - w;
      if (L.below) {
        x = alignX();
        y = r.y + r.h + gap;
      } else if (L.above) {
        x = alignX();
        y = r.y - gap - h;
      } else {
        x = rtl ? r.x - gap - w : r.x + r.w + gap;
        y = r.y + (r.h - h) / 2;
      }
    } else {
      const fill = (layer.type === "video" || layer.type === "image" || layer.type === "lottie" || layer.type === "group") && L.width === undefined && L.height === undefined;
      const at = fill ? { x: 0, y: 0 } : anchorAt(L.anchor ?? "center", w, h, container, rtl);
      x = at.x;
      y = at.y;
    }
    x += (L.x ?? 0) * unit * sign;
    y += (L.y ?? 0) * unit;
    out.box = { x, y, w, h };
    out.align = layer.align ?? defaultAlign(L.below || L.above ? byId.get(ref!)?.layout?.anchor : L.anchor);
    p.layout.set(layer.id, out);
    return out;
  };
  for (const layer of order) place(layer);
  return p;
}

// ── Frames ──────────────────────────────────────────────────────────────────────────────

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

export function isVisible(layer: Layer, t: number): boolean {
  return !layer.hidden && t >= layer.start && t < layer.end;
}

function transformedBounds(box: Box, scale: number, rotation: number, tx: number, ty: number): Box {
  const cx = box.x + box.w / 2 + tx;
  const cy = box.y + box.h / 2 + ty;
  const hw = (box.w * Math.abs(scale)) / 2;
  const hh = (box.h * Math.abs(scale)) / 2;
  const r = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const bw = hw * c + hh * s;
  const bh = hw * s + hh * c;
  return { x: cx - bw, y: cy - bh, w: bw * 2, h: bh * 2 };
}

function textLines(layer: Layer, lo: LaidOut, item: DrawItem, p: Prepared, measure: Measure, t: number): TextLine[] {
  const tracks = p.tracks.get(layer.id)!;
  const count = num(valueAt(tracks, "count", t, BASE.count, p.kit));
  const text = textOf(layer, count, p.scene.composition.digits);
  item.textValue = text;
  const font = lo.font!;
  const pad = lo.pad ?? 0;
  const inner = { x: lo.box.x + pad, w: lo.box.w - pad * 2 };
  // Re-wrap only when the shown text differs from what was measured (a counting number).
  const lines = text === lo.sample ? lo.lines! : wrapText(text, inner.w, font, measure);
  const rtl = lo.dir === "rtl";
  const align = lo.align ?? "start";
  const ascent = lo.fontPx! * 0.92;
  const lh = lo.lineHeight!;
  const top = lo.box.y + pad + (lh - lo.fontPx! * 1.0) / 2;

  const out: TextLine[] = lines.map((line, i) => {
    const x =
      align === "center" ? inner.x + (inner.w - line.width) / 2 : (align === "start") !== rtl ? inner.x : inner.x + inner.w - line.width;
    return { text: line.text, x, y: top + i * lh + ascent, width: line.width };
  });

  const reveal = tracks.reveal;
  if (reveal && t < reveal.t1 + 1e-9) {
    const u = reveal.t1 > reveal.t0 ? Math.min(1, Math.max(0, (t - reveal.t0) / (reveal.t1 - reveal.t0))) : 1;
    if (reveal.unit === "lines") {
      out.forEach((line, i) => {
        const n = out.length;
        const local = Math.min(1, Math.max(0, u * n - i * (1 - (reveal.stagger || 0.35))));
        const k = reveal.ease(local);
        line.words = [{ text: line.text, x: line.x, width: line.width, opacity: k, scale: 1 }];
        line.y += (1 - k) * p.unit * 2;
      });
    } else {
      // words (or characters, for Latin typewriter) appear one by one
      const units: { line: number; text: string; x: number; width: number }[] = [];
      out.forEach((line, li) => {
        const pieces = reveal.unit === "chars" ? [...line.text] : splitWords(line.text);
        let cursor = 0;
        for (const piece of pieces) {
          const before = measure(line.text.slice(0, cursor), font);
          const wpx = measure(piece, font);
          // In RTL lines the first word sits at the right end.
          const x = rtl ? line.x + line.width - before - wpx : line.x + before;
          units.push({ line: li, text: piece, x, width: wpx });
          cursor += piece.length;
        }
      });
      const n = units.length;
      out.forEach((line) => (line.words = []));
      units.forEach((piece, i) => {
        const span = reveal.style === "pop" ? Math.max(0.15, 1 - (reveal.stagger || 0.5)) : 1 / n;
        const start = reveal.style === "pop" ? (i / Math.max(1, n)) * (1 - span) : i / n;
        const local = Math.min(1, Math.max(0, (u - start) / span));
        const shown = reveal.style === "type" ? (u * n >= i + 1 || u >= 1 ? 1 : 0) : local;
        const k = reveal.style === "type" ? shown : reveal.ease(local);
        out[piece.line].words!.push({ text: piece.text, x: piece.x, width: piece.width, opacity: reveal.style === "type" ? shown : Math.min(1, local * 2), scale: reveal.style === "pop" ? 0.6 + 0.4 * k : 1 });
      });
    }
  }
  return out;
}

function captionLines(layer: Layer, lo: LaidOut, p: Prepared, measure: Measure, t: number): TextLine[] {
  const words = (layer.words ?? []).filter((w) => w.w.trim());
  if (!words.length) return [];
  const per = layer.maxWords ?? 4;
  // Group words into cards of `per`; show the card whose window contains t.
  let groupIndex = -1;
  for (let i = 0; i < words.length; i += per) {
    const group = words.slice(i, i + per);
    const g0 = group[0].t0;
    const next = words[i + per];
    const g1 = next ? next.t0 : group[group.length - 1].t1 + 0.6;
    if (t >= g0 - 0.05 && t < g1) groupIndex = i;
  }
  if (groupIndex < 0) return [];
  const group = words.slice(groupIndex, groupIndex + per);
  const font = lo.font!;
  const space = measure(" ", font);
  const lines = wrapText(group.map((w) => w.w).join(" "), lo.box.w, font, measure);
  const rtl = textDirection(group.map((w) => w.w).join(" "), p.dir) === "rtl";
  const out: TextLine[] = [];
  let wi = 0;
  lines.forEach((line, li) => {
    const x = lo.box.x + (lo.box.w - line.width) / 2;
    const y = lo.box.y + lo.box.h / 2 - (lines.length * lo.lineHeight!) / 2 + li * lo.lineHeight! + lo.fontPx! * 0.95;
    const tl: TextLine = { text: line.text, x, y, width: line.width, words: [] };
    let cursor = 0;
    for (const piece of line.text.split(" ")) {
      const w = group[wi++];
      if (!w) break;
      const wpx = measure(piece, font);
      const wx = rtl ? x + line.width - cursor - wpx : x + cursor;
      const local = Math.min(1, Math.max(0, (t - w.t0) / 0.18));
      const style = layer.captionStyle ?? "pop";
      const spoken = t >= w.t0;
      tl.words!.push({
        text: piece,
        x: wx,
        width: wpx,
        opacity: style === "pop" ? (spoken ? Math.min(1, local * 2) : 0) : 1,
        scale: style === "pop" ? 0.8 + 0.2 * local : 1,
        highlight: style !== "pop" && spoken ? (style === "karaoke" ? 1 : t < w.t1 ? 1 : 0) : 0,
      });
      cursor += wpx + space;
    }
    out.push(tl);
  });
  return out;
}

export function evaluate(p: Prepared, t: number, measure: Measure): Frame {
  const { scene, kit } = p;
  const comp = scene.composition;
  const items: DrawItem[] = [];
  const childItems = new Map<string, DrawItem[]>();
  const sign = p.dir === "rtl" ? -1 : 1;

  p.order.forEach((layer, z) => {
    if (!isVisible(layer, t)) return;
    const parentId = p.parent.get(layer.id);
    if (parentId) {
      const parentLayer = p.order.find((l) => l.id === parentId);
      if (parentLayer && !isVisible(parentLayer, t)) return;
    }
    const tracks = p.tracks.get(layer.id)!;
    const lo = p.layout.get(layer.id)!;
    const v = (prop: string, base: number) => num(valueAt(tracks, prop, t, base, kit));
    const opacity = Math.max(0, Math.min(1, v("opacity", 1) * (layer.opacity ?? 1)));
    const scale = v("scale", 1);
    const rotation = v("rotation", 0);
    const tx = v("x", 0) * p.unit * sign;
    const ty = v("y", 0) * p.unit;
    const blur = Math.max(0, v("blur", 0));
    const trim = Math.max(0, Math.min(1, v("trim", 1)));
    const item: DrawItem = {
      id: layer.id,
      type: layer.type,
      layer,
      box: lo.box,
      bounds: transformedBounds(lo.box, scale, rotation, tx, ty),
      opacity,
      scale,
      rotation,
      tx,
      ty,
      blur,
      trim,
      z,
      // shapes, charts and pictures follow the scene: arrows point and bars run the way it reads
      dir: lo.dir ?? p.dir,
    };
    const colorTrack = tracks.segments.get("color");
    const baseColor = layer.type === "shape" ? (layer.fill ?? "brand.primary") : (layer.color ?? (layer.type === "icon" ? "brand.onSurface" : "brand.onSurface"));
    if (isGradient(baseColor) && !colorTrack) item.paint = baseColor;
    item.color = colorTrack ? String(valueAt(tracks, "color", t, paintColor(kit, baseColor), kit)) : paintColor(kit, baseColor);
    const mask = [...tracks.masks].reverse().find((m) => m.t0 <= t);
    if (mask) {
      const u = mask.t1 > mask.t0 ? Math.min(1, (t - mask.t0) / (mask.t1 - mask.t0)) : 1;
      if (u < 1) item.mask = { p: mask.ease(u), dir: mask.dir, soft: mask.soft };
    } else if (tracks.masks.length) {
      item.mask = { p: 0, dir: tracks.masks[0].dir, soft: tracks.masks[0].soft };
    }
    if (layer.type === "text") {
      item.font = lo.font;
      item.fontPx = lo.fontPx;
      item.lines = textLines(layer, lo, item, p, measure, t);
    } else if (layer.type === "captions") {
      item.font = lo.font;
      item.fontPx = lo.fontPx;
      item.lines = captionLines(layer, lo, p, measure, t);
    } else if (layer.type === "video") {
      item.sourceTime = (layer.in ?? 0) + (t - layer.start) * (layer.speed ?? 1);
    } else if (layer.type === "chart") {
      item.textValue = layer.data?.unit;
    }
    if (parentId) {
      const list = childItems.get(parentId) ?? [];
      list.push(item);
      childItems.set(parentId, list);
    } else {
      items.push(item);
    }
  });
  for (const item of items) {
    if (item.type === "group") item.children = childItems.get(item.id) ?? [];
  }
  const bg = comp.background ?? "brand.surface";
  return { t, width: comp.width, height: comp.height, background: paintColor(kit, bg, "surface"), backgroundPaint: isGradient(bg) ? bg : undefined, items };
}

/** Frame times for a composition: 0, 1/fps, … up to (not including) the duration. */
export function frameCount(scene: Scene): number {
  return Math.max(1, Math.round(scene.composition.duration * scene.composition.fps));
}

export function frameTime(scene: Scene, index: number): number {
  return index / scene.composition.fps;
}

export { isArabic };
