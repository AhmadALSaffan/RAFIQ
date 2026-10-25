/**
 * Ready arrangements for a composed track: `style: "lofi"` (with `key` and `tempo`) gives a
 * whole band — chords, bass, drums, an arpeggio — written in the track's key, so even a
 * model that has never written music gets a soundtrack that holds together. The model's
 * own `parts` play on top (a melody, a riser, an extra drum), or it skips the style and
 * writes everything itself.
 *
 * Everything is built from the key's scale: chords are stacked scale degrees, the bass
 * plays their roots, the arpeggios their notes — so nothing clashes.
 */

import type { ScoreNote, ScorePart } from "./types";

export const STYLES = ["lofi", "cinematic", "epic", "synthwave", "house", "trap", "ambient", "corporate", "piano", "arabic", "playful", "tension"] as const;
export type MusicStyle = (typeof STYLES)[number];

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// maqam Hijaz: the raised third over a flat second gives it its sound
const HIJAZ = [0, 1, 4, 5, 7, 8, 10];

interface Style {
  minor: boolean;
  tempo: number;
  swing?: number;
  reverb?: number;
  sidechain?: boolean;
  scale?: number[];
  /** scale degrees (1-based), one chord per 4-beat bar */
  major: number[];
  minorProg: number[];
  parts: (h: Harmony) => ScorePart[];
}

/** What a style writes with: the progression's chords, roots and scale, in the key. */
interface Harmony {
  /** each bar's chord, 3 or 4 notes, MIDI, around octave 3 */
  chord: (bar: number, size?: 3 | 4, octave?: number) => number[];
  root: (bar: number, octave?: number) => number;
  /** one note of the scale, degree from 1, octave 3 */
  degree: (d: number, octave?: number) => number;
  bars: number;
}

const LOOP = 16;

/** Chords over the progression's four bars, `d` beats each. */
function chords(h: Harmony, size: 3 | 4, octave = 3, at: number[] = [0], d = 4): ScoreNote[] {
  const out: ScoreNote[] = [];
  for (let bar = 0; bar < h.bars; bar++) for (const t of at) out.push({ t: bar * 4 + t, n: h.chord(bar, size, octave), d, v: 0.7 });
  return out;
}

/** Each bar's root on the given beats. */
function roots(h: Harmony, at: number[], d: number, octave = 2): ScoreNote[] {
  const out: ScoreNote[] = [];
  for (let bar = 0; bar < h.bars; bar++) for (const t of at) out.push({ t: bar * 4 + t, n: h.root(bar, octave), d, v: 0.85 });
  return out;
}

const STEPS = {
  four: "x...x...x...x...",
  backbeat: "....x.......x...",
  offHat: "..x...x...x...x.",
  eighths: "x.x.x.x.x.x.x.x.",
};

