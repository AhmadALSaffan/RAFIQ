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
  type: "image" | "svg" | "video" | "audio" | "lottie" | "model";
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
  | "zoomPunch" | "shake" | "float" | "blurIn" | "bounceIn" | "rotateIn" | "spin" | "pulse" | "sweep";

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

// ── 3D (a scene3d layer: three.js draws it, the frame takes it like a picture) ─────────

export type Vec3 = [number, number, number];

/** A 3D key: `t` in scene seconds like every other key; `v` a number, an [x, y, z] or a colour. */
export interface Key3 {
  t: number;
  v: number | Vec3 | string;
  ease?: Ease;
}

export type Preset3 =
  | "rise" | "drop" | "pop" | "spinIn" | "flip" | "slideIn" | "zoomIn" | "fadeIn" | "fadeOut"
  | "float" | "turntable" | "orbit" | "pulse" | "grow" | "assemble" | "scatter" | "draw";

export interface Anim3 {
  preset: Preset3;
  at: number;
  duration?: number;
  ease?: Ease | "bounce";
  /** Distance (rise, drop, slideIn, zoomIn, float, pulse) or degrees per second (turntable, orbit). */
  amount?: number;
  /** Seconds between the parts (letters, words, instances, group children). */
  stagger?: number;
  axis?: "x" | "y" | "z";
  dir?: "start" | "end" | "up" | "down";
}

export type Material3Name =
  | "chrome" | "gold" | "metal" | "glass" | "frosted" | "plastic" | "clay" | "rubber" | "matte"
  | "neon" | "holographic" | "toon" | "wire" | "glow";

export interface Material3 {
  preset?: Material3Name;
  color?: ColorRef;
  metalness?: number;
  roughness?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
  clearcoat?: number;
  iridescence?: number;
  emissive?: ColorRef;
  emissiveIntensity?: number;
  opacity?: number;
  wireframe?: boolean;
  flat?: boolean;
  /** Pictures on the surface, by asset name: colour, bumps, a normal map, roughness, and
   *  what glows by itself (city lights on a night side). */
  map?: string;
  bumpMap?: string;
  bumpScale?: number;
  normalMap?: string;
  roughnessMap?: string;
  emissiveMap?: string;
}

export type Object3Kind =
  | "box" | "sphere" | "cylinder" | "cone" | "torus" | "torusKnot" | "capsule" | "plane" | "ring" | "icosahedron"
  | "text3d" | "extrude" | "model" | "image" | "particles" | "instances" | "tube" | "globe" | "ground" | "blob" | "group";

export type ParticleShape =
  | "sphere" | "shell" | "disc" | "ring" | "cube" | "galaxy" | "grid" | "wave" | "random" | "helix" | "text" | "image" | "point";

export interface Object3 {
  id?: string;
  kind: Object3Kind;
  name?: string;
  position?: Vec3;
  /** Degrees. */
  rotation?: Vec3;
  scale?: number | Vec3;
  material?: Material3Name | Material3;
  /** A picture wrapped on the surface (an image asset): a planet's map on a sphere, a label on a box. */
  texture?: string;
  color?: ColorRef;
  opacity?: number;
  shadow?: boolean;
  /** Where the object's origin sits: its centre, or the middle of its base (bars that grow up). */
  pivot?: "center" | "bottom";
  size?: number;
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  thickness?: number;
  segments?: number;
  // text3d
  text?: string;
  font?: "display" | "body" | "latin";
  weight?: number;
  bevel?: number;
  align?: "start" | "center" | "end";
  split?: "none" | "words" | "letters";
  /** Shrinks to stay inside the frame's width (titles in a narrow reel). */
  fit?: boolean;
  // extrude
  svg?: string;
  icon?: string;
  // model / image / particles from a picture
  asset?: string;
  animation?: string;
  cornerRadius?: number;
  // particles
  count?: number;
  shape?: ParticleShape;
  to?: ParticleShape;
  toText?: string;
  colors?: ColorRef[];
  drift?: number;
  arms?: number;
  glow?: boolean;
  // instances
  of?: "box" | "sphere" | "cylinder" | "cone" | "icosahedron" | "torus" | "capsule";
  layout?: "grid" | "wall" | "ring" | "spiral" | "random" | "city" | "line" | "helix";
  rows?: number;
  cols?: number;
  gap?: number;
  // tube
  points?: Vec3[];
  // globe
  style?: "dots" | "wire" | "solid" | "texture";
  arcs?: { from: [number, number]; to: [number, number]; color?: ColorRef; at?: number; duration?: number }[];
  markers?: [number, number][];
  atmosphere?: ColorRef;
  // blob
  noise?: number;
  speed?: number;
  // ground
  reflect?: number;
  children?: Object3[];
  animate?: Anim3[];
  keyframes?: Record<string, Key3[]>;
}

