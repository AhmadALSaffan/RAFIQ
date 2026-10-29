/**
 * scene3d layers on the frame: each layer's 3D scene is built once with three.js (text
 * shaped by HarfBuzz, so Arabic joins and reads right to left), and every frame sets it to
 * time t and renders it with one shared WebGL renderer, then the picture goes into the 2D
 * frame at the layer's box — like a video frame. Bloom, vignette and grain are drawn on the
 * 2D side so the layer keeps its transparency.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { fontStack, resolveColor } from "../brand";
import type { AssetLoader } from "../engine";
import { allLayers } from "../engine";
import { icon, loadIcons } from "../icons";
import { outlineLines, type Contour, type Outline } from "../outline";
import { outlinePath } from "../paths";
import { canvasPaint, type Ctx } from "../render";
import type { BrandKit, Layer, Light3, Material3, Material3Name, Object3, Scene, Scene3D, Vec3, Windows3 } from "../types";
import { expandProps } from "./props";
import { expandScene3D } from "./recipes";
import { cameraState, ease3, hashString, latLon, noise3, objectState, partState, seeded, type State3 } from "./timeline";

const DEG = Math.PI / 180;
const MAX_SIDE = 4096;
const OUTLINE_PX = 120;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// ── Colours and materials ───────────────────────────────────────────────────────────────

function color3(kit: BrandKit, ref: string | undefined, fallback = "primary"): THREE.Color {
  const css = resolveColor(kit, ref ?? `brand.${fallback}`, fallback);
  if (css.startsWith("rgba")) {
    const [r, g, b] = css.match(/[\d.]+/g)!.map(Number);
    return new THREE.Color(r / 255, g / 255, b / 255);
  }
  return new THREE.Color(css.length === 9 ? css.slice(0, 7) : css);
}

const PRESET_COLOR: Partial<Record<Material3Name, string>> = { chrome: "#ffffff", metal: "#c9ced6", gold: "#ffc864", glass: "#ffffff", frosted: "#ffffff", holographic: "#c9d4ff" };

/** A loaded picture by asset name, as a texture (`color`: in sRGB, for colour and glow maps). */
type TextureFor = (key: string | undefined, color: boolean) => THREE.Texture | null;

/** The asset names an object's surface pictures use. */
function textureKeys(o: Object3): string[] {
  const spec = typeof o.material === "object" ? o.material : {};
  return [o.texture, spec.map, spec.bumpMap, spec.normalMap, spec.roughnessMap, spec.emissiveMap].filter((k): k is string => Boolean(k));
}

function makeMaterial(o: Object3, kit: BrandKit, fallback: Material3Name = "plastic", tex?: TextureFor): THREE.Material {
  const spec: Material3 = typeof o.material === "object" ? o.material : { preset: (o.material as Material3Name) ?? fallback };
  const preset = spec.preset ?? (typeof o.material === "object" ? "plastic" : fallback);
  const mapKey = o.texture ?? spec.map;
  // a picture shows in its own colours unless a tint is asked for
  const ref = o.color ?? spec.color ?? (mapKey ? "#ffffff" : PRESET_COLOR[preset]);
  const color = color3(kit, ref);
  let m: THREE.Material;
  switch (preset) {
    case "glow":
      m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      break;
    case "neon":
      m = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.15), emissive: color, emissiveIntensity: 2.4, roughness: 0.4 });
      break;
    case "toon":
      m = new THREE.MeshToonMaterial({ color });
      break;
    case "wire":
      m = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85 });
      break;
    default: {
      const base: Record<string, Partial<THREE.MeshPhysicalMaterialParameters>> = {
        chrome: { metalness: 1, roughness: 0.07 },
        metal: { metalness: 1, roughness: 0.32 },
        gold: { metalness: 1, roughness: 0.16 },
        glass: { metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.8, ior: 1.5 },
        frosted: { metalness: 0, roughness: 0.42, transmission: 1, thickness: 1.2, ior: 1.45 },
        plastic: { metalness: 0, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 },
        clay: { metalness: 0, roughness: 0.92 },
        rubber: { metalness: 0, roughness: 0.75 },
        matte: { metalness: 0, roughness: 1 },
        holographic: { metalness: 0.8, roughness: 0.22, iridescence: 1, iridescenceIOR: 1.8, clearcoat: 0.6 },
      };
      const p = { ...(base[preset] ?? base.plastic) };
      for (const key of ["metalness", "roughness", "transmission", "ior", "thickness", "clearcoat", "iridescence"] as const) {
        if (typeof spec[key] === "number") (p as Record<string, number>)[key] = spec[key]!;
      }
      const physical = new THREE.MeshPhysicalMaterial({ color, ...p, flatShading: spec.flat ?? FACETED.has(o.kind) });
      if (spec.emissive) {
        physical.emissive = color3(kit, spec.emissive);
        physical.emissiveIntensity = spec.emissiveIntensity ?? 1;
      }
      m = physical;
    }
  }
  if (spec.wireframe && "wireframe" in m) (m as THREE.MeshBasicMaterial).wireframe = true;
  if (tex) {
    const map = tex(mapKey, true);
    if (map && "map" in m) (m as THREE.MeshStandardMaterial).map = map;
    if (m instanceof THREE.MeshStandardMaterial) {
      const bump = tex(spec.bumpMap, false);
      if (bump) {
        m.bumpMap = bump;
        m.bumpScale = spec.bumpScale ?? 1.5;
      }
      const normal = tex(spec.normalMap, false);
      if (normal) m.normalMap = normal;
      const rough = tex(spec.roughnessMap, false);
      if (rough) m.roughnessMap = rough;
      const glow = tex(spec.emissiveMap, true);
      if (glow) {
        m.emissiveMap = glow;
        if (!spec.emissive) m.emissive = new THREE.Color("#ffffff");
        m.emissiveIntensity = spec.emissiveIntensity ?? 1;
      }
      // a mapped planet or label reads better matte and non-metal by default
      if (map && typeof o.material !== "object" && !o.material) {
        m.metalness = 0;
        m.roughness = 0.85;
        if (m instanceof THREE.MeshPhysicalMaterial) m.clearcoat = 0;
      }
    }
    if (map || tex(spec.emissiveMap, true)) m.needsUpdate = true;
  }
  const opacity = spec.opacity ?? 1;
  m.userData.opacity = opacity;
  if (opacity < 1) {
    m.transparent = true;
    m.opacity = opacity;
  }
  return m;
}

// ── Façades ─────────────────────────────────────────────────────────────────────────────

/** Windows in a façade tile: TILE × TILE of them. */
const TILE = 16;

type FacadeStyle = NonNullable<Windows3["style"]>;

/** One tile of windows, as a colour map (walls white so the material's colour shows, glass
 *  darker, lit panes bright) and a glow map (only the lit panes). Wraps both ways.
 *  grid: separate windows in a wall · bands: a glass band every floor · fins: glass behind
 *  close vertical fins · curtain: a whole glass wall, faint mullions · diagrid: glass under a
 *  diagonal steel lattice. */
function drawWindowTiles(style: FacadeStyle, glass: THREE.Color, light: THREE.Color, lit: number, seed: number): { map: THREE.Texture; glow: THREE.Texture } {
  const cw = 8;
  const ch = 12;
  const width = TILE * cw;
  const height = TILE * ch;
  const map = document.createElement("canvas");
  const glow = document.createElement("canvas");
  map.width = glow.width = width;
  map.height = glow.height = height;
  const a = map.getContext("2d")!;
  const b = glow.getContext("2d")!;
  const rnd = seeded(seed ^ 0x5f3759df);
  const css = (c: THREE.Color, k = 1) => `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`;
  // the canvas is in sRGB: the colours (linear in three.js) go back to sRGB to draw
  const srgb = (c: THREE.Color) => c.clone().convertLinearToSRGB();
  const glassC = srgb(glass);
  const lightC = srgb(light);
  // a glazed wall is mostly the material's own colour (a light grey here lets it and the
  // reflections show), its framing a little lighter
  const glazed = style === "curtain" || style === "diagrid";
  a.fillStyle = glazed ? "rgb(178,178,178)" : style === "fins" ? css(glassC) : "#ffffff";
  a.fillRect(0, 0, width, height);
  b.fillStyle = "#000000";
  b.fillRect(0, 0, width, height);
  const pane = (x: number, y: number, pw: number, ph: number, on: boolean, shade: number, dark: string) => {
    a.fillStyle = on ? css(lightC, 0.95 * shade) : dark;
    a.fillRect(x, y, pw, ph);
    if (on) {
      b.fillStyle = css(lightC, shade);
      b.fillRect(x, y, pw, ph);
    }
  };
  for (let row = 0; row < TILE; row++) {
    const y = row * ch;
    // offices light up in stretches along a floor, not pane by pane
    let run = 0;
    let runOn = false;
    if (style === "bands") {
      a.fillStyle = css(glassC);
      a.fillRect(0, y + 2, width, ch - 3);
    }
    for (let col = 0; col < TILE; col++) {
      const x = col * cw;
      const shade = 0.8 + rnd() * 0.4;
      if (run-- <= 0) {
        run = 2 + Math.floor(rnd() * 6);
        runOn = rnd() < lit;
      }
      // flats light window by window; offices (glass) by the stretch, a few panes dark in it
      const on = style === "grid" ? rnd() < lit : runOn && rnd() < 0.85;
      switch (style) {
        case "bands":
          a.fillStyle = "rgba(255,255,255,0.35)";
          a.fillRect(x, y + 2, 1, ch - 3);
          if (on) pane(x + 1, y + 2, cw - 1, ch - 3, true, shade, "");
          break;
        case "fins":
          if (on) pane(x + 2, y + 1, cw - 2, ch - 1, true, shade, "");
          a.fillStyle = "rgba(255,255,255,0.9)";
          a.fillRect(x, y, 2, ch);
          break;
        case "curtain":
        case "diagrid":
          a.fillStyle = `rgba(${Math.round(150 + shade * 40)},${Math.round(150 + shade * 40)},${Math.round(150 + shade * 40)},0.35)`;
          a.fillRect(x + 1, y + 1, cw - 1, ch - 1);
          if (on) pane(x + 1, y + 1, cw - 1, ch - 1, true, shade, "");
          a.fillStyle = "rgba(255,255,255,0.28)";
          a.fillRect(x, y, cw, 1);
          a.fillRect(x, y, 1, ch);
          break;
        default:
          pane(x + 2, y + 2, cw - 4, ch - 4, on, shade, css(glassC, shade));
      }
    }
    if (style === "fins") {
      a.fillStyle = "rgba(255,255,255,0.7)";
      a.fillRect(0, y, width, 1);
    }
  }
  if (style === "diagrid") {
    // steel diagonals every four windows, both ways, meeting at the tile's edges so it wraps
    a.strokeStyle = "rgba(255,255,255,0.85)";
    a.lineWidth = 2;
    const step = cw * 4;
    const rise = ch * 4;
    a.beginPath();
    for (let k = -TILE; k <= TILE * 2; k += 4) {
      a.moveTo(k * cw, 0);
      a.lineTo(k * cw + (height / rise) * step, height);
      a.moveTo(k * cw, 0);
      a.lineTo(k * cw - (height / rise) * step, height);
    }
    a.stroke();
  }
  const tex = (canvas: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(map), glow: tex(glow) };
}

