/**
 * The built-in icon library, offline (see iconSets.ts for the sets and their licences).
 * One-colour icons become paths — parts that are filled or stroked, each with its width and
 * opacity — so they take the layer's colour, draw on, and export to Lottie. Colour icons
 * (emoji, logos, flags) keep their SVG and draw as pictures. A set loads the first time a
 * scene uses one of its icons, then stays.
 */

import { parsePath, type Polyline } from "./paths";
import { COLOUR_PREFIXES, ICON_SETS, iconPrefix } from "./iconSets";

export interface IconPart {
  kind: "stroke" | "fill";
  /** SVG path data in the icon's own box. */
  path: string;
  lines: Polyline[];
  /** Stroke width in box units. */
  width: number;
  opacity: number;
  evenodd: boolean;
}

export interface IconShape {
  /** "image": a colour icon drawn as a picture. */
  kind: "stroke" | "fill" | "image";
  /** The icon's own box (24×24 for most sets, 256×256 for Phosphor). */
  box: { w: number; h: number };
  parts: IconPart[];
  /** Every part's outline together (lengths for draw-on, the old single-path users). */
  lines: Polyline[];
  path: string;
  /** The whole icon as SVG markup — previews, and pictures for colour icons. */
  svg: string;
  /** Decoded picture of a colour icon. */
  image?: HTMLImageElement;
}

type TablerNode = [string, Record<string, string | number>];
interface IconifyJSON {
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string; hFlip?: boolean; vFlip?: boolean; rotate?: number }>;
}

const ICONIFY: Record<string, () => Promise<{ default: unknown }>> = {
  ph: () => import("@iconify-json/ph/icons.json"),
  lucide: () => import("@iconify-json/lucide/icons.json"),
  mdi: () => import("@iconify-json/mdi/icons.json"),
  ri: () => import("@iconify-json/ri/icons.json"),
  iconoir: () => import("@iconify-json/iconoir/icons.json"),
  heroicons: () => import("@iconify-json/heroicons/icons.json"),
  "fluent-emoji-flat": () => import("@iconify-json/fluent-emoji-flat/icons.json"),
  logos: () => import("@iconify-json/logos/icons.json"),
  "circle-flags": () => import("@iconify-json/circle-flags/icons.json"),
};

let tabler: Record<string, TablerNode[]> | null = null;
let brands: Map<string, string> | null = null;
const sets = new Map<string, IconifyJSON>();
const cache = new Map<string, IconShape | null>();

function circle(cx: number, cy: number, rx: number, ry = rx) {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
}

function rectPathD(x: number, y: number, w: number, h: number, rx: number, ry: number) {
  if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}z`;
  const a = Math.min(rx || ry, w / 2);
  const b = Math.min(ry || rx, h / 2);
  return `M${x + a} ${y}h${w - 2 * a}a${a} ${b} 0 0 1 ${a} ${b}v${h - 2 * b}a${a} ${b} 0 0 1 ${-a} ${b}h${-(w - 2 * a)}a${a} ${b} 0 0 1 ${-a} ${-b}v${-(h - 2 * b)}a${a} ${b} 0 0 1 ${a} ${-b}z`;
}

/** One SVG element as path data (path, circle, ellipse, rect, line, polyline, polygon). */
function elementPath(tag: string, a: (k: string) => string | null): string | null {
  const n = (k: string) => Number(a(k) ?? 0);
  switch (tag) {
    case "path":
      return a("d");
    case "circle":
      return circle(n("cx"), n("cy"), n("r"));
    case "ellipse":
      return circle(n("cx"), n("cy"), n("rx"), n("ry"));
    case "line":
      return `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    case "rect":
      return rectPathD(n("x"), n("y"), n("width"), n("height"), n("rx"), n("ry"));
    case "polyline":
    case "polygon": {
      const pts = String(a("points") ?? "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? `${d}z` : d;
    }
    default:
      return null;
  }
}

function nodesToPath(nodes: TablerNode[]): string {
  const parts: string[] = [];
  for (const [tag, attrs] of nodes) {
    const d = elementPath(tag, (k) => (attrs[k] === undefined ? null : String(attrs[k])));
    if (d) parts.push(d);
  }
  return parts.join(" ");
}

interface Paint {
  fill: string;
  stroke: string;
  width: number;
  opacity: number;
  fillOpacity: number;
  evenodd: boolean;
}

