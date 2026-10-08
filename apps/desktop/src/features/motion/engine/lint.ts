/**
 * The checks (docs/MOTION-ENGINE.md, «الفاحص»). Every rule has a code and a fix. The ones
 * that need pixels run on frames this engine actually draws: contrast is measured against
 * what's really behind the text — a photo, a video frame, a shape.
 */

import { t } from "../../../i18n";
import { contrastRatio, hexToRgb, paintColor, relLuminance } from "./brand";
import { isAllowedEase } from "./easing";
import type { MotionEngine } from "./engine";
import { allLayers } from "./engine";
import { icon } from "./icons";
import { makeCanvas, renderBelow, type Ctx } from "./render";
import { BASE, valueAt } from "./tracks";
import type { Box, DrawItem, Layer, Scene } from "./types";

export interface Issue {
  code: string;
  severity: "error" | "warning";
  blocking: boolean;
  layer: string | null;
  t: number | null;
  message: string;
  fix: string;
}

const BLOCKING = new Set(["M002", "M003", "M004"]);
const ERRORS = new Set(["M002", "M003", "M004", "M007", "M008"]);
const MAJOR = new Set(["fadeIn", "fadeUp", "fadeDown", "slideIn", "scaleIn", "pop", "typewriter", "wordPop", "lineReveal", "maskReveal", "wipe", "countUp", "drawOn", "zoomPunch", "blurIn", "bounceIn", "rotateIn"]);

export function fixFor(code: string): string {
  switch (code) {
    case "M001":
      return t("قرّب لأقرب وحدة شبكة (رقم صحيح)، والـ gap من السلّم: 1, 2, 3, 4, 6, 8, 12");
    case "M002":
      return t("لون أفتح أو أغمق من الـ kit، أو ظل للنص (shadow)، أو خلفية تحته");
    case "M003":
      return t("صغّر الستايل درجة، أو قسّم السطر، أو قصّر النص");
    case "M004":
      return t("حرّكه لجوّا الإطار الآمن");
    case "M005":
      return t("طوّل ظهور النص (0.5 ث + 0.3 ث لكل كلمة على الأقل) أو قصّر النص");
    case "M006":
      return t("فرّق التوقيت: stagger بين 0.1 و 0.2 ث، وحركة رئيسية وحدة بالمرة");
    case "M007":
      return t("بدّل الـ easing بواحد مسموح: linear, inOut, outExpo, outBack, spring");
    case "M009":
      return t("حرّك واحد منهم (below / gap) أو فرّقهم بالزمن");
    case "M010":
      return t("ثبّت الـ anchor جوّا الإطار، أو ضيف حركة دخول وخروج (slideIn / slideOut)");
    case "M011":
      return t("ضيف keyframe بـ easing، أو استعمل preset بدل القفزة");
    case "M012":
      return t("استعمل ستايل أكبر (body أو title)");
    case "A001":
      return t("خفّض صوت المصدر — الإنجن بيحد الذروة بس الأحسن من المصدر");
    case "A002":
      return t("الإنجن بيظبط المستوى لـ −14 LUFS تلقائياً");
    case "A003":
      return t("ضيف duck على مسار الموسيقى تحت التعليق");
    case "L001":
      return t("Lottie ما بيحمل هالشي — شيله، أو صدّر MP4");
    default:
      return "";
  }
}