// ── Geometry ────────────────────────────────────────────────────────────────────────────

/** Solids drawn with flat faces (a gem, not a ball). */
const FACETED = new Set(["icosahedron", "octahedron", "dodecahedron", "tetrahedron", "rock", "mountain", "prism"]);

/** The colour a shape gets when the scene names none (a stone is grey, not the brand's colour). */
const NATURAL_COLOR: Record<string, string> = { rock: "#8d9096", mountain: "#ffffff" };

/** A ball-ish or cone-ish mesh, its points pushed in and out by noise: a stone, a peak. */
function roughen(base: THREE.BufferGeometry, amount: number, seed: number, keep: (v: THREE.Vector3) => boolean): THREE.BufferGeometry {
  base.deleteAttribute("uv");
  base.deleteAttribute("normal");
  const g = mergeVertices(base);
  base.dispose();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const off = (seed % 1000) * 0.37;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (keep(v)) continue;
    const n = noise3(v.x * 1.7 + off, v.y * 1.7, v.z * 1.7 - off) * 0.75 + noise3(v.x * 4 - off, v.y * 4, v.z * 4) * 0.25;
    const k = 1 + amount * n;
    pos.setXYZ(i, v.x * k, v.y * (1 + amount * 0.4 * n), v.z * k);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** Colours down a mountain: forest, then bare rock, then snow (unless `variant: "bare"`). */
function mountainColors(g: THREE.BufferGeometry, height: number, snow: boolean, seed: number): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const forest = new THREE.Color("#55703f");
  const stone = new THREE.Color("#7f7b75");
  const white = new THREE.Color("#f3f5f8");
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // one colour per face, from its middle height, so the facets read
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 / height + noise3(pos.getX(i) * 2, seed % 97, pos.getZ(i) * 2) * 0.08;
    if (snow && y > 0.68) c.copy(white);
    else if (y > 0.38) c.copy(stone).lerp(forest, Math.max(0, 0.5 - y) * 2);
    else c.copy(forest).multiplyScalar(0.85 + y * 0.4);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function primitive(kind: string, o: Object3): THREE.BufferGeometry {
  const size = o.size ?? 1.4;
  const r = o.radius ?? size / 2;
  let g: THREE.BufferGeometry;
  switch (kind) {
    case "sphere":
      g = new THREE.SphereGeometry(r, 64, 32);
      break;
    case "cylinder":
      // `radiusTop` narrows it (a frustum); `sides` 3 or 4 makes a triangular or square one
      g = new THREE.CylinderGeometry(o.radiusTop ?? r, r, o.height ?? size, Math.max(3, o.sides ?? 64));
      break;
    case "cone":
      g = new THREE.ConeGeometry(r, o.height ?? size, Math.max(3, o.sides ?? 64));
      break;
    case "torus":
      g = new THREE.TorusGeometry(o.radius ?? size * 0.6, o.thickness ?? size * 0.22, 48, 128);
      break;
    case "torusKnot":
      g = new THREE.TorusKnotGeometry(o.radius ?? size * 0.55, o.thickness ?? size * 0.18, 240, 32);
      break;
    case "capsule":
      g = new THREE.CapsuleGeometry(r * 0.6, o.height ?? size, 12, 32);
      break;
    case "plane":
      g = new THREE.PlaneGeometry(o.width ?? size, o.height ?? size);
      break;
    case "ring":
      g = new THREE.TorusGeometry(o.radius ?? size, o.thickness ?? 0.02, 8, 200);
      break;
    case "icosahedron":
      g = new THREE.IcosahedronGeometry(r, 0);
      break;
    case "octahedron":
      g = new THREE.OctahedronGeometry(r, 0);
      break;
    case "dodecahedron":
      g = new THREE.DodecahedronGeometry(r, 0);
      break;
    case "tetrahedron":
      g = new THREE.TetrahedronGeometry(r, 0);
      break;
    case "rock": {
      // a low-poly stone: a coarse ball, roughened, a little flatter than tall
      const seed = hashString(o.id ?? "rock") + (o.seed ?? 0) * 7919;
      g = roughen(new THREE.IcosahedronGeometry(r, 1), o.noise ?? 0.35, seed, () => false);
      g.scale(1, (o.height ?? r * 1.5) / (r * 2), 1);
      break;
    }
    case "mountain": {
      const height = o.height ?? size * 1.4;
      const seed = hashString(o.id ?? "mountain") + (o.seed ?? 0) * 7919;
      const cone = new THREE.ConeGeometry(r * 1.6, height, 11, 7);
      cone.translate(0, height / 2, 0);
      // the peak and the foot stay put, the slopes go rough
      g = roughen(cone, o.noise ?? 0.28, seed, (v) => v.y > height * 0.97 || v.y < 0.001);
      mountainColors(g, height, o.variant !== "bare", seed);
      break;
    }
    case "dome":
      g = new THREE.SphereGeometry(r, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
      break;
    case "prism": {
      // lies along x, one edge up: a roof as it is; `sides` 6 makes a hexagonal bar
      g = new THREE.CylinderGeometry(r, r, o.width ?? size, Math.max(3, o.sides ?? 3), 1);
      g.rotateZ(Math.PI / 2);
      g.rotateX(-Math.PI / 2);
      break;
    }
    case "lathe": {
      // a profile [radius, y] turned round the y axis: a vase, a bottle, a cup, a lamp
      const profile = o.profile?.length && o.profile.length >= 2 ? o.profile : [[0, -0.7], [0.45, -0.7], [0.55, -0.2], [0.3, 0.4], [0.35, 0.7]];
      g = new THREE.LatheGeometry(profile.map(([pr, py]) => new THREE.Vector2(Math.max(0, pr) * size, py * size)), 96);
      break;
    }
    default: {
      const w = o.width ?? size;
      const h = o.height ?? size;
      const d = o.depth ?? size;
      // edges a touch rounded unless `radius: 0`: a razor-sharp box reads as a placeholder
      const round = o.radius ?? Math.min(w, h, d) * 0.04;
      g = round > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(round, Math.min(w, h, d) / 2)) : new THREE.BoxGeometry(w, h, d);
    }
  }
  if (o.pivot === "bottom") {
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox!.min.y, 0);
  }
  return g;
}

/** Reverses every triangle (after a mirror, so faces point out again). */
function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.getIndex();
  if (index) {
    const a = index.array as Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const attr = g.getAttribute(name) as THREE.BufferAttribute;
    const s = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let v = 0; v < attr.count; v += 3) {
      for (let k = 0; k < s; k++) [arr[(v + 1) * s + k], arr[(v + 2) * s + k]] = [arr[(v + 2) * s + k], arr[(v + 1) * s + k]];
    }
    attr.needsUpdate = true;
  }
}

