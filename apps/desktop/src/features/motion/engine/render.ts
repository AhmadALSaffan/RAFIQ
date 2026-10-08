/**
 * A frame onto a 2D canvas (HTMLCanvasElement or OffscreenCanvas — the export runs in a
 * worker-friendly way, with no DOM). Chromium shapes Arabic here: joining, lam-alef, marks,
 * and `direction = "rtl"`. Blur, colour filters and blend modes run on the GPU through the
 * canvas's own compositing.
 */

import { isGradient, paintColor, resolveColor } from "./brand";
import { icon } from "./icons";
import { arcPath, arrowPath, ellipsePath, heartPath, parsePath, polygonPath, rectPath, ringPath, starPath, toPath2D, trianglePath, trimLines, type Polyline } from "./paths";
import type { BrandKit, DrawItem, Frame, Gradient, Layer, Paint } from "./types";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ImageLike = CanvasImageSource & { width: number; height: number };

export interface Resources {
  kit: BrandKit;
  unit: number;
  images: Map<string, ImageLike>;
  /** The decoded frame of a video layer at its source time, or null if not ready. */
  video?: (layer: Layer, sourceTime: number) => ImageLike | null;
  /** Lottie layers draw themselves (lottie-web), given the layer's local time. */
  lottie?: (layer: Layer, ctx: Ctx, box: { x: number; y: number; w: number; h: number }, localTime: number) => void;
}

const BLEND: Record<string, GlobalCompositeOperation> = { normal: "source-over", multiply: "multiply", screen: "screen", overlay: "overlay" };

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function radiusPx(res: Pick<Resources, "kit" | "unit">, layer: Layer, override: number): number {
  if (override >= 0) return override * res.unit;
  const idx = layer.radius ?? 0;
  return res.kit.radius[Math.min(idx, res.kit.radius.length - 1)] ?? 0;
}

/** A gradient (or a colour) as a canvas fill over `box`. */
export function canvasPaint(ctx: Ctx, kit: BrandKit, paint: Paint | Gradient | undefined, box: { x: number; y: number; w: number; h: number }, fallback = "onSurface"): string | CanvasGradient {
  if (!isGradient(paint)) return paintColor(kit, paint, fallback);
  const { x, y, w, h } = box;
  let g: CanvasGradient;
  if (paint.type === "radial") {
    g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.hypot(w, h) / 2);
  } else {
    const a = ((paint.angle ?? 0) * Math.PI) / 180;
    const dx = (Math.cos(a) * w) / 2;
    const dy = (Math.sin(a) * h) / 2;
    g = ctx.createLinearGradient(x + w / 2 - dx, y + h / 2 - dy, x + w / 2 + dx, y + h / 2 + dy);
  }
  for (const stop of paint.stops) g.addColorStop(Math.min(1, Math.max(0, stop.at)), resolveColor(kit, stop.color));
  return g;
}

/** Shapes that are holes inside outlines fill even-odd. */
export function shapeFillRule(layer: Layer): CanvasFillRule {
  return layer.shape === "ring" ? "evenodd" : "nonzero";
}

export function shapeLines(item: DrawItem, res: Pick<Resources, "kit" | "unit">): Polyline[] {
  const { x, y, w, h } = item.box;
  const layer = item.layer;
  const thick = (layer.thickness ?? Math.max(1, Math.min(w, h) / res.unit / 8)) * res.unit;
  switch (layer.shape) {
    case "circle":
      return ellipsePath(x, y, w, h);
    case "triangle":
      return trianglePath(x, y, w, h);
    case "polygon":
      return polygonPath(x, y, w, h, layer.points ?? 6);
    case "arrow":
      // "end" points the way the line reads: left in RTL
      return arrowPath(x, y, w, h, (layer.pointing ?? "end") === "end" ? item.dir !== "rtl" : item.dir === "rtl");
    case "ring":
      return ringPath(x, y, w, h, thick);
    case "arc":
      return arcPath(x, y, w, h, layer.arc?.from ?? 0, layer.arc?.to ?? 270, thick);
    case "heart":
      return heartPath(x, y, w, h);
    case "line":
      return [{ points: [[x, y + h / 2], [x + w, y + h / 2]], closed: false }];
    case "star":
      return starPath(x, y, w, h, layer.points ?? 5);
    case "path": {
      const u = res.unit;
      return parsePath(layer.path ?? "").map((pl) => ({ closed: pl.closed, points: pl.points.map(([px, py]) => [x + px * u, y + py * u]) }));
    }
    default:
      return rectPath(x, y, w, h, radiusPx(res, layer, -1));
  }
}

