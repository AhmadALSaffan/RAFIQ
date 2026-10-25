/**
 * SVG path data → polylines. One flattening serves drawing, trimming (drawOn needs the
 * length, which Path2D can't tell, and there's no DOM in the export worker) and Lottie.
 */

export type Pt = [number, number];
export interface Polyline {
  points: Pt[];
  closed: boolean;
}

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps: number, out: Pt[]) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    out.push([
      m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
      m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function quad(p0: Pt, p1: Pt, p2: Pt, steps: number, out: Pt[]) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    out.push([m * m * p0[0] + 2 * m * t * p1[0] + t * t * p2[0], m * m * p0[1] + 2 * m * t * p1[1] + t * t * p2[1]]);
  }
}

// SVG arc (endpoint parameterisation) → points, per the SVG spec's conversion.
function arc(p0: Pt, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Pt, out: Pt[]) {
  if (rx === 0 || ry === 0) {
    out.push(p1);
    return;
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * 8));
  for (let i = 1; i <= steps; i++) {
    const a = t1 + (dt * i) / steps;
    out.push([cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos]);
  }
}

export function parsePath(d: string, steps = 12): Polyline[] {
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(TOKEN)) tokens.push(m[1] ?? Number(m[2]));
  const lines: Polyline[] = [];
  let current: Pt[] = [];
  let pos: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastCtrl: Pt | null = null;
  let lastCmd = "";
  let i = 0;
  let cmd = "";
  const n = () => Number(tokens[i++]);
  const flush = (closed: boolean) => {
    if (current.length > 1) lines.push({ points: current, closed });
    current = [];
  };
  while (i < tokens.length) {
    if (typeof tokens[i] === "string") cmd = tokens[i++] as string;
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? pos[0] : 0;
    const oy = rel ? pos[1] : 0;
    switch (C) {
      case "M": {
        flush(false);
        pos = [n() + ox, n() + oy];
        start = pos;
        current = [pos];
        cmd = rel ? "l" : "L"; // following pairs are line-tos
        lastCtrl = null;
        break;
      }
      case "L":
        pos = [n() + ox, n() + oy];
        current.push(pos);
        lastCtrl = null;
        break;
      case "H":
        pos = [n() + ox, pos[1]];
        current.push(pos);
        lastCtrl = null;
        break;
      case "V":
        pos = [pos[0], n() + oy];
        current.push(pos);
        lastCtrl = null;
        break;
      case "C": {
        const c1: Pt = [n() + ox, n() + oy];
        const c2: Pt = [n() + ox, n() + oy];
        const end: Pt = [n() + ox, n() + oy];
        cubic(pos, c1, c2, end, steps, current);
        lastCtrl = c2;
        pos = end;
        break;
      }
      case "S": {
        const c1: Pt = lastCtrl && "CS".includes(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const c2: Pt = [n() + ox, n() + oy];
        const end: Pt = [n() + ox, n() + oy];
        cubic(pos, c1, c2, end, steps, current);
        lastCtrl = c2;
        pos = end;
        break;
      }
      case "Q": {
        const c: Pt = [n() + ox, n() + oy];
        const end: Pt = [n() + ox, n() + oy];
        quad(pos, c, end, steps, current);
        lastCtrl = c;
        pos = end;
        break;
      }
      case "T": {
        const c: Pt = lastCtrl && "QT".includes(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
        const end: Pt = [n() + ox, n() + oy];
        quad(pos, c, end, steps, current);
        lastCtrl = c;
        pos = end;
        break;
      }
      case "A": {
        const rx = n();
        const ry = n();
        const rot = n();
        const large = n();
        const sweep = n();
        const end: Pt = [n() + ox, n() + oy];
        arc(pos, rx, ry, rot, large, sweep, end, current);
        pos = end;
        lastCtrl = null;
        break;
      }
      case "Z":
        if (current.length) current.push(start);
        pos = start;
        flush(true);
        current = [start];
        lastCtrl = null;
        break;
      default:
        i++;
    }
    lastCmd = C;
  }
  flush(false);
  return lines;
}

export function length(lines: Polyline[]): number {
  let total = 0;
  for (const line of lines) {
    for (let i = 1; i < line.points.length; i++) {
      total += Math.hypot(line.points[i][0] - line.points[i - 1][0], line.points[i][1] - line.points[i - 1][1]);
    }
  }
  return total;
}

/** The first `fraction` of the polylines' total length (drawOn). */
export function trimLines(lines: Polyline[], fraction: number): Polyline[] {
  if (fraction >= 1) return lines;
  let budget = length(lines) * Math.max(0, fraction);
  const out: Polyline[] = [];
  for (const line of lines) {
    if (budget <= 0) break;
    const pts: Pt[] = [line.points[0]];
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1];
      const b = line.points[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (seg <= budget) {
        pts.push(b);
        budget -= seg;
      } else {
        const u = seg ? budget / seg : 0;
        pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
        budget = 0;
        break;
      }
    }
    out.push({ points: pts, closed: false });
  }
  return out;
}