function inside(pt: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Closed outlines → shapes with their holes. Fonts wind holes the other way round from
 * outlines (and variable fonts overlap their outlines, so nesting can't tell): a contour
 * winding against the largest one is a hole, inside the smallest outline that holds it. */
function shapesFrom(paths: THREE.Shape[]): THREE.Shape[] {
  const polys = paths.map((p) => p.getPoints(4));
  const areas = polys.map((poly) => (poly.length > 2 ? THREE.ShapeUtils.area(poly) : 0));
  let main = 0;
  areas.forEach((a, i) => {
    if (Math.abs(a) > Math.abs(areas[main])) main = i;
  });
  const outer = areas.map((a) => a !== 0 && Math.sign(a) === Math.sign(areas[main] || 1));
  const out = paths.filter((_, i) => outer[i]);
  paths.forEach((p, i) => {
    if (outer[i] || !polys[i].length || areas[i] === 0) return;
    let best = -1;
    let area = Infinity;
    paths.forEach((_, j) => {
      if (!outer[j] || !inside(polys[i][Math.floor(polys[i].length / 2)], polys[j])) return;
      const a = Math.abs(areas[j]);
      if (a < area) {
        area = a;
        best = j;
      }
    });
    if (best >= 0) paths[best].holes.push(p);
  });
  return out;
}

/** HarfBuzz contours (px, y down) → three shapes (world units, y up). */
function contourShapes(contours: Contour[], scale: number): THREE.Shape[] {
  const X = (p: number[]) => p[0] * scale;
  const Y = (p: number[]) => -p[1] * scale;
  const paths: THREE.Shape[] = [];
  for (const c of contours) {
    const v = c.v;
    if (v.length < 2) continue;
    const path = new THREE.Shape();
    path.moveTo(X(v[0]), Y(v[0]));
    const seg = (a: number, b: number) => {
      const o = c.o[a] ?? [0, 0];
      const i = c.i[b] ?? [0, 0];
      if (!o[0] && !o[1] && !i[0] && !i[1]) path.lineTo(X(v[b]), Y(v[b]));
      else path.bezierCurveTo(X(v[a]) + o[0] * scale, Y(v[a]) - o[1] * scale, X(v[b]) + i[0] * scale, Y(v[b]) - i[1] * scale, X(v[b]), Y(v[b]));
    };
    for (let k = 1; k < v.length; k++) seg(k - 1, k);
    if (c.c) seg(v.length - 1, 0);
    paths.push(path);
  }
  return shapesFrom(paths);
}

function extrude(shapes: THREE.Shape[], depth: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.7,
    bevelSegments: 4,
    curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function svgShapes(svg: string): THREE.Shape[] {
  const markup = svg.trim().startsWith("<") ? svg : `<svg xmlns="http://www.w3.org/2000/svg"><path d="${svg.replace(/"/g, "")}"/></svg>`;
  const data = new SVGLoader().parse(markup);
  return data.paths.flatMap((p) => SVGLoader.createShapes(p));
}

/** Scales and centres a geometry so its largest side is `size`; mirrors y (SVG is y down). */
function fitFlat(g: THREE.BufferGeometry, size: number, mirror: boolean): void {
  if (mirror) {
    g.scale(1, -1, 1);
    flipWinding(g);
  }
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  const k = size / Math.max(w, h, 1e-6);
  g.translate(-(box.min.x + w / 2), -(box.min.y + h / 2), 0);
  g.scale(k, k, 1);
  g.computeVertexNormals();
}

// ── Particles ───────────────────────────────────────────────────────────────────────────

let dotTexture: THREE.Texture | null = null;
function dot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

/** Points sampled from text drawn by the browser (it shapes Arabic), centred, `height` tall. */
function textPoints(text: string, count: number, height: number, font: string, rnd: () => number): Float32Array {
  const px = 220;
  const c = document.createElement("canvas");
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.font = `800 ${px}px ${font}`;
  const lines = text.split("\n");
  const width = Math.max(...lines.map((l) => g.measureText(l).width), 1);
  c.width = Math.ceil(width + px * 0.6);
  c.height = Math.ceil(lines.length * px * 1.25 + px * 0.4);
  g.font = `800 ${px}px ${font}`;
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.direction = ARABIC.test(text) ? "rtl" : "ltr";
  lines.forEach((l, i) => g.fillText(l, c.width / 2, px * 0.2 + px * 1.25 * (i + 0.5)));
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const hits: number[] = [];
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (data[(y * c.width + x) * 4 + 3] > 128) hits.push(x, y);
  const out = new Float32Array(count * 3);
  const k = height / (lines.length * px * 1.25);
  const n = hits.length / 2;
  for (let i = 0; i < count; i++) {
    const j = n ? Math.floor(rnd() * n) : 0;
    out[i * 3] = n ? (hits[j * 2] - c.width / 2 + (rnd() - 0.5) * 2) * k : 0;
    out[i * 3 + 1] = n ? -(hits[j * 2 + 1] - c.height / 2 + (rnd() - 0.5) * 2) * k : 0;
    out[i * 3 + 2] = (rnd() - 0.5) * height * 0.06;
  }
  return out;
}

function imagePoints(image: CanvasImageSource & { width: number; height: number }, count: number, height: number, rnd: () => number): { pos: Float32Array; col: Float32Array } {
  const c = document.createElement("canvas");
  const scale = Math.min(1, 400 / Math.max(image.width, image.height));
  c.width = Math.max(1, Math.round(image.width * scale));
  c.height = Math.max(1, Math.round(image.height * scale));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const k = height / c.height;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let a = 0;
    for (let tries = 0; tries < 8 && a < 100; tries++) {
      x = Math.floor(rnd() * c.width);
      y = Math.floor(rnd() * c.height);
      a = data[(y * c.width + x) * 4 + 3];
    }
    const p = (y * c.width + x) * 4;
    pos.set([(x - c.width / 2) * k, -(y - c.height / 2) * k, (rnd() - 0.5) * 0.05], i * 3);
    col.set([data[p] / 255, data[p + 1] / 255, data[p + 2] / 255], i * 3);
  }
  return { pos, col };
}

function shapePoints(shape: string, o: Object3, count: number, rnd: () => number, extras: { text?: Float32Array }): Float32Array {
  const R = o.radius ?? 3;
  const out = new Float32Array(count * 3);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    switch (shape) {
      case "text":
        if (extras.text) {
          x = extras.text[i * 3];
          y = extras.text[i * 3 + 1];
          z = extras.text[i * 3 + 2];
        }
        break;
      case "shell":
      case "sphere": {
        const u = rnd() * 2 - 1;
        const a = rnd() * Math.PI * 2;
        const r = shape === "shell" ? R : R * Math.cbrt(rnd());
        const s = Math.sqrt(1 - u * u);
        x = r * s * Math.cos(a);
        y = r * u;
        z = r * s * Math.sin(a);
        break;
      }
      case "disc": {
        const r = R * Math.sqrt(rnd());
        const a = rnd() * Math.PI * 2;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
        y = gauss() * R * 0.02;
        break;
      }
      case "ring": {
        const r = R * (0.85 + rnd() * 0.15);
        const a = rnd() * Math.PI * 2;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
        y = gauss() * R * 0.03;
        break;
      }
      case "cube":
        x = (rnd() - 0.5) * R * 2;
        y = (rnd() - 0.5) * R * 2;
        z = (rnd() - 0.5) * R * 2;
        break;
      case "galaxy": {
        const arms = Math.max(1, o.arms ?? 3);
        const r = R * Math.pow(rnd(), 1.4);
        const a = ((i % arms) / arms) * Math.PI * 2 + r * 1.3 + gauss() * 0.35 * (1 - r / R + 0.2);
        x = r * Math.cos(a) + gauss() * 0.15;
        z = r * Math.sin(a) + gauss() * 0.15;
        y = gauss() * 0.25 * (1 - r / R) + gauss() * 0.04;
        break;
      }
      case "grid":
      case "wave": {
        const side = Math.ceil(Math.sqrt(count));
        const w = o.width ?? R * 2;
        x = ((i % side) / (side - 1 || 1) - 0.5) * w;
        z = (Math.floor(i / side) / (side - 1 || 1) - 0.5) * w;
        break;
      }
      case "helix": {
        const a = (i / count) * Math.PI * 12;
        x = Math.cos(a) * R * 0.4 + gauss() * 0.04;
        z = Math.sin(a) * R * 0.4 + gauss() * 0.04;
        y = (i / count - 0.5) * R * 2;
        break;
      }
      case "point":
        break;
      default:
        x = (rnd() - 0.5) * (o.width ?? R * 2);
        y = (rnd() - 0.5) * (o.height ?? R * 2);
        z = (rnd() - 0.5) * (o.depth ?? R * 2);
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

// ── Environments (no files: built from light panels and a sky gradient) ─────────────────

function skyScene(top: string, bottom: string, panels: { color: [number, number, number]; pos: Vec3; size: [number, number] }[]): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.3, 0.6, vP.y)), 1.0); }",
    }),
  );
  scene.add(sky);
  for (const p of panels) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]), new THREE.MeshBasicMaterial({ color: new THREE.Color(...p.color), side: THREE.DoubleSide }));
    mesh.position.set(...p.pos);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }
  return scene;
}

function envScene(name: string): THREE.Scene {
  switch (name) {
    case "sunset":
      return skyScene("#1b1f4a", "#ff8a4c", [
        { color: [9, 4.5, 2], pos: [0, 2, -30], size: [10, 6] },
        { color: [1.2, 0.8, 1.6], pos: [20, 15, 15], size: [12, 12] },
      ]);
    case "night":
      return skyScene("#050713", "#111a33", [
        { color: [2.2, 2.6, 4], pos: [-18, 12, 18], size: [14, 8] },
        { color: [3, 2.2, 1.4], pos: [22, 6, -14], size: [6, 14] },
        { color: [1.4, 1.6, 2.4], pos: [0, 25, 0], size: [20, 20] },
      ]);
    case "city":
      return skyScene("#6d7a8f", "#2b2f36", [
        ...Array.from({ length: 8 }, (_, i) => ({ color: [3, 3, 3.2] as [number, number, number], pos: [Math.cos((i / 8) * Math.PI * 2) * 25, 4 + (i % 3) * 4, Math.sin((i / 8) * Math.PI * 2) * 25] as Vec3, size: [3, 10] as [number, number] })),
        { color: [2, 2, 2], pos: [0, 30, 0], size: [25, 25] },
      ]);
    case "dawn":
      return skyScene("#cfe0ff", "#ffe3c4", [{ color: [5, 4.6, 4.2], pos: [15, 18, 10], size: [16, 16] }]);
    default:
      return new RoomEnvironment();
  }
}