/** An Iconify body (one-colour) → filled and stroked parts, attributes inherited from <g>. */
export function bodyToParts(body: string): IconPart[] {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`, "image/svg+xml");
  const raw: Omit<IconPart, "lines">[] = [];
  const walk = (el: Element, inherited: Paint) => {
    const get = (k: string) => el.getAttribute(k);
    const paint: Paint = {
      fill: get("fill") ?? inherited.fill,
      stroke: get("stroke") ?? inherited.stroke,
      width: get("stroke-width") !== null ? Number(get("stroke-width")) : inherited.width,
      opacity: inherited.opacity * (get("opacity") !== null ? Number(get("opacity")) : 1),
      fillOpacity: get("fill-opacity") !== null ? Number(get("fill-opacity")) : inherited.fillOpacity,
      evenodd: get("fill-rule") !== null ? get("fill-rule") === "evenodd" : inherited.evenodd,
    };
    const tag = el.tagName.toLowerCase();
    if (tag === "g" || tag === "svg") {
      for (const child of Array.from(el.children)) walk(child, paint);
      return;
    }
    const d = elementPath(tag, get);
    if (!d) return;
    if (paint.fill !== "none") raw.push({ kind: "fill", path: d, width: 0, opacity: paint.opacity * paint.fillOpacity, evenodd: paint.evenodd });
    if (paint.stroke !== "none" && paint.stroke !== "") raw.push({ kind: "stroke", path: d, width: paint.width, opacity: paint.opacity, evenodd: false });
  };
  // SVG's own default: filled, no stroke
  walk(doc.documentElement, { fill: "currentColor", stroke: "none", width: 1, opacity: 1, fillOpacity: 1, evenodd: false });
  // neighbours drawn the same way become one part
  const merged: Omit<IconPart, "lines">[] = [];
  for (const part of raw) {
    const last = merged[merged.length - 1];
    if (last && last.kind === part.kind && last.width === part.width && last.opacity === part.opacity && last.evenodd === part.evenodd) last.path += ` ${part.path}`;
    else merged.push({ ...part });
  }
  return merged.map((p) => ({ ...p, lines: parsePath(p.path, 10) }));
}

function svgFor(body: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

function single(kind: "stroke" | "fill", path: string, width: number, evenodd: boolean, box: number): IconShape {
  const lines = parsePath(path, 10);
  const attrs = kind === "stroke" ? `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"` : `fill="currentColor"${evenodd ? ' fill-rule="evenodd"' : ""}`;
  return {
    kind,
    box: { w: box, h: box },
    parts: [{ kind, path, lines, width, opacity: 1, evenodd }],
    lines,
    path,
    svg: svgFor(`<path ${attrs} d="${path}"/>`, box, box),
  };
}

async function loadSet(prefix: string): Promise<IconifyJSON | null> {
  if (sets.has(prefix)) return sets.get(prefix)!;
  const load = ICONIFY[prefix];
  if (!load) return null;
  const json = (await load()).default as IconifyJSON;
  sets.set(prefix, json);
  return json;
}

function decode(svg: string): Promise<HTMLImageElement | undefined> {
  if (typeof Image === "undefined") return Promise.resolve(undefined);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return img.decode().then(
    () => img,
    () => undefined,
  );
}

async function iconifyShape(prefix: string, name: string): Promise<IconShape | null> {
  const json = await loadSet(prefix);
  if (!json) return null;
  let entry: IconifyJSON["icons"][string] | undefined = json.icons[name];
  if (!entry) {
    const alias = json.aliases?.[name];
    entry = alias ? json.icons[alias.parent] : undefined;
  }
  if (!entry) return null;
  const w = entry.width ?? json.width ?? 16;
  const h = entry.height ?? json.height ?? 16;
  const svg = svgFor(entry.body, w, h);
  if (COLOUR_PREFIXES.has(prefix)) {
    return { kind: "image", box: { w, h }, parts: [], lines: [], path: "", svg, image: await decode(svg) };
  }
  const parts = bodyToParts(entry.body);
  if (!parts.length) return null;
  const lines = parts.flatMap((p) => p.lines);
  return { kind: parts.every((p) => p.kind === "stroke") ? "stroke" : "fill", box: { w, h }, parts, lines, path: parts.map((p) => p.path).join(" "), svg };
}

/** Makes sure every icon in `names` is ready for `icon()`. */
export async function loadIcons(names: string[]): Promise<void> {
  const wanted = [...new Set(names)].filter((n) => !cache.has(n));
  if (!wanted.length) return;
  if (wanted.some((n) => n.startsWith("tabler:")) && !tabler) {
    tabler = (await import("tabler-nodes-outline")).default as Record<string, TablerNode[]>;
  }
  if (wanted.some((n) => n.startsWith("si:")) && !brands) {
    brands = new Map(Object.entries((await import("virtual:simple-icon-paths")).default));
  }
  await Promise.all(
    wanted.map(async (full) => {
      const prefix = iconPrefix(full);
      const name = full.slice(prefix.length + 1);
      try {
        if (prefix === "tabler") cache.set(full, tabler?.[name] ? single("stroke", nodesToPath(tabler[name]), 2, false, 24) : null);
        else if (prefix === "si") cache.set(full, brands?.has(name) ? single("fill", brands.get(name)!, 0, true, 24) : null);
        else cache.set(full, await iconifyShape(prefix, name));
      } catch {
        cache.set(full, null);
      }
    }),
  );
}

export function icon(name: string): IconShape | null {
  return cache.get(name) ?? null;
}

export async function iconExists(name: string): Promise<boolean> {
  await loadIcons([name]);
  return icon(name) !== null;
}

let names: Record<string, string[]> | null = null;

/** Every icon name, by set. */
export async function iconNames(): Promise<Record<string, string[]>> {
  names ??= (await import("virtual:icon-names")).default;
  return names;
}

/** Icon names for a search box: exact names first, then names that start with the query,
 * then names that contain it — across every set, or one (`prefix`). Words match in any order. */
export async function searchIcons(query: string, limit = 60, prefix?: string): Promise<string[]> {
  const all = await iconNames();
  const words = query.trim().toLowerCase().replace(/[_\s]+/g, " ").split(" ").filter(Boolean);
  const order = ICON_SETS.map((s) => s.prefix).filter((p) => !prefix || p === prefix);
  const scored: [number, number, string][] = [];
  order.forEach((p, setRank) => {
    for (const n of all[p] ?? []) {
      if (words.length && !words.every((w) => n.includes(w))) continue;
      const joined = words.join("-");
      const rank = !words.length ? 3 : n === joined ? 0 : n.startsWith(joined) ? 1 : 2;
      scored.push([rank * 100 + setRank, n.length, `${p}:${n}`]);
    }
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map((s) => s[2]);
}
