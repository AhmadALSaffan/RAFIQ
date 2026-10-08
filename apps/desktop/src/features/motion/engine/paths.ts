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