function drawShape(ctx: Ctx, item: DrawItem, res: Resources) {
  const layer = item.layer;
  const lines = shapeLines(item, res);
  const fill = layer.shape === "line" ? null : item.paint ? canvasPaint(ctx, res.kit, item.paint, item.box) : item.color;
  const stroke = layer.stroke ? resolveColor(res.kit, layer.stroke) : layer.shape === "line" ? item.color : null;
  const strokeW = (layer.strokeWidth ?? (layer.shape === "line" ? 2 : 1)) * res.unit * 0.5;
  const rule = shapeFillRule(layer);
  if (fill && layer.fill !== "transparent") {
    if (item.trim < 1 && !stroke) {
      // A filled shape with no outline "draws on" by growing from the reading start.
      ctx.save();
      const { x, y, w, h } = item.box;
      const rtl = item.dir === "rtl";
      ctx.beginPath();
      ctx.rect(rtl ? x + w * (1 - item.trim) : x, y, w * item.trim, h);
      ctx.clip();
      ctx.fillStyle = fill;
      ctx.fill(toPath2D(lines), rule);
      ctx.restore();
    } else if (item.trim >= 1 || !stroke) {
      ctx.fillStyle = fill;
      ctx.fill(toPath2D(lines), rule);
    }
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeW;
    ctx.lineCap = layer.dash ? "butt" : "round";
    ctx.lineJoin = "round";
    if (layer.dash) ctx.setLineDash([layer.dash[0] * res.unit, layer.dash[1] * res.unit]);
    ctx.stroke(toPath2D(trimLines(lines, item.trim)));
    ctx.setLineDash([]);
  }
}

function drawText(ctx: Ctx, item: DrawItem, res: Resources) {
  const layer = item.layer;
  if (layer.background && item.lines?.length) {
    const r = res.kit.radius[Math.min(layer.background.radius ?? 2, res.kit.radius.length - 1)] ?? 0;
    ctx.fillStyle = canvasPaint(ctx, res.kit, layer.background.color ?? "brand.surface2", item.box);
    ctx.fill(toPath2D(rectPath(item.box.x, item.box.y, item.box.w, item.box.h, r)));
  }
  // a gradient runs across the whole text block, not letter by letter
  const ink = item.paint ? canvasPaint(ctx, res.kit, item.paint, item.box) : item.color!;
  const outline = layer.outline ? { color: resolveColor(res.kit, layer.outline.color ?? "brand.surface"), width: (layer.outline.width ?? 0.6) * res.unit } : null;
  ctx.font = item.font!;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.direction = item.dir ?? "rtl";
  if (typeof layer.shadow === "object") applyShadow(ctx, layer.shadow, res);
  else if (layer.shadow || layer.type === "captions") {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = (item.fontPx ?? 32) * 0.35;
    ctx.shadowOffsetY = (item.fontPx ?? 32) * 0.06;
  }
  const highlight = resolveColor(res.kit, "brand.primary");
  for (const line of item.lines ?? []) {
    if (!line.words) {
      if (outline) strokeText(ctx, line.text, line.x, line.y, outline);
      ctx.fillStyle = ink;
      ctx.fillText(line.text, line.x, line.y);
      continue;
    }
    for (const word of line.words) {
      if (word.opacity <= 0.001) continue;
      ctx.save();
      ctx.globalAlpha *= word.opacity;
      ctx.fillStyle = word.highlight ? highlight : ink;
      if (outline) strokeText(ctx, word.text, word.x, line.y, outline);
      if (word.scale !== 1) {
        const cx = word.x + word.width / 2;
        const cy = line.y - (item.fontPx ?? 32) * 0.35;
        ctx.translate(cx, cy);
        ctx.scale(word.scale, word.scale);
        ctx.translate(-cx, -cy);
      }
      ctx.fillText(word.text, word.x, line.y);
      ctx.restore();
    }
  }
}