const BOOK: Record<MusicStyle, Style> = {
  lofi: {
    minor: true, tempo: 80, swing: 0.22, reverb: 0.5,
    major: [2, 5, 1, 6], minorProg: [1, 6, 3, 7],
    parts: (h) => [
      { instrument: "epiano", notes: chords(h, 4, 3, [0], 3.6), loop: LOOP, gain: -3 },
      { instrument: "bass", notes: roots(h, [0, 2.5], 1.2), loop: LOOP, gain: -2 },
      { drum: "kick", steps: "x.........x.....", from: 4, gain: -2 },
      { drum: "snare", steps: STEPS.backbeat, from: 4, gain: -5, reverb: 0.25 },
      { drum: "hat", steps: STEPS.eighths, from: 4, gain: -10 },
    ],
  },
  cinematic: {
    minor: true, tempo: 90, reverb: 0.85, sidechain: false,
    major: [1, 6, 4, 5], minorProg: [1, 6, 3, 7],
    parts: (h) => [
      { instrument: "strings", notes: chords(h, 3, 3), loop: LOOP, gain: -2 },
      { instrument: "piano", notes: chords(h, 3, 4, [0], 4), arp: "up", rate: 0.5, loop: LOOP, gain: -7 },
      { instrument: "sub", notes: roots(h, [0], 4, 1), loop: LOOP, gain: -4 },
      { drum: "tom", hits: [0, 0.75, 1.5], loop: 8, from: 8, gain: -4, reverb: 0.5 },
      { drum: "crash", hits: [0], loop: LOOP, from: 8, gain: -10 },
    ],
  },
  epic: {
    minor: true, tempo: 120, reverb: 0.75,
    major: [1, 5, 6, 4], minorProg: [1, 6, 3, 7],
    parts: (h) => [
      { instrument: "brass", notes: chords(h, 3, 3, [0, 2], 1.8), loop: LOOP, gain: -3 },
      { instrument: "strings", notes: chords(h, 4, 3), loop: LOOP, gain: -5 },
      { instrument: "choir", notes: chords(h, 3, 4), loop: LOOP, gain: -9 },
      { instrument: "sub", notes: roots(h, [0, 2], 1.8, 1), loop: LOOP, gain: -4 },
      { drum: "tom", steps: "x..x..x.x..x..x.", gain: -3, reverb: 0.4 },
      { drum: "kick", steps: STEPS.four, gain: -2 },
      { drum: "snare", steps: STEPS.backbeat, from: 4, gain: -4 },
      { drum: "crash", hits: [0], loop: LOOP, gain: -9 },
    ],
  },
  synthwave: {
    minor: true, tempo: 100, reverb: 0.6,
    major: [1, 5, 6, 4], minorProg: [1, 6, 3, 7],
    parts: (h) => [
      { instrument: "supersaw", notes: chords(h, 3, 3), loop: LOOP, gain: -5 },
      { instrument: "bass", notes: roots(h, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 0.42), loop: LOOP, gain: -3, cutoff: 900 },
      { instrument: "arp", notes: chords(h, 4, 4), arp: "up", rate: 0.25, loop: LOOP, gain: -10, delay: { time: 0.75, feedback: 0.35, mix: 0.3 } },
      { drum: "kick", steps: STEPS.four, from: 4, gain: -2 },
      { drum: "snare", steps: STEPS.backbeat, from: 4, gain: -4, reverb: 0.5 },
      { drum: "hat", steps: STEPS.offHat, from: 4, gain: -9 },
    ],
  },
  house: {
    minor: true, tempo: 124, reverb: 0.4,
    major: [6, 4, 1, 5], minorProg: [1, 7, 6, 7],
    parts: (h) => [
      { instrument: "keys", notes: chords(h, 4, 3, [1.5, 3.5], 0.4), loop: LOOP, gain: -5 },
      { instrument: "sub", notes: roots(h, [0.5, 1.5, 2.5, 3.5], 0.4), loop: LOOP, gain: -3 },
      { drum: "kick", steps: STEPS.four, gain: -1 },
      { drum: "clap", steps: STEPS.backbeat, from: 4, gain: -4 },
      { drum: "openhat", steps: STEPS.offHat, from: 4, gain: -9 },
      { drum: "shaker", steps: "xxxxxxxxxxxxxxxx", from: 8, gain: -16 },
    ],
  },
  trap: {
    minor: true, tempo: 140, reverb: 0.45,
    major: [6, 4, 1, 5], minorProg: [1, 6, 7, 6],
    parts: (h) => [
      { instrument: "pad", notes: chords(h, 3, 3), loop: LOOP, gain: -9 },
      { instrument: "bell", notes: chords(h, 3, 4, [0], 4), arp: "updown", rate: 0.5, loop: LOOP, gain: -11 },
      { instrument: "808", notes: roots(h, [0, 2.75], 1.4, 1), loop: LOOP, gain: -1 },
      { drum: "kick", steps: "x......x..x.....", from: 4, gain: -2 },
      { drum: "clap", steps: "........x.......", from: 4, gain: -3 },
      { drum: "hat", steps: "x.x.x.x.xxx.x.xx", from: 4, gain: -9 },
    ],
  },
  ambient: {
    minor: false, tempo: 70, reverb: 0.95, sidechain: false,
    major: [1, 4, 6, 5], minorProg: [1, 6, 4, 6],
    parts: (h) => [
      { instrument: "pad", notes: chords(h, 4, 3), loop: LOOP, gain: -3 },
      { instrument: "glass", notes: chords(h, 3, 4), loop: LOOP, gain: -9 },
      { instrument: "bell", notes: chords(h, 3, 5, [0], 4), arp: "random", rate: 1.5, loop: LOOP, gain: -14, delay: { time: 1.5, feedback: 0.45, mix: 0.4 } },
    ],
  },
  corporate: {
    minor: false, tempo: 110, reverb: 0.4,
    major: [1, 5, 6, 4], minorProg: [6, 4, 1, 5],
    parts: (h) => [
      { instrument: "pluck", notes: chords(h, 3, 4), arp: "updown", rate: 0.25, loop: LOOP, gain: -5 },
      { instrument: "piano", notes: chords(h, 3, 3), loop: LOOP, gain: -7 },
      { instrument: "bass", notes: roots(h, [0, 2], 1.6), loop: LOOP, gain: -4 },
      { drum: "kick", steps: "x.......x.......", from: 4, gain: -3 },
      { drum: "clap", steps: STEPS.backbeat, from: 4, gain: -6 },
      { drum: "shaker", steps: STEPS.eighths, from: 4, gain: -12 },
    ],
  },
  piano: {
    minor: true, tempo: 76, reverb: 0.55, sidechain: false,
    major: [1, 5, 6, 4], minorProg: [1, 6, 3, 7],
    parts: (h) => [
      { instrument: "piano", notes: roots(h, [0], 4, 2), loop: LOOP, gain: -4 },
      { instrument: "piano", notes: chords(h, 3, 4, [0], 4), arp: "up", rate: 0.5, loop: LOOP, gain: -6 },
    ],
  },
  arabic: {
    minor: true, tempo: 96, reverb: 0.5, scale: HIJAZ,
    major: [1, 7, 4, 1], minorProg: [1, 7, 4, 1],
    parts: (h) => [
      { instrument: "oud", notes: chords(h, 3, 3, [0], 4), arp: "updown", rate: 0.25, loop: LOOP, gain: -2 },
      { instrument: "qanun", notes: chords(h, 3, 4, [0], 4), arp: "up", rate: 0.25, loop: LOOP, from: 8, gain: -10 },
      { instrument: "ney", notes: [0, 1, 2, 3].map((bar) => ({ t: bar * 4, n: h.degree(bar % 2 ? 5 : 1, 4), d: 3.5, v: 0.6 })), loop: LOOP, gain: -8 },
      { instrument: "bass", notes: roots(h, [0, 2], 1.5), loop: LOOP, gain: -5 },
      // maqsoum: doum . tek . . . tek . doum . . . tek . . .
      { drum: "doum", steps: "x.......x.......", gain: -1 },
      { drum: "tek", steps: "..x...x.....x...", gain: -4 },
      { drum: "riq", steps: STEPS.eighths, from: 4, gain: -12 },
    ],
  },
  playful: {
    minor: false, tempo: 118, reverb: 0.35,
    major: [1, 4, 5, 4], minorProg: [1, 4, 6, 5],
    parts: (h) => [
      { instrument: "marimba", notes: chords(h, 3, 4), arp: "updown", rate: 0.25, loop: LOOP, gain: -4 },
      { instrument: "kalimba", notes: chords(h, 3, 4, [1, 3], 0.5), loop: LOOP, gain: -9 },
      { instrument: "pluck", notes: roots(h, [0, 1.5, 2, 3], 0.4), loop: LOOP, gain: -6 },
      { drum: "kick", steps: "x.....x.x.......", from: 4, gain: -4 },
      { drum: "clap", steps: STEPS.backbeat, from: 4, gain: -6 },
      { drum: "snap", steps: "......x.......x.", from: 8, gain: -9 },
    ],
  },
  tension: {
    minor: true, tempo: 100, reverb: 0.7, sidechain: false,
    major: [1, 1, 6, 5], minorProg: [1, 1, 6, 5],
    parts: (h) => [
      { instrument: "sub", notes: [{ t: 0, n: h.root(0, 1), d: 16, v: 0.8 }], loop: LOOP, gain: -3 },
      { instrument: "strings", notes: chords(h, 3, 2), loop: LOOP, gain: -6, sweep: { from: 400, to: 4000 } },
      { instrument: "synth", notes: roots(h, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 0.2, 2), loop: LOOP, gain: -10 },
      { drum: "rim", steps: STEPS.eighths, gain: -14 },
      { drum: "tom", hits: [0], loop: 8, gain: -4, reverb: 0.6 },
    ],
  },
};