// ── The player ──────────────────────────────────────────────────────────────────────────

interface Node {
  spec: Object3;
  obj: THREE.Object3D;
  /** The parts a staggered preset moves (letters, words, children). */
  parts: THREE.Object3D[];
  partBase: { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }[];
  materials: THREE.Material[];
  partMaterials?: THREE.Material[][];
  children: Node[];
  /** Kind-specific work each frame (particles, tubes, blobs, instances, models). */
  tick?: (t: number, state: State3, opacity: number) => void;
  /** Its width, for `fit`. */
  width?: number;
}

interface Built {
  hash: string;
  spec: Scene3D;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  nodes: Node[];
  layer: Layer;
  dispose: () => void;
}

export interface ThreePlayer {
  load(scene: Scene, kit: BrandKit, loader?: AssetLoader): Promise<string[]>;
  draw(layer: Layer, ctx: Ctx, box: { x: number; y: number; w: number; h: number }, localTime: number): void;
  /** Whether WebGL works here (false = 3D layers can't be drawn). */
  available(): boolean;
  dispose(): void;
}

/**
 * One WebGL context for every player in the app: the motion page's cards, the chat's reel
 * cards, the workspace and the engine the model checks its work with. A context each meant a
 * full set of shaders, lighting maps and shadow buffers per card, which on a laptop's shared
 * graphics memory is the computer's own RAM (and the browser drops the oldest past 16).
 * Every draw sets its size and exposure, renders and copies the picture out at once, so
 * sharing changes nothing in what's drawn. Released when the last player is disposed.
 */
const shared: {
  renderer: THREE.WebGLRenderer | null;
  failed: boolean;
  users: number;
  envs: Map<string, THREE.Texture>;
} = { renderer: null, failed: false, users: 0, envs: new Map() };

function sharedRenderer(): THREE.WebGLRenderer | null {
  if (shared.renderer || shared.failed) return shared.renderer;
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(16, 16) : document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    shared.renderer = renderer;
  } catch {
    shared.failed = true;
  }
  return shared.renderer;
}

function releaseShared(): void {
  shared.users = Math.max(0, shared.users - 1);
  if (shared.users > 0) return;
  for (const t of shared.envs.values()) t.dispose();
  shared.envs.clear();
  shared.renderer?.dispose();
  shared.renderer = null;
}

