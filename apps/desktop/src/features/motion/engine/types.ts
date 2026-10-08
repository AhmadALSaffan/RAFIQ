/**
 * Rafiq Motion Scene (RMS v1) — the document the model writes and the engine draws.
 * The JSON Schema the agent validates against is skills/bundled/motion/schema.json; these
 * types follow it field for field.
 */

export type ColorRef = string; // "brand.<role>" | "transparent" | "#rgb" | "#rrggbb" | "#rrggbbaa"

/** A gradient, wherever a fill can go: `angle` in degrees for linear (0 = left to right). */
export interface Gradient {
  type: "linear" | "radial";
  angle?: number;
  stops: { at: number; color: ColorRef }[];
}

/** A solid colour or a gradient. */
export type Paint = ColorRef | Gradient;

/** A drop shadow or a glow: colour, softness and offset in grid units. */
export interface ShadowSpec {
  color?: ColorRef;
  blur?: number;
  x?: number;
  y?: number;
  opacity?: number;
}
export type Anchor = "center" | "top" | "bottom" | "start" | "end" | "topStart" | "topEnd" | "bottomStart" | "bottomEnd";
export type TypeStyle = "display" | "headline" | "title" | "body" | "caption";
export type Ease = string; // linear | inOut | in | out | outExpo | outBack | spring | spring(k,d) | brand

export interface Composition {
  width: number;
  height: number;
  fps: number;
  duration: number;
  background?: Paint;
  safeArea?: "reels" | "youtube" | "square" | "none";
  direction?: "rtl" | "ltr";
  margin?: number;
  digits?: "latin" | "arabic";
}