export function rectPath(x: number, y: number, w: number, h: number, r: number): Polyline[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], closed: true }];
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (Math.PI / 2) * (i / 6);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  };
  corner(x + w - rr, y + rr, -Math.PI / 2);
  corner(x + w - rr, y + h - rr, 0);
  corner(x + rr, y + h - rr, Math.PI / 2);
  corner(x + rr, y + rr, Math.PI);
  pts.push(pts[0]);
  return [{ points: pts, closed: true }];
}

export function ellipsePath(x: number, y: number, w: number, h: number): Polyline[] {
  const pts: Pt[] = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    // start at the top, go clockwise — the way a hand draws a circle
    const a = -Math.PI / 2 + (2 * Math.PI * i) / steps;
    pts.push([x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]);
  }
  return [{ points: pts, closed: true }];
}

export function starPath(x: number, y: number, w: number, h: number, points: number): Polyline[] {
  const pts: Pt[] = [];
  const n = Math.max(3, points) * 2;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    const r = i % 2 === 0 ? 1 : 0.45;
    pts.push([x + w / 2 + (w / 2) * r * Math.cos(a), y + h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return [{ points: pts, closed: true }];
}

export function toPath2D(lines: Polyline[]): Path2D {
  const p = new Path2D();
  for (const line of lines) {
    line.points.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
    if (line.closed) p.closePath();
  }
  return p;
}

/** A regular polygon with `sides` corners, pointing up. */
export function polygonPath(x: number, y: number, w: number, h: number, sides: number): Polyline[] {
  const n = Math.max(3, Math.round(sides));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pts.push([x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return [{ points: pts, closed: true }];
}

/** A triangle filling the box, point up. */
export function trianglePath(x: number, y: number, w: number, h: number): Polyline[] {
  return [{ points: [[x + w / 2, y], [x + w, y + h], [x, y + h], [x + w / 2, y]], closed: true }];
}

/** An arrow along the box, pointing to `toEnd` (right) or the other way; the head is a third of it. */
export function arrowPath(x: number, y: number, w: number, h: number, toEnd: boolean): Polyline[] {
  const head = Math.min(w * 0.4, h * 1.2);
  const shaft = h * 0.36;
  const cy = y + h / 2;
  const pts: Pt[] = [
    [x, cy - shaft / 2],
    [x + w - head, cy - shaft / 2],
    [x + w - head, y],
    [x + w, cy],
    [x + w - head, y + h],
    [x + w - head, cy + shaft / 2],
    [x, cy + shaft / 2],
    [x, cy - shaft / 2],
  ];
  return [{ points: toEnd ? pts : pts.map(([px, py]) => [2 * x + w - px, py] as Pt), closed: true }];
}

function arcPoints(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Pt[] {
  const pts: Pt[] = [];
  const steps = Math.max(8, Math.ceil(Math.abs(to - from) / 5));
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps - 90) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** A ring (donut): the outer circle and the hole, filled even-odd. `thickness` in px. */
export function ringPath(x: number, y: number, w: number, h: number, thickness: number): Polyline[] {
  const t = Math.max(1, Math.min(thickness, Math.min(w, h) / 2));
  const outer = arcPoints(x + w / 2, y + h / 2, w / 2, h / 2, 0, 360);
  const inner = arcPoints(x + w / 2, y + h / 2, w / 2 - t, h / 2 - t, 360, 0);
  return [
    { points: outer, closed: true },
    { points: inner, closed: true },
  ];
}

/** A band from `from` to `to` degrees (0 = top, clockwise), `thickness` px wide — a progress ring. */
export function arcPath(x: number, y: number, w: number, h: number, from: number, to: number, thickness: number): Polyline[] {
  const t = Math.max(1, Math.min(thickness, Math.min(w, h) / 2));
  const outer = arcPoints(x + w / 2, y + h / 2, w / 2, h / 2, from, to);
  const inner = arcPoints(x + w / 2, y + h / 2, w / 2 - t, h / 2 - t, to, from);
  return [{ points: [...outer, ...inner, outer[0]], closed: true }];
}

/** A heart filling the box. */
export function heartPath(x: number, y: number, w: number, h: number): Polyline[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 96; i++) {
    const s = (2 * Math.PI * i) / 96;
    const hx = 16 * Math.sin(s) ** 3;
    const hy = 13 * Math.cos(s) - 5 * Math.cos(2 * s) - 2 * Math.cos(3 * s) - Math.cos(4 * s);
    pts.push([x + w / 2 + (hx / 34) * w, y + h * 0.42 - (hy / 30) * h]);
  }
  return [{ points: pts, closed: true }];
}

// ── More outlines (one set for 2D shapes and 3D extrusions) ─────────────────────────────

/** Points in a 0..1 box (y down) → the box. */
function inBox(x: number, y: number, w: number, h: number, unit: Pt[]): Polyline[] {
  return [{ points: unit.map(([u, v]) => [x + u * w, y + v * h] as Pt), closed: true }];
}

function circlePoints(cx: number, cy: number, r: number, from: number, to: number, steps = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** A gem: four points. */
function diamond(): Pt[] {
  return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]];
}

/** A lightning bolt. */
function bolt(): Pt[] {
  return [[0.62, 0], [0.12, 0.58], [0.46, 0.58], [0.34, 1], [0.88, 0.38], [0.53, 0.38], [0.62, 0]];
}

/** A drop, point up. */
function drop(): Pt[] {
  const pts: Pt[] = [[0.5, 0]];
  // the round belly: a circle from the right shoulder, under, to the left shoulder
  pts.push(...circlePoints(0.5, 0.64, 0.36, -30, 210, 40));
  pts.push([0.5, 0]);
  return pts;
}

/** A plus / cross, arms `0.34` of the box thick. */
function plus(): Pt[] {
  const a = 0.33;
  const b = 0.67;
  return [[a, 0], [b, 0], [b, a], [1, a], [1, b], [b, b], [b, 1], [a, 1], [a, b], [0, b], [0, a], [a, a], [a, 0]];
}

/** A crescent moon opening to the right. */
function moon(): Pt[] {
  const outer = circlePoints(0.5, 0.5, 0.5, 60, 300, 48);
  // the inner bite, back the other way
  const inner = circlePoints(0.72, 0.42, 0.42, 248, 112, 40).filter(([u, v]) => (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25 + 1e-9);
  return [...outer, ...inner, outer[0]];
}

/** A cloud: three puffs on a flat base. */
function cloud(): Pt[] {
  const pts: Pt[] = [[0.12, 0.92]];
  pts.push(...circlePoints(0.22, 0.7, 0.2, 90, 270, 16));
  pts.push(...circlePoints(0.45, 0.45, 0.3, 200, 320, 20));
  pts.push(...circlePoints(0.75, 0.6, 0.22, 240, 450, 20));
  pts.push([0.12, 0.92]);
  return pts;
}

/** A gear with `teeth` teeth. */
function gear(teeth: number): Pt[] {
  const n = Math.max(4, Math.round(teeth));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const step = (Math.PI * 2) / n;
    for (const [f, r] of [[0, 0.38], [0.18, 0.5], [0.5, 0.5], [0.68, 0.38]] as const) {
      const a = a0 + f * step - Math.PI / 2;
      pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
    }
  }
  pts.push(pts[0]);
  return pts;
}

/** A squircle: a square with soft, continuous corners. */
function squircle(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    pts.push([0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** 0.5, 0.5 + 0.5 * Math.sign(sn) * Math.abs(sn) ** 0.5]);
  }
  return pts;
}

/** A starburst / badge with `rays` rays. */
function burst(rays: number): Pt[] {
  const n = Math.max(6, Math.round(rays)) * 2;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    const r = i % 2 === 0 ? 0.5 : 0.41;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return pts;
}

/** An organic blob, the same for the same `seed`. */
function blob(seed: number): Pt[] {
  const k = Math.max(1, Math.round(seed));
  const pts: Pt[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r = 0.37 + 0.06 * Math.sin(3 * a + k) + 0.04 * Math.sin(5 * a + k * 1.7) + 0.03 * Math.cos(2 * a + k * 0.6);
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return pts;
}

/** A speech bubble with its tail at the bottom-start. */
function bubble(): Pt[] {
  const r = 0.16;
  const top = 0;
  const bottom = 0.78;
  const pts: Pt[] = [];
  pts.push(...circlePoints(r, top + r, r, 180, 270, 8));
  pts.push(...circlePoints(1 - r, top + r, r, 270, 360, 8));
  pts.push(...circlePoints(1 - r, bottom - r, r, 0, 90, 8));
  pts.push([0.42, bottom], [0.2, 1], [0.26, bottom]);
  pts.push(...circlePoints(r, bottom - r, r, 90, 180, 8));
  pts.push(pts[0]);
  return pts;
}

/** A shield. */
function shield(): Pt[] {
  const pts: Pt[] = [[0.5, 0], [1, 0.14], [1, 0.48]];
  // down to the point in a soft curve each side
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    pts.push([1 - 0.5 * t * t, 0.48 + 0.52 * t]);
  }
  for (let i = 11; i >= 0; i--) {
    const t = i / 12;
    pts.push([0.5 * t * t, 0.48 + 0.52 * t]);
  }
  pts.push([0, 0.14], [0.5, 0]);
  return pts;
}

/** Names `outlinePath` knows, beyond the ones with their own functions above. */
export const OUTLINES = ["heart", "star", "triangle", "polygon", "diamond", "bolt", "drop", "plus", "moon", "cloud", "gear", "squircle", "burst", "blob", "bubble", "shield", "arrow", "circle"] as const;
export type OutlineName = (typeof OUTLINES)[number];

/** One named outline filling the box; `points` is a star's points, a polygon's sides, a
 *  gear's teeth, a burst's rays, or a blob's seed. */
export function outlinePath(name: string, x: number, y: number, w: number, h: number, points?: number): Polyline[] | null {
  switch (name) {
    case "heart":
      return heartPath(x, y, w, h);
    case "star":
      return starPath(x, y, w, h, points ?? 5);
    case "triangle":
      return trianglePath(x, y, w, h);
    case "polygon":
      return polygonPath(x, y, w, h, points ?? 6);
    case "circle":
      return ellipsePath(x, y, w, h);
    case "arrow":
      return arrowPath(x, y, w, h, true);
    case "diamond":
      return inBox(x, y, w, h, diamond());
    case "bolt":
      return inBox(x, y, w, h, bolt());
    case "drop":
      return inBox(x, y, w, h, drop());
    case "plus":
      return inBox(x, y, w, h, plus());
    case "moon":
      return inBox(x, y, w, h, moon());
    case "cloud":
      return inBox(x, y, w, h, cloud());
    case "gear":
      return inBox(x, y, w, h, gear(points ?? 10));
    case "squircle":
      return inBox(x, y, w, h, squircle());
    case "burst":
      return inBox(x, y, w, h, burst(points ?? 16));
    case "blob":
      return inBox(x, y, w, h, blob(points ?? 1));
    case "bubble":
      return inBox(x, y, w, h, bubble());
    case "shield":
      return inBox(x, y, w, h, shield());
    default:
      return null;
  }
}