export interface Camera3 {
  fov?: number;
  position?: Vec3;
  target?: Vec3;
  move?: { type: "orbit" | "dolly" | "push" | "crane" | "handheld" | "none"; amount?: number; ease?: Ease; at?: number; duration?: number };
  keyframes?: { position?: Key3[]; target?: Key3[]; fov?: Key3[] };
}

export interface Light3 {
  type: "key" | "fill" | "rim" | "ambient" | "point" | "spot" | "hemisphere";
  color?: ColorRef;
  ground?: ColorRef;
  intensity?: number;
  position?: Vec3;
  shadow?: boolean;
}

export type Environment3 = "studio" | "city" | "sunset" | "night" | "dawn" | "none";

export type Recipe3 =
  | "logoReveal" | "productSpin" | "particleText" | "galaxy" | "solarSystem" | "globeArcs" | "cardStack"
  | "voxelCity" | "kineticType3D" | "chromeBlob" | "bars3D" | "physicsDrop";

export interface Scene3D {
  /** A finished look from a few params; the fields below add to it or override it. */
  recipe?: Recipe3;
  params?: Record<string, unknown>;
  seed?: number;
  /** Behind the 3D, inside the layer's box (default: transparent, the layers below show). */
  background?: Paint;
  environment?: Environment3 | { preset: Environment3; intensity?: number; rotation?: number };
  fog?: { color?: ColorRef; near?: number; far?: number };
  exposure?: number;
  camera?: Camera3;
  lights?: Light3[];
  objects?: Object3[];
  post?: { bloom?: number; vignette?: number; grain?: number };
}

export interface Layer {
  id: string;
  type: "text" | "shape" | "image" | "icon" | "video" | "lottie" | "chart" | "captions" | "group" | "scene3d";
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
  /** A font family for this text alone, over its role's (any family, like scene.fonts). */
  fontFamily?: string;
  /** An exact size for this text, px on a 1080 short side, over its style's. */
  size?: number;
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
  // scene3d
  scene3d?: Scene3D;
}

/** A note on a beat: a pitch ("C4", "F#3", a MIDI number), a chord ("Am7", "Fmaj7", "G/3"),
 *  or several at once; `d` beats long, `v` how hard (0..1). */
export interface ScoreNote {
  t: number;
  n: number | string | (number | string)[];
  d?: number;
  v?: number;
}

/** One part of a composed score: an instrument playing notes, or a drum playing hits or steps. */
export interface ScorePart {
  instrument?: string;
  drum?: string;
  notes?: ScoreNote[];
  /** drums: beats to hit on */
  hits?: number[];
  /** drums: one character per 16th — "x" a hit, "X" an accent, "." a rest ("x...x...x...x...") */
  steps?: string;
  /** repeat every this many beats */
  loop?: number;
  /** play only between these beats */
  from?: number;
  to?: number;
  octave?: number;
  gain?: number;
  pan?: number;
  reverb?: number;
  // shaping the instrument
  wave?: "sine" | "saw" | "square" | "triangle" | "fm" | "noise" | "string" | "piano" | "organ";
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  cutoff?: number;
  resonance?: number;
  detune?: number;
  vibrato?: number;
  /** drums: semitones up or down */
  tune?: number;
}

export interface AudioTrack {
  id: string;
  source: "procedural" | "sfx" | "asset" | "tts" | "compose";
  /** compose: the score's parts (tempo from `tempo`, beats from the track's start) */
  parts?: ScorePart[];
  /** compose: room size of the reverb, 0..1 */
  reverb?: number;
  /** compose: pads and chords duck under the kick (default on) */
  sidechain?: boolean;
  /** compose: off-beat 8ths pushed late, 0..0.5 */
  swing?: number;
  /** sfx: semitones up or down, and a length factor (0.5 = twice as fast) */
  tune?: number;
  length?: number;
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
  /** This video's own colours for the brand.* tokens (surface, primary…), over the kit's. */
  palette?: Record<string, string>;
  /** This video's own fonts (any family: shipped ones, or any Google Fonts family). */
  fonts?: { display?: string; body?: string; latin?: string; mono?: string };
  /** This video's own type scale, px on a 1080 short side (a reel wants bigger type). */
  type?: Partial<Record<TypeStyle, number>>;
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