export function threePlayer(): ThreePlayer {
  let joined = false;
  let kit: BrandKit;
  const built = new Map<string, Built>();
  const envs = shared.envs;
  const gltfs = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
  const pictures = new Map<string, HTMLCanvasElement>();
  let grainTile: HTMLCanvasElement | null = null;

  function gl(): THREE.WebGLRenderer | null {
    const renderer = sharedRenderer();
    if (renderer && !joined) {
      joined = true;
      shared.users += 1;
    }
    return renderer;
  }

  function environment(name: string): THREE.Texture | null {
    const r = gl();
    if (!r) return null;
    const hit = envs.get(name);
    if (hit) return hit;
    const pmrem = new THREE.PMREMGenerator(r);
    const scene = envScene(name);
    const tex = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
    envs.set(name, tex);
    return tex;
  }

  async function picture(id: string, loader: AssetLoader): Promise<HTMLCanvasElement | null> {
    const hit = pictures.get(id);
    if (hit) return hit;
    try {
      const bitmap = await createImageBitmap(await loader.blob(id));
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext("2d")!.drawImage(bitmap, 0, 0);
      pictures.set(id, c);
      return c;
    } catch {
      return null;
    }
  }

  async function model(id: string, loader: AssetLoader): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
    const hit = gltfs.get(id);
    if (hit) return hit;
    try {
      const data = await (await loader.blob(id)).arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(data, "");
      const out = { scene: gltf.scene, animations: gltf.animations };
      gltfs.set(id, out);
      return out;
    } catch {
      return null;
    }
  }

  async function buildLayer(layer: Layer, sceneDoc: Scene, loader: AssetLoader | undefined, problems: string[]): Promise<Built> {
    const expanded = expandScene3D(layer.scene3d, layer.start, layer.end);
    const seed = expanded.seed ?? hashString(layer.id);
    // trees, buildings, a city…: groups of plain pieces from here on
    const spec = { ...expanded, objects: expandProps(expanded.objects ?? [], seed) };
    const scene = new THREE.Scene();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const track = <T extends THREE.Material | THREE.BufferGeometry>(x: T): T => {
      if (x instanceof THREE.BufferGeometry) geometries.push(x);
      else materials.push(x);
      return x;
    };
    // window tiles for façades, one per look, shared by every building (each side shows its
    // own stretch of it through the texture's repeat and offset)
    const tileCache = new Map<string, { map: THREE.Texture; glow: THREE.Texture }>();
    // things that own GPU memory of their own (a mirror's picture), let go with the layer
    const cleanups: (() => void)[] = [];
    const windowTiles = (win: Windows3) => {
      const lit = Math.max(0, Math.min(1, win.lit ?? 0.35));
      const key = `${win.style ?? "grid"}|${win.glass ?? ""}|${win.light ?? ""}|${Math.round(lit * 20)}`;
      const hit = tileCache.get(key);
      if (hit) return hit;
      const made = drawWindowTiles(win.style ?? "grid", color3(kit, win.glass ?? "#3b4a5c"), color3(kit, win.light ?? "#ffd9a0"), lit, seed);
      tileCache.set(key, made);
      return made;
    };
    const assetId = (key: string | undefined) => (key ? sceneDoc.assets?.[key]?.src.replace("asset://", "") ?? null : null);

    // environment and fog
    const env = typeof spec.environment === "object" ? spec.environment : { preset: spec.environment ?? "studio", intensity: spec.environment ? 0.85 : 0.6 };
    if (env.preset !== "none") {
      const tex = environment(env.preset);
      if (tex) {
        scene.environment = tex;
        scene.environmentIntensity = env.intensity ?? 1;
        scene.environmentRotation.y = (("rotation" in env ? env.rotation : 0) ?? 0) * DEG;
      }
    }
    if (spec.fog) scene.fog = new THREE.Fog(color3(kit, spec.fog.color ?? "#000000"), spec.fog.near ?? 8, spec.fog.far ?? 30);

    // lights
    const lights: Light3[] = spec.lights?.length
      ? spec.lights
      : [
          { type: "key", color: "#ffffff", intensity: 2.4, position: [4, 6, 5], shadow: true },
          { type: "rim", color: "brand.primary", intensity: 2.5, position: [-5, 3, -4] },
          { type: "fill", color: "#a9b8ff", intensity: 0.5, position: [-4, 1, 5] },
          { type: "ambient", intensity: 0.25 },
        ];
    for (const l of lights) {
      const c = color3(kit, l.color ?? "#ffffff");
      const at = l.position ?? [4, 6, 5];
      let light: THREE.Light;
      switch (l.type) {
        case "ambient":
          light = new THREE.AmbientLight(c, l.intensity ?? 0.3);
          break;
        case "hemisphere":
          light = new THREE.HemisphereLight(c, color3(kit, l.ground ?? "#202020"), l.intensity ?? 0.6);
          break;
        case "point":
          light = new THREE.PointLight(c, l.intensity ?? 30, 0, 2);
          light.position.set(...at);
          break;
        case "spot": {
          const spot = new THREE.SpotLight(c, l.intensity ?? 40, 0, Math.PI / 6, 0.4, 2);
          spot.position.set(...at);
          light = spot;
          break;
        }
        default: {
          const dir = new THREE.DirectionalLight(c, l.intensity ?? (l.type === "key" ? 2.4 : l.type === "rim" ? 2.5 : 0.6));
          dir.position.set(...(l.position ?? (l.type === "rim" ? [-5, 3, -4] : l.type === "fill" ? [-4, 1, 5] : [4, 6, 5])));
          if (l.shadow ?? l.type === "key") {
            dir.castShadow = true;
            dir.shadow.mapSize.set(2048, 2048);
            dir.shadow.bias = -0.0004;
            dir.shadow.normalBias = 0.02;
            dir.shadow.radius = 4;
            const cam = dir.shadow.camera;
            cam.left = cam.bottom = -10;
            cam.right = cam.top = 10;
            cam.near = 0.5;
            cam.far = 60;
          }
          light = dir;
        }
      }
      scene.add(light);
    }

    // text outlines first, in one batch
    const texts: { o: Object3; units: string[]; line: string; family: string; weight: number; dir: "rtl" | "ltr" }[] = [];
    const walkObjects = (list: Object3[], fn: (o: Object3) => void) => {
      for (const o of list) {
        fn(o);
        if (o.children?.length) walkObjects(o.children, fn);
      }
    };
    walkObjects(spec.objects ?? [], (o) => {
      if (o.kind !== "text3d" || !o.text) return;
      const role = o.font ?? "display";
      const family = kit.fonts[role] ?? kit.fonts.display;
      const weight = o.weight ?? 800;
      for (const line of o.text.split("\n")) {
        const rtl = ARABIC.test(line);
        const words = line.split(/\s+/).filter(Boolean);
        const units = o.split === "letters" && !rtl ? [...line.replace(/\s+/g, "")] : o.split === "words" || (o.split === "letters" && rtl) ? words : [];
        texts.push({ o, units, line, family, weight, dir: rtl ? "rtl" : "ltr" });
      }
    });
    const outlineReq = texts.flatMap((x) => [x.line, ...x.units].map((text) => ({ text, family: x.family, weight: x.weight, px: OUTLINE_PX, dir: x.dir })));
    let outlines: Outline[] = [];
    if (outlineReq.length) {
      try {
        outlines = await outlineLines(outlineReq);
      } catch {
        problems.push("3D text (couldn't shape the letters)");
      }
    }
    const outlineOf = new Map<string, Outline>();
    outlineReq.forEach((r, i) => outlines[i] && outlineOf.set(`${r.family}|${r.weight}|${r.dir}|${r.text}`, outlines[i]));
    const icons = new Set<string>();
    walkObjects(spec.objects ?? [], (o) => o.kind === "extrude" && o.icon && icons.add(o.icon));
    if (icons.size) await loadIcons([...icons]);

    // surface pictures (planet maps, labels…), loaded once per layer
    const surface = new Map<string, HTMLCanvasElement>();
    const wanted = new Set<string>();
    walkObjects(spec.objects ?? [], (o) => textureKeys(o).forEach((k) => wanted.add(k)));
    for (const key of wanted) {
      const id = assetId(key);
      const pic = id && loader ? await picture(id, loader) : null;
      if (pic) surface.set(key, pic);
      else problems.push(key);
    }
    const madeTextures = new Map<string, THREE.Texture>();
    const tex: TextureFor = (key, isColor) => {
      if (!key) return null;
      const pic = surface.get(key);
      if (!pic) return null;
      const id = `${key}|${isColor}`;
      const hit = madeTextures.get(id);
      if (hit) return hit;
      const t = new THREE.CanvasTexture(pic);
      t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.wrapS = THREE.RepeatWrapping;
      textures.push(t);
      madeTextures.set(id, t);
      return t;
    };

    const castsShadow = (o: Object3) => o.shadow !== false;

    const makeNode = async (o: Object3): Promise<Node | null> => {
      const node: Node = { spec: o, obj: new THREE.Group(), parts: [], partBase: [], materials: [], children: [] };
      const mat = (fallback: Material3Name) => {
        const m = track(makeMaterial(o, kit, fallback, tex));
        node.materials.push(m);
        return m;
      };
      const rnd = seeded(seed ^ hashString(o.id ?? o.kind));
      switch (o.kind) {
        case "group": {
          for (const child of o.children ?? []) {
            const n = await makeNode(child);
            if (!n) continue;
            const slot = new THREE.Group();
            slot.add(n.obj);
            node.obj.add(slot);
            node.parts.push(slot);
            node.children.push(n);
          }
          break;
        }
        case "text3d": {
          const lines = texts.filter((x) => x.o === o);
          const size = o.size ?? 1;
          const scale = size / OUTLINE_PX;
          const depth = o.depth ?? size * 0.25;
          const bevel = o.bevel ?? size * 0.03;
          const lh = size * 1.25;
          const base = mat("chrome");
          lines.forEach((x, li) => {
            const lineOutline = outlineOf.get(`${x.family}|${x.weight}|${x.dir}|${x.line}`);
            if (!lineOutline) return;
            const y = ((lines.length - 1) / 2 - li) * lh - size * 0.32;
            const lineW = lineOutline.width * scale;
            const left = o.align === "start" ? (x.dir === "rtl" ? -lineW : 0) : o.align === "end" ? (x.dir === "rtl" ? 0 : -lineW) : -lineW / 2;
            if (!x.units.length) {
              const g = track(extrude(contourShapes(lineOutline.contours, scale), depth, bevel));
              g.translate(left, y, 0);
              const mesh = new THREE.Mesh(g, base);
              mesh.castShadow = castsShadow(o);
              node.obj.add(mesh);
              return;
            }
            const unitOutlines = x.units.map((u) => outlineOf.get(`${x.family}|${x.weight}|${x.dir}|${u}`));
            const widths = unitOutlines.map((u) => (u?.width ?? 0) * scale);
            const gap = x.units.length > 1 ? Math.max(0, (lineW - widths.reduce((a, b) => a + b, 0)) / (x.units.length - 1)) : 0;
            // visual order: an Arabic line's first word sits at the right
            const order = x.units.map((_, i) => i);
            if (x.dir === "rtl") order.reverse();
            let cursor = left;
            for (const i of order) {
              const u = unitOutlines[i];
              const w = widths[i];
              if (u?.contours.length) {
                const g = track(extrude(contourShapes(u.contours, scale), depth, bevel));
                g.translate(-w / 2, 0, 0);
                const m = base.clone();
                track(m);
                const mesh = new THREE.Mesh(g, m);
                mesh.castShadow = castsShadow(o);
                const slot = new THREE.Group();
                slot.position.set(cursor + w / 2, y, 0);
                slot.add(mesh);
                node.obj.add(slot);
                node.parts.push(slot);
                (node.partMaterials ??= []).push([m]);
              }
              cursor += w + gap;
            }
          });
          break;
        }
        case "extrude": {
          const size = o.size ?? 2;
          const depth = o.depth ?? size * 0.25;
          const bevel = o.bevel ?? size * 0.03;
          const m = mat("chrome");
          if (o.outline) {
            // a ready outline (heart, star, bolt…), in the box's proportions
            const lines = outlinePath(o.outline, 0, 0, o.width ?? 1, o.height ?? 1, o.sides);
            if (!lines) {
              problems.push(`${o.id ?? "extrude"}: no outline ${o.outline}`);
              break;
            }
            const shapes = lines.map((line) => new THREE.Shape(line.points.map(([px, py]) => new THREE.Vector2(px, -py))));
            const g = track(extrude(shapes, depth / size, bevel / size));
            fitFlat(g, size, false);
            g.scale(1, 1, size);
            const mesh = new THREE.Mesh(g, m);
            mesh.castShadow = castsShadow(o);
            node.obj.add(mesh);
          } else if (o.svg) {
            try {
              const g = track(extrude(svgShapes(o.svg), depth, bevel));
              fitFlat(g, size, true);
              const mesh = new THREE.Mesh(g, m);
              mesh.castShadow = castsShadow(o);
              node.obj.add(mesh);
            } catch {
              problems.push(`${o.id ?? "extrude"}: the SVG path couldn't be read`);
            }
          } else if (o.icon) {
            const shape = icon(o.icon);
            if (!shape || shape.kind === "image") {
              problems.push(`${o.icon} (a 3D icon needs a one-colour icon)`);
              break;
            }
            const group = new THREE.Group();
            for (const part of shape.parts) {
              if (part.kind === "fill") {
                const g = track(extrude(svgShapes(part.path), depth * (24 / size), bevel * (24 / size)));
                g.scale(1, -1, 1);
                flipWinding(g);
                g.computeVertexNormals();
                group.add(new THREE.Mesh(g, m));
              } else {
                for (const pl of part.lines) {
                  if (pl.points.length < 2) continue;
                  const path = new THREE.CurvePath<THREE.Vector3>();
                  const pts = pl.points.map(([px, py]) => new THREE.Vector3(px, -py, 0));
                  if (pl.closed) pts.push(pts[0].clone());
                  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
                  const g = track(new THREE.TubeGeometry(path, Math.max(8, pts.length * 6), part.width / 2, 10, false));
                  group.add(new THREE.Mesh(g, m));
                }
              }
            }
            const bb = new THREE.Box3().setFromObject(group);
            const dims = bb.getSize(new THREE.Vector3());
            const k = size / Math.max(dims.x, dims.y, 1e-6);
            const center = bb.getCenter(new THREE.Vector3());
            group.position.set(-center.x * k, -center.y * k, 0);
            group.scale.setScalar(k);
            group.traverse((c) => (c.castShadow = castsShadow(o)));
            node.obj.add(group);
          }
          break;
        }
        case "image": {
          const id = assetId(o.asset);
          const pic = id && loader ? await picture(id, loader) : null;
          if (!pic) {
            problems.push(o.asset ?? "image");
            break;
          }
          const h = o.height ?? (o.width ? (o.width * pic.height) / pic.width : 2.4);
          const w = o.width ?? (h * pic.width) / pic.height;
          const r = Math.min(o.cornerRadius ?? Math.min(w, h) * 0.06, Math.min(w, h) / 2);
          const shape = new THREE.Shape();
          shape.moveTo(-w / 2 + r, -h / 2);
          shape.lineTo(w / 2 - r, -h / 2);
          shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
          shape.lineTo(w / 2, h / 2 - r);
          shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
          shape.lineTo(-w / 2 + r, h / 2);
          shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
          shape.lineTo(-w / 2, -h / 2 + r);
          shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
          const g = track(new THREE.ShapeGeometry(shape, 8));
          const uv = g.getAttribute("uv") as THREE.BufferAttribute;
          const pos = g.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
          const tex = new THREE.CanvasTexture(pic);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          textures.push(tex);
          const m = track(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
          m.userData.opacity = 1;
          node.materials.push(m);
          node.obj.add(new THREE.Mesh(g, m));
          break;
        }
        case "model": {
          const id = assetId(o.asset);
          const gltf = id && loader ? await model(id, loader) : null;
          if (!gltf) {
            problems.push(o.asset ?? "model");
            break;
          }
          const inner = cloneSkinned(gltf.scene);
          const bb = new THREE.Box3().setFromObject(inner);
          const dims = bb.getSize(new THREE.Vector3());
          const k = (o.size ?? 2) / Math.max(dims.x, dims.y, dims.z, 1e-6);
          const center = bb.getCenter(new THREE.Vector3());
          inner.scale.setScalar(k);
          inner.position.set(-center.x * k, -center.y * k, -center.z * k);
          inner.traverse((c) => {
            if ((c as THREE.Mesh).isMesh) {
              const mesh = c as THREE.Mesh;
              mesh.castShadow = castsShadow(o);
              mesh.receiveShadow = true;
              const own = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              mesh.material = own.length === 1 ? own[0].clone() : own.map((x) => x.clone());
              for (const x of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                x.userData.opacity = x.opacity;
                node.materials.push(x);
                materials.push(x);
              }
            }
          });
          node.obj.add(inner);
          const clip = gltf.animations.find((a) => a.name === o.animation) ?? gltf.animations[0];
          if (clip) {
            const mixer = new THREE.AnimationMixer(inner);
            mixer.clipAction(clip).play();
            node.tick = (t) => mixer.setTime(Math.max(0, t - layer.start));
          }
          break;
        }
        case "particles": {
          const count = Math.min(60000, Math.max(1, o.count ?? 3000));
          const font = fontStack(kit, o.font ?? "display");
          const textFor = (s: string | undefined) => (s ? textPoints(s, count, o.height ?? 1.6, font, rnd) : undefined);
          let colors: Float32Array | null = null;
          let from: Float32Array;
          if (o.shape === "image") {
            const id = assetId(o.asset);
            const pic = id && loader ? await picture(id, loader) : null;
            if (pic) {
              const sampled = imagePoints(pic, count, o.height ?? 3, rnd);
              from = sampled.pos;
              colors = sampled.col;
            } else {
              problems.push(o.asset ?? "image");
              from = shapePoints("sphere", o, count, rnd, {});
            }
          } else from = shapePoints(o.shape ?? "sphere", o, count, rnd, { text: o.shape === "text" ? textFor(o.text ?? o.toText) : undefined });
          const to = o.to ? shapePoints(o.to, o, count, rnd, { text: o.to === "text" ? textFor(o.toText ?? o.text) : undefined }) : null;
          if (!colors) {
            const palette = (o.colors?.length ? o.colors : [o.color ?? "#ffffff"]).map((c) => color3(kit, c, "onSurface"));
            colors = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
              const c = palette[Math.floor(rnd() * palette.length)];
              colors.set([c.r, c.g, c.b], i * 3);
            }
          }
          const phase = new Float32Array(count);
          for (let i = 0; i < count; i++) phase[i] = rnd() * 100;
          const geo = track(new THREE.BufferGeometry());
          const pos = new Float32Array(from);
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          const m = track(
            new THREE.PointsMaterial({
              size: o.size ?? 0.04,
              map: dot(),
              vertexColors: true,
              transparent: true,
              depthWrite: false,
              blending: o.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
              opacity: o.opacity ?? 1,
              sizeAttenuation: true,
            }),
          );
          m.userData.opacity = 1;
          m.userData.alwaysTransparent = true;
          node.materials.push(m);
          const points = new THREE.Points(geo, m);
          points.frustumCulled = false;
          node.obj.add(points);
          const drift = o.drift ?? 0;
          const wave = o.shape === "wave";
          const amp = o.height ?? 0.4;
          node.tick = (t, state) => {
            const k = Math.min(1, Math.max(0, state.morph));
            const time = t - layer.start;
            for (let i = 0; i < count; i++) {
              const j = i * 3;
              let x = from[j];
              let y = from[j + 1];
              let z = from[j + 2];
              if (to && k > 0) {
                // each point leaves a little later than the one before: a flowing assembly
                const lag = Math.min(1, Math.max(0, k * 1.25 - (phase[i] % 1) * 0.25));
                x += (to[j] - x) * lag;
                y += (to[j + 1] - y) * lag;
                z += (to[j + 2] - z) * lag;
              }
              if (wave) y += amp * Math.sin(x * 1.3 + time * 1.6) * Math.cos(z * 1.1 + time * 1.2);
              if (drift) {
                const ph = phase[i];
                const d = drift * (to ? 1 - k * 0.85 : 1);
                x += d * Math.sin(time * 0.7 + ph);
                y += d * Math.cos(time * 0.6 + ph * 1.3);
                z += d * Math.sin(time * 0.5 + ph * 0.7);
              }
              pos[j] = x;
              pos[j + 1] = y;
              pos[j + 2] = z;
            }
            geo.attributes.position.needsUpdate = true;
          };
          break;
        }
        case "instances": {
          const layout = o.layout ?? "grid";
          const rows = Math.max(1, o.rows ?? 8);
          const cols = Math.max(1, o.cols ?? 8);
          const count = Math.min(10000, layout === "grid" || layout === "wall" || layout === "city" ? rows * cols : Math.max(1, o.count ?? 24));
          // `radius` is the ring's or the helix's; a block's corners round with `cornerRadius`
          const unit: Object3 = { kind: o.of ?? "box", size: o.size ?? 1, radius: (o.of ?? "box") === "box" ? o.cornerRadius ?? 0 : (o.size ?? 1) / 2, pivot: layout === "city" ? "bottom" : o.pivot };
          const g = track(primitive(unit.kind, unit));
          // each block's own colour multiplies the material's, so the material stays white
          const m = track(makeMaterial({ ...o, color: "#ffffff" }, kit, "plastic", tex));
          node.materials.push(m);
          const mesh = new THREE.InstancedMesh(g, m, count);
          mesh.castShadow = castsShadow(o);
          mesh.receiveShadow = true;
          const gap = 1 + (o.gap ?? 0.15);
          const base: { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }[] = [];
          for (let i = 0; i < count; i++) {
            const p = new THREE.Vector3();
            const r = new THREE.Euler();
            const s = new THREE.Vector3(1, 1, 1);
            const c = i % cols;
            const row = Math.floor(i / cols);
            switch (layout) {
              case "grid":
                p.set(c * gap, 0, row * gap);
                break;
              case "wall":
                p.set((c - (cols - 1) / 2) * gap, (row - (rows - 1) / 2) * gap, 0);
                break;
              case "city": {
                p.set(c * gap, 0, row * gap);
                const n = (noise3(c * 0.22, row * 0.22, seed % 101) + 1) / 2;
                s.y = 0.25 + Math.pow(n, 2.2) * 7 * (rnd() * 0.6 + 0.4);
                break;
              }
              case "ring": {
                const a = (i / count) * Math.PI * 2;
                const R = o.radius ?? 3;
                p.set(Math.cos(a) * R, 0, Math.sin(a) * R);
                r.set(0, -a, 0);
                break;
              }
              case "spiral":
              case "helix": {
                const a = i * (layout === "helix" ? 0.45 : 0.6);
                const R = layout === "helix" ? o.radius ?? 2 : 0.4 + i * 0.12;
                p.set(Math.cos(a) * R, layout === "helix" ? (i - count / 2) * 0.18 : 0, Math.sin(a) * R);
                r.set(0, -a, 0);
                break;
              }
              case "line":
                p.set((i - (count - 1) / 2) * gap, 0, 0);
                break;
              default:
                p.set((rnd() - 0.5) * (o.width ?? 6), (rnd() - 0.5) * (o.height ?? 3), (rnd() - 0.5) * (o.depth ?? 6));
                r.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
                s.setScalar(0.6 + rnd() * 0.6);
            }
            base.push({ p, r, s });
          }
          const palette = (o.colors?.length ? o.colors : [o.color ?? "brand.primary"]).map((c) => color3(kit, c));
          for (let i = 0; i < count; i++) mesh.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
          const matrix = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const place = (t: number) => {
            for (let i = 0; i < count; i++) {
              const b = base[i];
              const part = partState(o, i, t, kit);
              const pos = b.p.clone();
              const rot = b.r.clone();
              const scl = b.s.clone();
              if (part) {
                pos.add(new THREE.Vector3(...part.position));
                rot.set(rot.x + part.rotation[0], rot.y + part.rotation[1], rot.z + part.rotation[2]);
                scl.multiply(new THREE.Vector3(...part.scale));
                if (part.opacity < 0.02) scl.setScalar(0);
              }
              matrix.compose(pos, q.setFromEuler(rot), scl);
              mesh.setMatrixAt(i, matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
          };
          place(layer.start);
          node.obj.add(mesh);
          if ((o.animate ?? []).some((a) => a.stagger)) node.tick = (t) => place(t);
          break;
        }
        case "tube": {
          const pts = (o.points ?? [[-2, 0, 0], [0, 1, 0], [2, 0, 0]]).map((p) => new THREE.Vector3(...p));
          const curve = new THREE.CatmullRomCurve3(pts);
          const tubular = 240;
          const radial = 12;
          const g = track(new THREE.TubeGeometry(curve, tubular, o.radius ?? 0.04, radial, false));
          const m = mat("glow");
          node.obj.add(new THREE.Mesh(g, m));
          node.tick = (_t, state) => g.setDrawRange(0, Math.floor(Math.min(1, Math.max(0, state.trim)) * tubular) * radial * 6);
          break;
        }
        case "globe": {
          const R = o.radius ?? 2;
          const style = o.style ?? "dots";
          const tint = color3(kit, o.color ?? "brand.primary");
          const map = tex(o.texture, true);
          const core = track(new THREE.MeshStandardMaterial({ color: map ? new THREE.Color("#ffffff") : style === "solid" ? tint : new THREE.Color("#070b18"), map, roughness: 0.85, metalness: 0.05 }));
          core.userData.opacity = 1;
          node.materials.push(core);
          node.obj.add(new THREE.Mesh(track(new THREE.SphereGeometry(R * 0.995, 64, 32)), core));
          if (style === "wire") {
            const wire = track(new THREE.MeshBasicMaterial({ color: tint, wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }));
            wire.userData.opacity = 0.35;
            node.materials.push(wire);
            node.obj.add(new THREE.Mesh(track(new THREE.SphereGeometry(R, 36, 18)), wire));
          } else if (style === "dots" && !map) {
            const n = 4200;
            const arr = new Float32Array(n * 3);
            const golden = Math.PI * (3 - Math.sqrt(5));
            for (let i = 0; i < n; i++) {
              const y = 1 - (i / (n - 1)) * 2;
              const r = Math.sqrt(1 - y * y);
              const a = golden * i;
              arr.set([Math.cos(a) * r * R * 1.003, y * R * 1.003, Math.sin(a) * r * R * 1.003], i * 3);
            }
            const geo = track(new THREE.BufferGeometry());
            geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
            const dm = track(new THREE.PointsMaterial({ size: R * 0.024, map: dot(), color: tint, transparent: true, depthWrite: false, toneMapped: false }));
            dm.userData.opacity = 1;
            dm.userData.alwaysTransparent = true;
            node.materials.push(dm);
            node.obj.add(new THREE.Points(geo, dm));
          }
          // a soft glow around the edge
          const atmo = track(
            new THREE.ShaderMaterial({
              side: THREE.BackSide,
              transparent: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              uniforms: { glowColor: { value: color3(kit, o.atmosphere ?? o.color ?? "brand.accent") }, strength: { value: 1 } },
              vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
              fragmentShader: "uniform vec3 glowColor; uniform float strength; varying vec3 vN; varying vec3 vV; void main(){ float k = pow(1.0 - abs(dot(vN, vV)), 3.5); gl_FragColor = vec4(glowColor * k * 0.9 * strength, k * 0.8 * strength); }",
            }),
          );
          node.obj.add(new THREE.Mesh(track(new THREE.SphereGeometry(R * 1.13, 64, 32)), atmo));
          const arcs: { g: THREE.TubeGeometry; at: number; dur: number }[] = [];
          (o.arcs ?? []).forEach((arc, i) => {
            const a = new THREE.Vector3(...latLon(arc.from[0], arc.from[1], R));
            const b = new THREE.Vector3(...latLon(arc.to[0], arc.to[1], R));
            const lift = 1 + 0.15 + a.distanceTo(b) / R * 0.22;
            const mid = a.clone().add(b).normalize().multiplyScalar(R * lift);
            const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
            const g = track(new THREE.TubeGeometry(curve, 96, R * 0.007, 6, false));
            const m = track(new THREE.MeshBasicMaterial({ color: color3(kit, arc.color ?? o.atmosphere ?? "brand.accent"), toneMapped: false, transparent: true }));
            m.userData.opacity = 1;
            node.materials.push(m);
            node.obj.add(new THREE.Mesh(g, m));
            arcs.push({ g, at: arc.at ?? layer.start + 0.6 + i * 0.3, dur: arc.duration ?? 1.2 });
          });
          for (const [lat, lon] of o.markers ?? []) {
            const m = track(new THREE.MeshBasicMaterial({ color: tint, toneMapped: false, transparent: true }));
            m.userData.opacity = 1;
            node.materials.push(m);
            const dotMesh = new THREE.Mesh(track(new THREE.SphereGeometry(R * 0.022, 16, 8)), m);
            dotMesh.position.set(...latLon(lat, lon, R * 1.004));
            node.obj.add(dotMesh);
          }
          const ease = ease3("inOut", kit);
          node.tick = (t) => {
            for (const arc of arcs) {
              const u = ease(Math.min(1, Math.max(0, (t - arc.at) / arc.dur)));
              arc.g.setDrawRange(0, Math.floor(u * 96) * 6 * 6);
            }
          };
          break;
        }
        case "ground": {
          const g = track(new THREE.PlaneGeometry(120, 120));
          g.rotateX(-Math.PI / 2);
          let m: THREE.Material;
          if (o.color) {
            m = track(new THREE.MeshStandardMaterial({ color: color3(kit, o.color), roughness: 0.85, metalness: 0.05 }));
            m.userData.opacity = 1;
          } else {
            m = track(new THREE.ShadowMaterial({ opacity: o.opacity ?? 0.4 }));
            m.userData.opacity = 1;
            m.userData.alwaysTransparent = true;
          }
          node.materials.push(m);
          const mesh = new THREE.Mesh(g, m);
          mesh.receiveShadow = true;
          node.obj.add(mesh);
          break;
        }
        case "blob": {
          const R = o.radius ?? 1.4;
          const g = track(mergeVertices(new THREE.IcosahedronGeometry(R, 40)));
          const pos = g.getAttribute("position") as THREE.BufferAttribute;
          const dirs = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) {
            const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
            dirs.set([v.x, v.y, v.z], i * 3);
          }
          const amount = o.noise ?? 0.3;
          const speed = o.speed ?? 0.5;
          const m = mat("chrome");
          const mesh = new THREE.Mesh(g, m);
          mesh.castShadow = castsShadow(o);
          node.obj.add(mesh);
          node.tick = (t) => {
            const time = (t - layer.start) * speed;
            for (let i = 0; i < pos.count; i++) {
              const x = dirs[i * 3];
              const y = dirs[i * 3 + 1];
              const z = dirs[i * 3 + 2];
              const n = noise3(x * 1.1 + time, y * 1.1 + time * 0.7, z * 1.1 - time * 0.5) * 0.8 + noise3(x * 2.2 - time, y * 2.2, z * 2.2 + time) * 0.2;
              const r = R * (1 + amount * n);
              pos.setXYZ(i, x * r, y * r, z * r);
            }
            pos.needsUpdate = true;
            g.computeVertexNormals();
          };
          break;
        }
        case "ring": {
          if (!o.width) {
            const g = track(primitive("ring", o));
            node.obj.add(new THREE.Mesh(g, mat("plastic")));
            break;
          }
          // a flat band from `radius` out by `width`; a texture runs across the band (inner → outer)
          const inner = o.radius ?? 1.5;
          const g = track(new THREE.RingGeometry(inner, inner + o.width, 160, 1));
          const pos = g.getAttribute("position") as THREE.BufferAttribute;
          const uv = g.getAttribute("uv") as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const r = Math.hypot(pos.getX(i), pos.getY(i));
            uv.setXY(i, (r - inner) / o.width, 0.5);
          }
          const m = mat("matte") as THREE.MeshStandardMaterial;
          m.side = THREE.DoubleSide;
          if (m.map) {
            m.transparent = true;
            m.userData.alwaysTransparent = true;
            m.depthWrite = false;
          }
          const mesh = new THREE.Mesh(g, m);
          mesh.rotation.x = -Math.PI / 2;
          mesh.receiveShadow = true;
          node.obj.add(mesh);
          break;
        }
        default: {
          const g = track(primitive(o.kind, o));
          const plain = NATURAL_COLOR[o.kind] && !o.color && !(typeof o.material === "object" && o.material.color);
          const own = plain ? { ...o, color: NATURAL_COLOR[o.kind] } : o;
          const fallback: Material3Name = o.kind === "plane" || o.kind === "rock" || o.kind === "mountain" ? "matte" : "plastic";
          const make = () => {
            const made = track(makeMaterial(own, kit, fallback, tex));
            node.materials.push(made);
            return made;
          };
          const m = make();
          // a lathe is open at the top, a dome at the bottom: their inside shows
          if (o.kind === "lathe" || o.kind === "dome") m.side = THREE.DoubleSide;
          if (g.getAttribute("color") && m instanceof THREE.MeshStandardMaterial) m.vertexColors = true;
          let faces: THREE.Material | THREE.Material[] = m;
          if ((o.kind === "box" || o.kind === "cylinder") && o.windows) {
            // a façade: windows on the sides (each side its own count), a plain roof
            const win: Windows3 = typeof o.windows === "object" ? o.windows : {};
            const unit = o.size ?? 1.4;
            const w = o.width ?? unit;
            const h = o.height ?? unit;
            const d = o.depth ?? unit;
            const rows = Math.max(1, Math.round(o.floors ?? h / 0.24));
            const colsW = Math.max(1, Math.round(win.cols ?? w / 0.17));
            const colsD = Math.max(1, Math.round((colsW * d) / w));
            const tiles = windowTiles(win);
            const side = (cols: number) => {
              const sm = make() as THREE.MeshStandardMaterial;
              const at = new THREE.Vector2(Math.floor(rnd() * TILE) / TILE, Math.floor(rnd() * TILE) / TILE);
              const place = (t: THREE.Texture) => {
                const c = t.clone();
                c.repeat.set(cols / TILE, rows / TILE);
                c.offset.copy(at);
                textures.push(c);
                return c;
              };
              sm.map = place(tiles.map);
              if ("emissiveMap" in sm) {
                sm.emissiveMap = place(tiles.glow);
                sm.emissive = new THREE.Color("#ffffff");
                sm.emissiveIntensity = win.glow ?? 1;
              }
              sm.needsUpdate = true;
              return sm;
            };
            if (o.kind === "cylinder") {
              // one wall all the way round: its windows from the girth
              const n = Math.max(3, o.sides ?? 64);
              const r = o.radius ?? unit / 2;
              const girth = n * 2 * r * Math.sin(Math.PI / n);
              faces = [side(Math.max(3, Math.round(win.cols ? (win.cols * girth) / (2 * r) : girth / 0.17))), m, m];
            } else {
              const x = side(colsD);
              const z = side(colsW);
              faces = [x, x, m, m, z, z];
            }
          }
          const mesh = new THREE.Mesh(g, faces);
          mesh.castShadow = castsShadow(o) && o.material !== "glow";
          mesh.receiveShadow = true;
          if (o.kind === "box" && o.reflect && o.reflect > 0) {
            // still water, a wet street, a polished floor: a true mirror on the top face, tinted
            // by the surface's own colour (`reflect` 1 = a clear mirror)
            const unit = o.size ?? 1.4;
            const height = o.height ?? unit;
            const mirrorTint = color3(kit, o.color ?? "#2a6f9e").lerp(new THREE.Color(0.5, 0.5, 0.5), Math.min(1, o.reflect));
            const mirror = new Reflector(track(new THREE.PlaneGeometry(o.width ?? unit, o.depth ?? unit)), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: mirrorTint });
            mirror.rotation.x = -Math.PI / 2;
            mirror.position.y = (o.pivot === "bottom" ? height : height / 2) + 0.001;
            node.obj.add(mirror);
            cleanups.push(() => mirror.dispose());
          }
          node.obj.add(mesh);
        }
      }
      node.partBase = node.parts.map((p) => ({ p: p.position.clone(), r: p.rotation.clone(), s: p.scale.clone() }));
      if (o.fit) {
        const bb = new THREE.Box3().setFromObject(node.obj);
        node.width = bb.isEmpty() ? 0 : bb.max.x - bb.min.x;
      }
      return node;
    };

    const nodes: Node[] = [];
    for (const o of spec.objects ?? []) {
      const n = await makeNode(o);
      if (!n) continue;
      scene.add(n.obj);
      nodes.push(n);
    }
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 600);
    return {
      hash: "",
      spec,
      scene,
      camera,
      nodes,
      layer,
      dispose: () => {
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
        for (const t of textures) t.dispose();
        for (const t of tileCache.values()) {
          t.map.dispose();
          t.glow.dispose();
        }
        for (const clean of cleanups) clean();
      },
    };
  }

  function setOpacity(materials: THREE.Material[], opacity: number) {
    for (const m of materials) {
      const op = (m.userData.opacity ?? 1) * opacity;
      const transparent = Boolean(m.userData.alwaysTransparent) || op < 0.999 || m.transparent;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = op;
    }
  }

  function update(node: Node, t: number, parentOpacity: number) {
    const state = objectState(node.spec, t, kit);
    const o = node.obj;
    o.position.set(...state.position);
    o.rotation.set(...state.rotation);
    o.scale.set(...state.scale);
    const opacity = parentOpacity * state.opacity;
    o.visible = opacity > 0.002 && state.scale.every((s) => Math.abs(s) > 1e-5);
    setOpacity(node.materials, opacity);
    if (state.color) for (const m of node.materials) (m as THREE.MeshStandardMaterial).color?.set(state.color);
    if (state.glow !== undefined) for (const m of node.materials) if ("emissiveIntensity" in m) (m as THREE.MeshStandardMaterial).emissiveIntensity = state.glow;
    node.parts.forEach((part, i) => {
      const base = node.partBase[i];
      const ps = partState(node.spec, i, t, kit);
      part.position.copy(base.p);
      part.rotation.copy(base.r);
      part.scale.copy(base.s);
      let partOpacity = 1;
      if (ps) {
        part.position.add(new THREE.Vector3(...ps.position));
        part.rotation.set(base.r.x + ps.rotation[0], base.r.y + ps.rotation[1], base.r.z + ps.rotation[2]);
        part.scale.multiply(new THREE.Vector3(...ps.scale));
        partOpacity = ps.opacity;
      }
      part.visible = partOpacity > 0.002;
      if (node.partMaterials?.[i]) setOpacity(node.partMaterials[i], opacity * partOpacity);
      if (node.children[i]) update(node.children[i], t, opacity * partOpacity);
    });
    if (!node.parts.length || node.children.length !== node.parts.length) for (const child of node.children.slice(node.parts.length)) update(child, t, opacity);
    node.tick?.(t, state, opacity);
  }

  function grain(): HTMLCanvasElement {
    if (grainTile) return grainTile;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const img = g.createImageData(256, 256);
    const rnd = seeded(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rnd() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTile = c;
    return c;
  }

  return {
    available: () => Boolean(gl()),

    async load(sceneDoc, nextKit, loader) {
      kit = nextKit;
      const problems: string[] = [];
      const layers = allLayers(sceneDoc.layers).filter((l) => l.type === "scene3d");
      const keep = new Set<string>();
      if (layers.length && !gl()) problems.push("WebGL (3D can't be drawn on this computer)");
      for (const layer of layers) {
        keep.add(layer.id);
        const hash = JSON.stringify([layer.scene3d ?? {}, layer.start, layer.end, kit.colors, kit.fonts, sceneDoc.assets ?? {}]);
        const old = built.get(layer.id);
        if (old && old.hash === hash) {
          old.layer = layer;
          continue;
        }
        old?.dispose();
        try {
          const b = await buildLayer(layer, sceneDoc, loader, problems);
          b.hash = hash;
          built.set(layer.id, b);
        } catch (err) {
          built.delete(layer.id);
          problems.push(`${layer.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      for (const [id, b] of built) {
        if (keep.has(id)) continue;
        b.dispose();
        built.delete(id);
      }
      return problems;
    },

    draw(layer, ctx, box, localTime) {
      const b = built.get(layer.id);
      const r = gl();
      if (!b || !r) return;
      const m = ctx.getTransform();
      const sx = Math.hypot(m.a, m.b);
      const sy = Math.hypot(m.c, m.d);
      let w = Math.round(box.w * sx);
      let h = Math.round(box.h * sy);
      const k = Math.min(1, MAX_SIDE / Math.max(w, h));
      w = Math.max(2, Math.round(w * k));
      h = Math.max(2, Math.round(h * k));
      const t = layer.start + localTime;
      for (const node of b.nodes) update(node, t, 1);
      const cam = cameraState(b.spec.camera, t, layer.start, layer.end, kit, b.spec.seed ?? hashString(layer.id));
      b.camera.position.set(...cam.position);
      b.camera.fov = cam.fov;
      b.camera.aspect = box.w / Math.max(1e-6, box.h);
      b.camera.lookAt(...cam.target);
      b.camera.updateProjectionMatrix();
      // titles that would run off a narrow frame shrink to fit it
      for (const node of b.nodes) {
        if (!node.width) continue;
        const d = b.camera.position.distanceTo(node.obj.position);
        const visible = 2 * d * Math.tan((cam.fov * DEG) / 2) * b.camera.aspect;
        const k = Math.min(1, (visible * 0.86) / node.width);
        if (k < 1) node.obj.scale.multiplyScalar(k);
      }
      const canvas = r.domElement as unknown as HTMLCanvasElement | OffscreenCanvas;
      if (canvas.width !== w || canvas.height !== h) r.setSize(w, h, false);
      r.toneMappingExposure = b.spec.exposure ?? 0.9;
      r.render(b.scene, b.camera);

      const post = b.spec.post ?? {};
      ctx.save();
      if (b.spec.background) {
        ctx.fillStyle = canvasPaint(ctx, kit, b.spec.background, box);
        ctx.fillRect(box.x, box.y, box.w, box.h);
      }
      ctx.drawImage(canvas as CanvasImageSource, box.x, box.y, box.w, box.h);
      const bloom = Math.min(3, Math.max(0, post.bloom ?? 0));
      if (bloom > 0.01) {
        // the bright parts, blurred twice and added on top
        const short = Math.min(box.w, box.h);
        ctx.globalCompositeOperation = "lighter";
        for (const [radius, alpha] of [[0.012, 0.55], [0.045, 0.45]] as const) {
          ctx.globalAlpha = Math.min(1, bloom * alpha);
          ctx.filter = `brightness(0.85) contrast(2.4) blur(${(short * radius).toFixed(1)}px)`;
          ctx.drawImage(canvas as CanvasImageSource, box.x, box.y, box.w, box.h);
        }
        ctx.filter = "none";
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      if (post.vignette) {
        const g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) * 0.35, box.x + box.w / 2, box.y + box.h / 2, Math.hypot(box.w, box.h) / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${Math.min(1, post.vignette) * 0.8})`);
        ctx.fillStyle = g;
        ctx.fillRect(box.x, box.y, box.w, box.h);
      }
      if (post.grain) {
        const tile = grain();
        const pattern = ctx.createPattern(tile, "repeat");
        if (pattern) {
          const frame = Math.floor(t * 24);
          pattern.setTransform(new DOMMatrix().translate((frame * 73) % 256, (frame * 151) % 256));
          ctx.globalCompositeOperation = "overlay";
          ctx.globalAlpha = Math.min(1, post.grain) * 0.6;
          ctx.fillStyle = pattern;
          ctx.fillRect(box.x, box.y, box.w, box.h);
        }
      }
      ctx.restore();
    },

    dispose() {
      for (const b of built.values()) b.dispose();
      built.clear();
      if (joined) {
        joined = false;
        releaseShared();
      }
    },
  };
}
