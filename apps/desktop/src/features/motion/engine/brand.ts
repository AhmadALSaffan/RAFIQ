import { cssFamily } from "./fonts";
import type { BrandKit, ColorRef, Composition, Gradient, Paint, TypeStyle } from "./types";

/** The dark template — what a workspace without a kit of its own uses (agent: motion/brand.py). */
export const DEFAULT_KIT: BrandKit = {
  name: "dark",
  colors: {
    surface: "#0e0e0e",
    surface2: "#1c1c1b",
    onSurface: "#f2f2ef",
    muted: "#9a9a93",
    primary: "#e68835",
    onPrimary: "#1f1306",
    accent: "#3b82f6",
  },
  fonts: { display: "Alexandria", body: "IBM Plex Sans Arabic", latin: "Inter", mono: "IBM Plex Mono" },
  type: { display: 96, headline: 64, title: 44, body: 32, caption: 28 },
  spacing: [1, 2, 3, 4, 6, 8, 12],
  radius: [0, 8, 16, 999],
  motion: { personality: "calm", enter: 0.5, exit: 0.35, ease: "outExpo" },
  logo: null,
};

export const TEXT_WEIGHT: Record<TypeStyle, number> = { display: 800, headline: 700, title: 700, body: 500, caption: 500 };
export const LINE_HEIGHT: Record<TypeStyle, number> = { display: 1.18, headline: 1.22, title: 1.3, body: 1.5, caption: 1.45 };

/** One grid unit in canvas px: 8px on a 1080px short side. */
export function unitPx(comp: Composition): number {
  return (8 * Math.min(comp.width, comp.height)) / 1080;
}

/** A type style's size in canvas px for this frame. */
export function stylePx(kit: BrandKit, comp: Composition, style: TypeStyle): number {
  return (kit.type[style] * Math.min(comp.width, comp.height)) / 1080;
}

/** brand.primary → #e68835. Unknown tokens fall back to onSurface so a typo is visible, not black. */
export function resolveColor(kit: BrandKit, ref: ColorRef | undefined, fallback = "onSurface"): string {
  const value = ref ?? `brand.${fallback}`;
  if (value === "transparent") return "rgba(0,0,0,0)";
  if (value.startsWith("#")) return value;
  const role = value.startsWith("brand.") ? value.slice(6) : value;
  return kit.colors[role] ?? kit.colors[fallback] ?? "#ffffff";
}

export function isGradient(paint: Paint | undefined): paint is Gradient {
  return typeof paint === "object" && paint !== null && Array.isArray((paint as Gradient).stops);
}

/** One colour standing for a paint (a gradient's middle stop) — for checks and keyframes. */
export function paintColor(kit: BrandKit, paint: Paint | undefined, fallback = "onSurface"): string {
  if (isGradient(paint)) {
    const stops = paint.stops;
    return resolveColor(kit, stops[Math.floor(stops.length / 2)]?.color ?? stops[0]?.color, fallback);
  }
  return resolveColor(kit, paint, fallback);
}

export function isBrandColor(ref: ColorRef | undefined): boolean {
  return ref === undefined || ref === "transparent" || ref.startsWith("brand.");
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return [255, 255, 255];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relLuminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export function mixColor(a: string, b: string, u: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * u).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** The CSS font stack for a role: the kit's font, then Latin, then what the app ships.
 * Every face here is loaded before drawing (fonts.ts), so the stack never actually falls back. */
export function fontStack(kit: BrandKit, role: "display" | "body" | "latin" | "mono"): string {
  const first = role === "mono" ? (kit.fonts.mono ?? "IBM Plex Mono") : kit.fonts[role];
  const stack = [first, kit.fonts.latin, "IBM Plex Sans Arabic", "Alexandria"];
  return [...new Set(stack.map(cssFamily))].map((f) => `"${f}"`).join(", ");
}