function issue(code: string, layer: string | null, message: string, time: number | null = null): Issue {
  return { code, severity: ERRORS.has(code) ? "error" : "warning", blocking: BLOCKING.has(code), layer, t: time, message, fix: fixFor(code) };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Structural (no pixels) — the same rules as the agent's motion/lint.py ─────────────


export function structuralIssues(scene: Scene, kitTypes: Record<string, number>, spacing: number[], target: "mp4" | "lottie" = "mp4"): Issue[] {
  const out: Issue[] = [];
  const layers = allLayers(scene.layers);
  const gaps = new Set(spacing);
  const starts = new Map<number, Set<string>>();
  for (const layer of layers) {
    const L = layer.layout ?? {};
    for (const key of ["x", "y", "width", "height"] as const) {
      const v = L[key];
      if (typeof v === "number" && Math.abs(v - Math.round(v)) > 1e-6) out.push(issue("M001", layer.id, t("layout.{k} = {v} مش وحدة شبكة كاملة", { k: key, v })));
    }
    if (L.gap !== undefined && !gaps.has(L.gap)) out.push(issue("M001", layer.id, t("gap = {v} مش من السلّم", { v: L.gap })));
    for (const a of layer.animate ?? []) {
      if (!isAllowedEase(a.ease)) out.push(issue("M007", layer.id, t("easing «{e}» مش مسموح", { e: a.ease ?? "" }), a.at));
      if (MAJOR.has(a.preset)) {
        const at = Math.round(a.at * 10) / 10;
        const set = starts.get(at) ?? new Set();
        set.add(layer.id);
        starts.set(at, set);
      }
    }
    for (const [prop, keys] of Object.entries(layer.keyframes ?? {})) {
      for (const key of keys ?? []) if (!isAllowedEase(key.ease)) out.push(issue("M007", layer.id, t("easing «{e}» على {p} مش مسموح", { e: key.ease ?? "", p: prop }), key.t));
    }
    if (layer.type === "text") {
      const words = (layer.text ?? "").replace(/\{count\}/g, "0").trim().split(/\s+/).filter(Boolean).length;
      const shown = layer.end - layer.start;
      const need = 0.5 + 0.3 * words;
      if (words && shown < need) out.push(issue("M005", layer.id, t("النص ظاهر {s} ث وبيلزمه {n} ث ليتقرأ", { s: r2(shown), n: r2(need) }), layer.start));
    }
    if (layer.type === "text" || layer.type === "captions") {
      const style = layer.style ?? (layer.type === "captions" ? "title" : "body");
      if ((kitTypes[style] ?? 32) < 28) out.push(issue("M012", layer.id, t("حجم {s} بالـ kit أصغر من المقروء", { s: style })));
    }
    if (target === "lottie") {
      if (layer.type === "video" || layer.type === "image" || layer.type === "captions") out.push(issue("L001", layer.id, t("طبقة {k} ما بتنصدّر لـ Lottie", { k: layer.type })));
      if ((layer.blend && layer.blend !== "normal") || layer.shadow) out.push(issue("L001", layer.id, t("blend أو shadow ما بينصدّروا لـ Lottie")));
      if (layer.keyframes?.blur || (layer.animate ?? []).some((a) => a.preset === "kenBurns")) out.push(issue("L001", layer.id, t("blur و kenBurns ما بينصدّروا لـ Lottie")));
      if (layer.filters) out.push(issue("L001", layer.id, t("فلاتر الألوان ما بتنصدّر لـ Lottie")));
    }
  }
  for (const [at, ids] of [...starts.entries()].sort((a, b) => a[0] - b[0])) {
    if (ids.size > 3) out.push(issue("M006", null, t("{n} حركات رئيسية بنفس اللحظة", { n: ids.size }), at));
  }
  if (target === "lottie" && scene.audio?.length) out.push(issue("L001", null, t("الصوت ما بينصدّر مع Lottie (بيضل بالـ MP4 بس)")));
  return out;
}

// ── Frame-based ─────────────────────────────────────────────────────────────────────────

export function safeZones(scene: Scene): Box[] {
  const { width: W, height: H, safeArea } = scene.composition;
  if (safeArea === "reels") {
    const k = H / 1920;
    const kx = W / 1080;
    return [
      { x: 0, y: 0, w: W, h: 220 * k },
      { x: 0, y: H - 420 * k, w: W, h: 420 * k },
      { x: W - 120 * kx, y: 0, w: 120 * kx, h: H },
    ];
  }
  if (safeArea === "youtube" || safeArea === "square") {
    const mx = W * 0.05;
    const my = H * 0.05;
    return [
      { x: 0, y: 0, w: W, h: my },
      { x: 0, y: H - my, w: W, h: my },
      { x: 0, y: 0, w: mx, h: H },
      { x: W - mx, y: 0, w: mx, h: H },
    ];
  }
  return [];
}

function intersect(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function textBounds(item: DrawItem): Box | null {
  if (!item.lines?.length || !item.fontPx) return null;
  const xs = item.lines.map((l) => l.x);
  const xe = item.lines.map((l) => l.x + l.width);
  const top = item.lines[0].y - item.fontPx * 0.95;
  const bottom = item.lines[item.lines.length - 1].y + item.fontPx * 0.3;
  const b = { x: Math.min(...xs), y: top, w: Math.max(...xe) - Math.min(...xs), h: bottom - top };
  // the transform moves the text with its box
  const cx = item.box.x + item.box.w / 2;
  const cy = item.box.y + item.box.h / 2;
  const s = item.scale;
  return { x: cx + (b.x - cx) * s + item.tx, y: cy + (b.y - cy) * s + item.ty, w: b.w * s, h: b.h * s };
}

function isImportant(layer: Layer): boolean {
  return layer.important ?? (layer.type === "text" || layer.type === "captions");
}

function flat(items: DrawItem[]): DrawItem[] {
  return items.flatMap((i) => (i.children?.length ? [i, ...flat(i.children)] : [i]));
}

/** Sample times: a steady grid plus every start, end and animation edge. */
function sampleTimes(scene: Scene, step = 0.25): number[] {
  const d = scene.composition.duration;
  const set = new Set<number>();
  for (let x = 0; x < d; x += step) set.add(r2(x));
  for (const layer of allLayers(scene.layers)) {
    set.add(r2(layer.start));
    set.add(r2(Math.max(layer.start, Math.min(d, layer.end) - 1 / scene.composition.fps)));
    for (const a of layer.animate ?? []) {
      set.add(r2(a.at));
      if (a.duration) set.add(r2(a.at + a.duration));
    }
  }
  return [...set].filter((x) => x >= 0 && x < d).sort((a, b) => a - b).slice(0, 600);
}

/** The worst contrast between `fg` and the pixels under `box` in an already drawn canvas. */
function worstContrast(ctx: Ctx, box: Box, scale: number, fg: string, W: number, H: number): number {
  const x0 = Math.max(0, Math.floor(box.x * scale));
  const y0 = Math.max(0, Math.floor(box.y * scale));
  const x1 = Math.min(Math.ceil(W * scale), Math.ceil((box.x + box.w) * scale));
  const y1 = Math.min(Math.ceil(H * scale), Math.ceil((box.y + box.h) * scale));
  if (x1 <= x0 || y1 <= y0) return 21;
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const text = relLuminance(hexToRgb(fg));
  const ratios: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 4 / 4000));
  for (let i = 0; i < data.length; i += 4 * stride) ratios.push(contrastRatio(text, relLuminance([data[i], data[i + 1], data[i + 2]])));
  if (!ratios.length) return 21;
  ratios.sort((a, b) => a - b);
  // The worst tenth of what's behind the text decides — a photo with one bright patch
  // under a white word fails, a few stray pixels don't.
  return ratios[Math.floor(ratios.length * 0.1)];
}