export interface Asset {
  type: "image" | "svg" | "video" | "audio" | "lottie";
  src: string; // asset://<id>
  name?: string;
  credit?: string;
  license?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface Layout {
  anchor?: Anchor;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  below?: string;
  above?: string;
  beside?: string;
  gap?: number;
  align?: "start" | "center" | "end";
}

export type PresetName =
  | "fadeIn" | "fadeOut" | "fadeUp" | "fadeDown" | "slideIn" | "slideOut" | "scaleIn" | "scaleOut" | "pop"
  | "typewriter" | "wordPop" | "lineReveal" | "maskReveal" | "countUp" | "drawOn" | "kenBurns" | "wipe"
  | "zoomPunch" | "shake" | "float" | "blurIn" | "bounceIn" | "rotateIn" | "spin" | "pulse";

export interface Animation {
  preset: PresetName;
  at: number;
  duration?: number;
  ease?: Ease;
  dir?: "start" | "end" | "up" | "down";
  amount?: number;
  to?: number;
  stagger?: number;
}

export type AnimProp = "x" | "y" | "scale" | "rotation" | "opacity" | "blur" | "trim" | "color" | "count" | "cornerRadius";

export interface Key {
  t: number;
  v: number | string;
  ease?: Ease;
}

export interface Layer {
  id: string;
  type: "text" | "shape" | "image" | "icon" | "video" | "lottie" | "chart" | "captions" | "group";
  name?: string;
  start: number;
  end: number;
  layout?: Layout;
  animate?: Animation[];
  keyframes?: Partial<Record<AnimProp, Key[]>>;
  opacity?: number;
  blend?: "normal" | "multiply" | "screen" | "overlay";
  shadow?: boolean | ShadowSpec;
  /** A coloured glow around the layer. */
  glow?: { color?: ColorRef; size?: number };
  important?: boolean;
  hidden?: boolean;
  /** Editor-only: can't be picked or dragged on the stage. */
  locked?: boolean;
  // text
  text?: string;
  style?: TypeStyle;
  color?: Paint;
  weight?: 400 | 500 | 600 | 700 | 800;
  /** An outline around the letters (width in grid units). */
  outline?: { color?: ColorRef; width?: number };
  align?: "start" | "center" | "end";
  font?: "display" | "body" | "latin" | "mono";
  background?: { color?: Paint; padding?: number; radius?: number };
  format?: { decimals?: number; group?: boolean };
  // shape
  shape?: "rect" | "circle" | "line" | "path" | "star" | "triangle" | "polygon" | "arrow" | "ring" | "arc" | "heart";
  fill?: Paint;
  stroke?: ColorRef;
  strokeWidth?: number;
  /** Dashed outline: [dash, gap] in grid units. */
  dash?: [number, number];
  /** Ring and arc band width, in grid units. */
  thickness?: number;
  /** Arc span in degrees (0 = top, clockwise). */
  arc?: { from: number; to: number };
  /** Arrow direction. */
  pointing?: "start" | "end";
  radius?: number;
  path?: string;
  points?: number;
  // image / icon / video / lottie
  asset?: string;
  icon?: string;
  fit?: "cover" | "contain";
  in?: number;
  out?: number;
  speed?: number;
  volume?: number;
  crop?: { x: number; y: number; w: number; h: number };
  filters?: { brightness?: number; contrast?: number; saturation?: number; warmth?: number; vignette?: number };
  // chart
  chart?: "bar" | "line" | "pie" | "number";
  data?: { labels?: string[]; values: number[]; unit?: string };
  // captions
  source?: string;
  words?: { w: string; t0: number; t1: number }[];
  captionStyle?: "pop" | "highlight" | "karaoke";
  maxWords?: number;
  // group
  children?: Layer[];
}

export interface AudioTrack {
  id: string;
  source: "procedural" | "sfx" | "asset" | "tts";
  pattern?: string;
  tempo?: number;
  key?: string;
  kind?: "whoosh" | "pop" | "click" | "riser" | "impact" | "swoosh" | "tick" | "ding" | "typing";
  asset?: string;
  text?: string;
  voice?: string;
  at?: number;
  end?: number;
  in?: number;
  gain?: number;
  pan?: number;
  fadeIn?: number;
  fadeOut?: number;
  duck?: string;
  loop?: boolean;
}

export interface Scene {
  version: 1;
  title?: string;
  composition: Composition;
  brand?: string;
  assets?: Record<string, Asset>;
  layers: Layer[];
  audio?: AudioTrack[];
}

export interface BrandKit {
  name?: string;
  colors: Record<string, string>;
  fonts: { display: string; body: string; latin: string; mono?: string };
  type: Record<TypeStyle, number>;
  spacing: number[];
  radius: number[];
  motion: { personality: string; enter: number; exit: number; ease: string; bezier?: [number, number, number, number] };
  logo?: string | null;
}

// ── What the evaluator hands the renderer ──────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLine {
  text: string;
  /** Left edge of the line in canvas px (already aligned). */
  x: number;
  /** Baseline in canvas px. */
  y: number;
  width: number;
  /** Per-word reveal (wordPop / typewriter on Arabic): words drawn so far, with their scale. */
  words?: { text: string; x: number; width: number; opacity: number; scale: number; highlight?: number }[];
}

export interface DrawItem {
  id: string;
  type: Layer["type"];
  layer: Layer;
  /** The layout box in canvas px, before the animated transform. */
  box: Box;
  /** The box after the transform, in canvas px (axis-aligned bounds) — what the checks use. */
  bounds: Box;
  opacity: number;
  scale: number;
  rotation: number;
  tx: number;
  ty: number;
  blur: number;
  trim: number;
  /** Reveal mask, 0..1, from `dir` (maskReveal / wipe / lineReveal). */
  mask?: { p: number; dir: "start" | "end" | "up" | "down"; soft: number };
  color?: string;
  /** A gradient fill instead of `color` (colour still holds its first stop, for the checks). */
  paint?: Gradient;
  // text
  font?: string;
  fontPx?: number;
  lines?: TextLine[];
  dir?: "rtl" | "ltr";
  textValue?: string;
  // video / image source time
  sourceTime?: number;
  children?: DrawItem[];
  z: number;
}

export interface Frame {
  t: number;
  width: number;
  height: number;
  background: string;
  backgroundPaint?: Gradient;
  items: DrawItem[];
}