/** "Am" → root pitch class and minor; "F#" → F#, major (a style's own default otherwise). */
function parseKey(key: string | undefined): { pc: number; minor: boolean | null } {
  const m = /^([A-G])(#|b)?(m)?$/.exec(key ?? "");
  if (!m) return { pc: 9, minor: null };
  return { pc: (PITCH[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12, minor: m[3] === "m" };
}

/** A style's parts in the track's key, and its own tempo, swing and room. */
export function styleParts(style: string, key?: string): { parts: ScorePart[]; tempo: number; swing?: number; reverb?: number; sidechain?: boolean } | null {
  const s = BOOK[style as MusicStyle];
  if (!s) return null;
  const parsed = parseKey(key);
  const minor = parsed.minor ?? s.minor;
  // with no key given, a minor style sits in A minor, a major one in C
  const pc = key ? parsed.pc : minor ? 9 : 0;
  const scale = s.scale ?? (minor ? MINOR : MAJOR);
  const prog = s.scale ? s.minorProg : minor ? s.minorProg : s.major;
  const note = (index: number, octave: number) => 12 * (octave + 1) + pc + scale[((index % 7) + 7) % 7] + 12 * Math.floor(index / 7);
  const harmony: Harmony = {
    bars: prog.length,
    chord: (bar, size = 3, octave = 3) => {
      const d = prog[bar % prog.length] - 1;
      return [0, 2, 4, 6].slice(0, size).map((k) => note(d + k, octave));
    },
    root: (bar, octave = 2) => note(prog[bar % prog.length] - 1, octave),
    degree: (d, octave = 3) => note(d - 1, octave),
  };
  return { parts: s.parts(harmony), tempo: s.tempo, swing: s.swing, reverb: s.reverb, sidechain: s.sidechain };
}