export interface LintOptions {
  target?: "mp4" | "lottie";
  /** Pixel scale for contrast sampling (0.25 = a quarter of the frame). */
  pixelScale?: number;
}

export async function lintScene(engine: MotionEngine, options: LintOptions = {}): Promise<Issue[]> {
  const scene = engine.scene;
  const kit = engine.kit;
  const comp = scene.composition;
  const p = engine.prepared;
  const out = structuralIssues(scene, kit.type, kit.spacing, options.target ?? "mp4");
  const seen = new Set<string>();
  const once = (key: string, make: () => Issue) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(make());
  };
  const short = Math.min(comp.width, comp.height);
  const minPx = (28 * short) / 1080;
  const zones = safeZones(scene);
  const frameBox: Box = { x: 0, y: 0, w: comp.width, h: comp.height };
  const scale = options.pixelScale ?? Math.min(0.5, 480 / Math.max(comp.width, comp.height));
  const canvas = makeCanvas(comp.width * scale, comp.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as Ctx;
  const smallSince = new Map<string, number>();

  // Missing pieces are errors the user should see first.
  for (const layer of allLayers(scene.layers)) {
    if (layer.type === "icon" && layer.icon && !icon(layer.icon)) {
      once(`icon-${layer.id}`, () => issue("M003", layer.id, t("الأيقونة {i} مش موجودة بالمكتبة", { i: layer.icon! })));
    }
  }
  for (const id of engine.missingAssets) once(`asset-${id}`, () => issue("M003", null, t("الأصل {a} مش موجود", { a: id })));
  for (const f of engine.missingFonts) once(`font-${f}`, () => issue("M008", null, t("الخط {f} ما تحمّل", { f })));

  for (const time of sampleTimes(scene)) {
    const frame = engine.frame(time);
    const items = flat(frame.items);
    const texts: { item: DrawItem; box: Box }[] = [];
    for (const item of items) {
      const layer = item.layer;
      const visible = item.opacity > 0.5;
      const box = (item.type === "text" || item.type === "captions") && item.lines?.length ? textBounds(item)! : item.bounds;
      if (!box) continue;
      const fillsFrame = (item.type === "video" || item.type === "image" || item.type === "group") && !layer.layout?.width && !layer.layout?.height;

      if (visible && (item.type === "text" || item.type === "captions") && item.lines?.length) {
        texts.push({ item, box });
        // M003: wider than its box, or out of the frame
        const lo = p.layout.get(item.id);
        const inner = lo ? lo.box.w - (lo.pad ?? 0) * 2 : Infinity;
        if (item.lines.some((l) => l.width > inner + 1)) once(`M003w-${item.id}`, () => issue("M003", item.id, t("النص أعرض من صندوقه"), time));
        if (box.x < -1 || box.y < -1 || box.x + box.w > comp.width + 1 || box.y + box.h > comp.height + 1) {
          once(`M003f-${item.id}`, () => issue("M003", item.id, t("النص طالع برّا الإطار"), time));
        }
        // M012 for more than 0.3s
        const px = (item.fontPx ?? 32) * item.scale;
        if (px < minPx) {
          const since = smallSince.get(item.id) ?? time;
          smallSince.set(item.id, since);
          if (time - since >= 0.3) once(`M012-${item.id}`, () => issue("M012", item.id, t("النص بيصغر لـ {px}px", { px: Math.round((px * 1080) / short) }), time));
        } else smallSince.delete(item.id);
      }
      // M004: important layers out of the safe area while fully shown
      if (visible && item.opacity > 0.95 && isImportant(layer) && !fillsFrame && zones.some((z) => intersect(z, box) > 1)) {
        once(`M004-${item.id}`, () => issue("M004", item.id, t("داخل منطقة واجهة المنصة"), time));
      }
      // M010: begins or ends partly outside the frame without moving in or out
      if (!fillsFrame && item.opacity > 0.05) {
        const atEdge = Math.abs(time - layer.start) < 1e-6 || Math.abs(time - (layer.end - 1 / comp.fps)) < 0.02;
        const moves = (p.tracks.get(item.id)?.segments.get("x")?.length ?? 0) + (p.tracks.get(item.id)?.segments.get("y")?.length ?? 0) > 0;
        const inside = intersect(box, frameBox);
        if (atEdge && !moves && inside < box.w * box.h - 1 && box.w * box.h > 0) {
          once(`M010-${item.id}`, () => issue("M010", item.id, t("بيبلّش أو بيخلص برّا الإطار"), time));
        }
      }
    }
    // M009: texts on top of each other (or a text over another important layer)
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        if (a.item.id === b.item.id) continue;
        const overlap = intersect(a.box, b.box);
        const smaller = Math.min(a.box.w * a.box.h, b.box.w * b.box.h);
        if (smaller > 0 && overlap / smaller > 0.02) {
          once(`M009-${a.item.id}-${b.item.id}`, () => issue("M009", a.item.id, t("فوق {b}", { b: b.item.id }), time));
        }
      }
    }
    // M002: contrast against what's really behind each text
    for (const { item, box } of texts) {
      if (item.opacity < 0.9 || seen.has(`M002-${item.id}`)) continue;
      const layer = item.layer;
      const fg = item.color ?? "#ffffff";
      let ratio: number;
      if (layer.background?.color) {
        ratio = contrastRatio(relLuminance(hexToRgb(fg)), relLuminance(hexToRgb(paintColor(kit, layer.background.color))));
      } else {
        renderBelow(ctx, frame, engine.resources, item.z, scale);
        ratio = worstContrast(ctx, box, scale, fg, comp.width, comp.height);
      }
      const large = (item.fontPx ?? 32) * item.scale >= (40 * short) / 1080;
      const need = layer.shadow || layer.type === "captions" ? 3 : large ? 3 : 4.5;
      if (ratio < need) once(`M002-${item.id}`, () => issue("M002", item.id, t("التباين {r}:1 وبيلزمه {n}:1", { r: r2(ratio), n: need }), time));
    }
  }

  // M011: a property that jumps between two frames, inside the layer's life
  const step = 1 / comp.fps;
  for (const layer of allLayers(scene.layers)) {
    const tracks = p.tracks.get(layer.id);
    if (!tracks || !tracks.segments.size) continue;
    let prev: number[] | null = null;
    const end = Math.min(layer.end, comp.duration);
    for (let time = layer.start; time < end; time += step) {
      const v = ["opacity", "x", "y", "scale"].map((prop) => {
        const value = valueAt(tracks, prop, time, BASE[prop], kit);
        return typeof value === "number" ? value : 0;
      });
      if (prev && time - layer.start > step * 1.5) {
        const jump =
          Math.abs(v[0] - prev[0]) > 0.5 ||
          Math.abs(v[1] - prev[1]) * p.unit > short * 0.08 ||
          Math.abs(v[2] - prev[2]) * p.unit > short * 0.08 ||
          Math.abs(v[3] - prev[3]) > 0.3;
        if (jump) {
          once(`M011-${layer.id}`, () => issue("M011", layer.id, t("قفزة مفاجئة بين فريمين"), r2(time)));
          break;
        }
      }
      prev = v;
    }
  }
  return out;
}