function strokeText(ctx: Ctx, text: string, x: number, y: number, outline: { color: string; width: number }) {
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = outline.color;
  ctx.lineWidth = outline.width * 2; // half of it sits under the fill
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

function applyShadow(ctx: Ctx, s: { color?: string; blur?: number; x?: number; y?: number; opacity?: number }, res: Pick<Resources, "kit" | "unit">) {
  const [r, g, b] = (() => {
    const hex = resolveColor(res.kit, s.color ?? "#000000");
    const h = hex.replace("#", "");
    const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  })();
  ctx.shadowColor = `rgba(${r},${g},${b},${s.opacity ?? 0.5})`;
  ctx.shadowBlur = (s.blur ?? 3) * res.unit;
  ctx.shadowOffsetX = (s.x ?? 0) * res.unit;
  ctx.shadowOffsetY = (s.y ?? 0.8) * res.unit;
}

function fitRect(sw: number, sh: number, box: { x: number; y: number; w: number; h: number }, fit: "cover" | "contain") {
  const k = fit === "contain" ? Math.min(box.w / sw, box.h / sh) : Math.max(box.w / sw, box.h / sh);
  const w = sw * k;
  const h = sh * k;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function drawPicture(ctx: Ctx, item: DrawItem, src: ImageLike, res: Resources) {
  const layer = item.layer;
  const crop = layer.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = crop.x * src.width;
  const sy = crop.y * src.height;
  const sw = crop.w * src.width;
  const sh = crop.h * src.height;
  const box = item.box;
  const dst = fitRect(sw, sh, box, layer.fit ?? "cover");
  const f = layer.filters;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  if (f && (f.brightness !== undefined || f.contrast !== undefined || f.saturation !== undefined)) {
    const parts = [`brightness(${f.brightness ?? 1})`, `contrast(${f.contrast ?? 1})`, `saturate(${f.saturation ?? 1})`];
    ctx.filter = [ctx.filter !== "none" ? ctx.filter : "", ...parts].filter(Boolean).join(" ");
  }
  ctx.drawImage(src, sx, sy, sw, sh, dst.x, dst.y, dst.w, dst.h);
  ctx.filter = "none";
  if (f?.warmth) {
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha *= Math.min(1, Math.abs(f.warmth)) * 0.5;
    ctx.fillStyle = f.warmth > 0 ? "#ff9a3c" : "#3c8cff";
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.restore();
  if (f?.vignette) {
    ctx.save();
    const g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) * 0.3, box.x + box.w / 2, box.y + box.h / 2, Math.hypot(box.w, box.h) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, f.vignette) * 0.75})`);
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
  void res;
}

function drawIcon(ctx: Ctx, item: DrawItem, res: Pick<Resources, "kit">) {
  const shape = item.layer.icon ? icon(item.layer.icon) : null;
  const { x, y, w, h } = item.box;
  if (!shape) {
    // Missing icon: a dashed placeholder, so the gap is obvious (and the check reports it).
    ctx.strokeStyle = item.color!;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    return;
  }
  // the icon's own box, fitted into the layer's box and centred
  const k = Math.min(w / shape.box.w, h / shape.box.h);
  const ox = x + (w - shape.box.w * k) / 2;
  const oy = y + (h - shape.box.h * k) / 2;
  if (shape.kind === "image") {
    // colour icons (emoji, logos, flags) keep their own colours; they appear while drawing on
    if (!shape.image) return;
    ctx.save();
    ctx.globalAlpha *= item.trim;
    ctx.drawImage(shape.image, ox, oy, shape.box.w * k, shape.box.h * k);
    ctx.restore();
    return;
  }
  const place = (lines: Polyline[]) => lines.map((pl) => ({ closed: pl.closed, points: pl.points.map(([px, py]) => [ox + px * k, oy + py * k] as [number, number]) }));
  const paint = item.paint ? canvasPaint(ctx, res.kit, item.paint, item.box) : item.color!;
  for (const part of shape.parts) {
    ctx.save();
    ctx.globalAlpha *= part.opacity;
    const lines = place(part.lines);
    if (part.kind === "fill") {
      ctx.fillStyle = paint;
      if (item.trim < 1) ctx.globalAlpha *= item.trim; // a filled icon fades in while it draws on
      ctx.fill(toPath2D(lines), part.evenodd ? "evenodd" : "nonzero");
    } else {
      ctx.strokeStyle = paint;
      ctx.lineWidth = part.width * k;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(toPath2D(trimLines(lines, item.trim)));
    }
    ctx.restore();
  }
}

function drawChart(ctx: Ctx, item: DrawItem, res: Resources, t: number) {
  const layer = item.layer;
  const data = layer.data ?? { values: [] };
  const values = data.values;
  const { x, y, w, h } = item.box;
  // Charts build themselves over a second unless a drawOn says otherwise.
  const built = item.trim < 1 ? item.trim : Math.min(1, Math.max(0, (t - layer.start) / 1.0));
  const k = 1 - (1 - built) ** 3;
  const primary = item.color!;
  const muted = resolveColor(res.kit, "brand.muted");
  const ink = resolveColor(res.kit, "brand.onSurface");
  const font = (px: number, weight = 500) => `${weight} ${px}px "${res.kit.fonts.body}", "${res.kit.fonts.latin}"`;
  const labelPx = res.unit * 3.2;
  ctx.textBaseline = "alphabetic";
  const rtl = item.dir === "rtl";
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  if (layer.chart === "number") {
    const value = (values[0] ?? 0) * k;
    ctx.font = font(h * 0.6, 800);
    ctx.fillStyle = primary;
    ctx.textAlign = "center";
    const text = `${value.toFixed(Number.isInteger(values[0] ?? 0) ? 0 : 1)}${data.unit ?? ""}`;
    ctx.fillText(text, x + w / 2, y + h * 0.72);
    return;
  }
  if (layer.chart === "pie") {
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const r = Math.min(w, h) / 2;
    let a0 = -Math.PI / 2;
    const palette = [primary, resolveColor(res.kit, "brand.accent"), muted, ink, resolveColor(res.kit, "brand.surface2")];
    values.forEach((v, i) => {
      const da = ((Math.max(0, v) / total) * Math.PI * 2) * k;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + h / 2);
      ctx.arc(x + w / 2, y + h / 2, r, a0, a0 + da);
      ctx.closePath();
      ctx.fillStyle = palette[i % palette.length];
      ctx.fill();
      a0 += da;
    });
    return;
  }
  const labelsH = data.labels?.length ? labelPx * 1.8 : 0;
  const plotH = h - labelsH - labelPx * 1.6;
  const top = y + labelPx * 1.6;
  const n = values.length;
  const slot = w / n;
  const xs = values.map((_, i) => {
    const idx = rtl ? n - 1 - i : i;
    return x + slot * idx + slot / 2;
  });
  if (layer.chart === "line") {
    const pts: [number, number][] = values.map((v, i) => [xs[i], top + plotH - (Math.max(0, v) / max) * plotH]);
    const ordered = rtl ? [...pts].reverse() : pts;
    ctx.strokeStyle = primary;
    ctx.lineWidth = res.unit * 0.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(toPath2D(trimLines([{ points: ordered, closed: false }], k)));
  } else {
    const bw = slot * 0.62;
    values.forEach((v, i) => {
      const bh = (Math.max(0, v) / max) * plotH * k;
      ctx.fillStyle = primary;
      ctx.fill(toPath2D(rectPath(xs[i] - bw / 2, top + plotH - bh, bw, bh, Math.min(res.unit, bh / 2))));
      if (k > 0.6) {
        ctx.globalAlpha *= 1;
        ctx.font = font(labelPx, 600);
        ctx.fillStyle = ink;
        ctx.textAlign = "center";
        ctx.fillText(`${v}${data.unit ?? ""}`, xs[i], top + plotH - bh - labelPx * 0.5);
      }
    });
  }
  if (data.labels?.length) {
    ctx.font = font(labelPx, 500);
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    data.labels.forEach((label, i) => {
      if (i < n) ctx.fillText(label, xs[i], y + h - labelPx * 0.3);
    });
  }
}

function applyMask(ctx: Ctx, item: DrawItem) {
  const m = item.mask;
  if (!m) return;
  const b = item.box;
  const rtl = item.dir === "rtl";
  // "start" reveals from the reading start: the right edge in RTL.
  let dir = m.dir;
  if (dir === "start") dir = rtl ? "end" : "start";
  else if (dir === "end") dir = rtl ? "start" : "end";
  ctx.beginPath();
  const p = Math.max(0, Math.min(1, m.p));
  if (dir === "start") ctx.rect(b.x - 2, b.y - b.h, (b.w + 4) * p, b.h * 3);
  else if (dir === "end") ctx.rect(b.x + b.w + 2 - (b.w + 4) * p, b.y - b.h, (b.w + 4) * p, b.h * 3);
  else if (dir === "up") ctx.rect(b.x - b.w, b.y + b.h + 2 - (b.h + 4) * p, b.w * 3, (b.h + 4) * p);
  else ctx.rect(b.x - b.w, b.y - 2, b.w * 3, (b.h + 4) * p);
  ctx.clip();
}

function drawItem(ctx: Ctx, item: DrawItem, res: Resources, t: number) {
  if (item.opacity <= 0.001) return;
  const layer = item.layer;
  ctx.save();
  ctx.globalAlpha *= item.opacity;
  ctx.globalCompositeOperation = BLEND[layer.blend ?? "normal"] ?? "source-over";
  if (item.blur > 0.05) ctx.filter = `blur(${(item.blur * res.unit) / 8}px)`;
  const cx = item.box.x + item.box.w / 2;
  const cy = item.box.y + item.box.h / 2;
  ctx.translate(item.tx + cx, item.ty + cy);
  if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
  if (item.scale !== 1) ctx.scale(item.scale, item.scale);
  ctx.translate(-cx, -cy);
  applyMask(ctx, item);
  if (layer.glow) {
    // a glow is a shadow with no offset, in the glow's colour
    applyShadow(ctx, { color: layer.glow.color ?? "brand.primary", blur: layer.glow.size ?? 4, x: 0, y: 0, opacity: 0.9 }, res);
  } else if (typeof layer.shadow === "object" && layer.type !== "text") {
    applyShadow(ctx, layer.shadow, res);
  } else if (layer.shadow && layer.type !== "text") {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = res.unit * 3;
    ctx.shadowOffsetY = res.unit * 0.8;
  }
  switch (item.type) {
    case "text":
    case "captions":
      drawText(ctx, item, res);
      break;
    case "shape":
      drawShape(ctx, item, res);
      break;
    case "icon":
      drawIcon(ctx, item, res);
      break;
    case "image": {
      const src = layer.asset ? res.images.get(layer.asset) : undefined;
      if (src) drawPicture(ctx, item, src, res);
      break;
    }
    case "video": {
      const src = res.video?.(layer, item.sourceTime ?? 0);
      if (src) drawPicture(ctx, item, src, res);
      break;
    }
    case "lottie":
      res.lottie?.(layer, ctx, item.box, t - layer.start);
      break;
    case "chart":
      drawChart(ctx, item, res, t);
      break;
    case "group":
      for (const child of item.children ?? []) drawItem(ctx, child, res, t);
      break;
  }
  ctx.restore();
}

/** Draws `frame` at `scale` (1 = the composition's own pixels). */
export function renderFrame(ctx: Ctx, frame: Frame, res: Resources, scale = 1): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = frame.backgroundPaint ? canvasPaint(ctx, res.kit, frame.backgroundPaint, { x: 0, y: 0, w: frame.width, h: frame.height }) : frame.background;
  ctx.fillRect(0, 0, frame.width, frame.height);
  for (const item of frame.items) drawItem(ctx, item, res, frame.t);
  ctx.restore();
}

/** Draws only the items below `stopAt` (for measuring what's behind a text). */
export function renderBelow(ctx: Ctx, frame: Frame, res: Resources, stopAt: number, scale = 1): void {
  renderFrame(ctx, { ...frame, items: frame.items.filter((i) => i.z < stopAt) }, res, scale);
}

export { makeCanvas };
