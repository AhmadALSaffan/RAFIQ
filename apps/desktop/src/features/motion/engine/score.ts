/**
 * Composed music: the model writes the score — parts on instruments it picks and shapes,
 * notes and chords on beats, drums by beat or by step — and this renders it, deterministic
 * like the rest of the soundtrack (seeded noise, no clocks). The whole score is rendered
 * once into a buffer the length of its track, through one reverb send, with the pads and
 * chords ducking under the kick when asked; the mixer then reads windows of it.
 */

import type { AudioTrack, ScoreNote, ScorePart } from "./types";

const SR = 48000;
const TAIL = 2.5; // reverb and release past the last note

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORDS: Record<string, number[]> = {
  "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
  "9": [0, 4, 7, 10, 14], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], aug: [0, 4, 8], add9: [0, 4, 7, 14], "5": [0, 7],
};

/** "C4", "F#3", "Bb2" or a MIDI number → MIDI; a chord name ("Am7", "Fmaj7", "Gsus4") → its notes from octave 4. */
export function parseNote(n: number | string, octave = 0): number[] {
  if (typeof n === "number") return [n + octave * 12];
  const s = n.trim();
  const single = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  if (single) return [12 * (Number(single[3]) + 1) + PITCH[single[1]] + (single[2] === "#" ? 1 : single[2] === "b" ? -1 : 0) + octave * 12];
  const chord = /^([A-G])(#|b)?(maj9|maj7|m9|m7|m6|sus2|sus4|dim|aug|add9|m|7|9|6|5)?(?:\/(-?\d))?$/.exec(s);
  if (chord) {
    const root = 12 * (Number(chord[4] ?? 4) + 1) + PITCH[chord[1]] + (chord[2] === "#" ? 1 : chord[2] === "b" ? -1 : 0) + octave * 12;
    return (CHORDS[chord[3] ?? ""] ?? CHORDS[""]).map((i) => root + i);
  }
  return [];
}

// ── Voices ──────────────────────────────────────────────────────────────────────────────

type Wave = NonNullable<ScorePart["wave"]>;

interface Voice {
  wave: Wave;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  detune: number;
  vibrato: number;
  reverb: number;
  /** fm: modulator ratio and index */
  ratio?: number;
  index?: number;
  /** 808: semitones the pitch falls from at the start */
  drop?: number;
  formant?: boolean;
  breath?: number;
  level: number;
}

const PRESETS: Record<string, Voice> = {
  pad: { wave: "saw", attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.4, cutoff: 1500, resonance: 0.8, detune: 10, vibrato: 0, reverb: 0.55, level: 0.22 },
  strings: { wave: "saw", attack: 0.35, decay: 0.4, sustain: 0.85, release: 0.9, cutoff: 2600, resonance: 0.7, detune: 6, vibrato: 0.08, reverb: 0.5, level: 0.22 },
  piano: { wave: "piano", attack: 0.002, decay: 2.2, sustain: 0, release: 0.45, cutoff: 7000, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0.3, level: 0.5 },
  keys: { wave: "fm", ratio: 1, index: 1.6, attack: 0.003, decay: 1, sustain: 0.35, release: 0.45, cutoff: 6000, resonance: 0.7, detune: 3, vibrato: 0, reverb: 0.3, level: 0.4 },
  pluck: { wave: "string", attack: 0.001, decay: 0.6, sustain: 0, release: 0.3, cutoff: 5000, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0.3, level: 0.55 },
  guitar: { wave: "string", attack: 0.001, decay: 2, sustain: 0, release: 0.5, cutoff: 4000, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0.25, level: 0.55 },
  bell: { wave: "fm", ratio: 3.5, index: 2.4, attack: 0.002, decay: 2, sustain: 0, release: 1, cutoff: 9000, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0.5, level: 0.32 },
  marimba: { wave: "fm", ratio: 4, index: 1.1, attack: 0.002, decay: 0.4, sustain: 0, release: 0.2, cutoff: 7000, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0.25, level: 0.5 },
  bass: { wave: "saw", attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.15, cutoff: 520, resonance: 1.1, detune: 0, vibrato: 0, reverb: 0, level: 0.5 },
  sub: { wave: "sine", attack: 0.005, decay: 0.2, sustain: 1, release: 0.2, cutoff: 400, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0, level: 0.6 },
  "808": { wave: "sine", drop: 12, attack: 0.002, decay: 1.6, sustain: 0.2, release: 0.4, cutoff: 900, resonance: 0.7, detune: 0, vibrato: 0, reverb: 0, level: 0.7 },
  lead: { wave: "square", attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25, cutoff: 3200, resonance: 1, detune: 5, vibrato: 0.15, reverb: 0.3, level: 0.2 },
  synth: { wave: "saw", attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.35, cutoff: 2400, resonance: 1.2, detune: 12, vibrato: 0, reverb: 0.35, level: 0.22 },
  arp: { wave: "saw", attack: 0.002, decay: 0.18, sustain: 0, release: 0.1, cutoff: 2200, resonance: 1.4, detune: 4, vibrato: 0, reverb: 0.4, level: 0.28 },
  brass: { wave: "saw", attack: 0.06, decay: 0.3, sustain: 0.85, release: 0.2, cutoff: 1800, resonance: 0.9, detune: 4, vibrato: 0.05, reverb: 0.35, level: 0.24 },
  organ: { wave: "organ", attack: 0.01, decay: 0.1, sustain: 1, release: 0.1, cutoff: 6000, resonance: 0.7, detune: 2, vibrato: 0.03, reverb: 0.3, level: 0.2 },
  choir: { wave: "saw", formant: true, attack: 0.45, decay: 0.5, sustain: 0.9, release: 1, cutoff: 3500, resonance: 0.7, detune: 8, vibrato: 0.07, reverb: 0.6, level: 0.3 },
  flute: { wave: "sine", breath: 0.08, attack: 0.08, decay: 0.2, sustain: 0.9, release: 0.25, cutoff: 5000, resonance: 0.7, detune: 0, vibrato: 0.1, reverb: 0.4, level: 0.35 },
};

export const INSTRUMENTS = Object.keys(PRESETS);
export const DRUMS = ["kick", "snare", "clap", "hat", "openhat", "rim", "tom", "shaker", "crash", "ride", "snap", "cowbell", "conga", "perc"] as const;

function lowpass(x: Float32Array, f0: number, q: number): void {
  const w = (2 * Math.PI * Math.min(f0, SR * 0.45)) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.max(0.3, q));
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
}

function band(x: Float32Array, f0: number, q: number): Float32Array {
  const out = new Float32Array(x.length);
  const w = (2 * Math.PI * Math.min(f0, SR * 0.45)) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

function highpass(x: Float32Array, f0: number): void {
  const k = Math.exp((-2 * Math.PI * f0) / SR);
  let prevX = 0, prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const y = k * (prevY + x[i] - prevX);
    prevX = x[i];
    prevY = y;
    x[i] = y;
  }
}

/** One note on a voice: `gate` seconds held, then its release. */
function renderVoice(v: Voice, midi: number, gate: number, vel: number, r: () => number): Float32Array {
  const n = Math.max(1, Math.round((gate + v.release) * SR));
  const out = new Float32Array(n);
  const f0 = mtof(midi);
  const oscs = v.detune && v.wave !== "string" && v.wave !== "noise" ? [-v.detune, v.detune] : [0];
  if (v.wave === "string") {
    // Karplus–Strong: a burst of seeded noise in a delay line that loses its highs each pass
    const len = Math.max(2, Math.round(SR / f0));
    const line = new Float32Array(len);
    for (let i = 0; i < len; i++) line[i] = r() * 2 - 1;
    // each pass loses a little: down to 1/e after `decay` seconds
    const keep = Math.exp(-1 / (f0 * Math.max(0.05, v.decay)));
    let p = 0;
    for (let i = 0; i < n; i++) {
      const a = line[p];
      const b = line[(p + 1) % len];
      line[p] = 0.5 * (a + b) * keep;
      out[i] = a;
      p = (p + 1) % len;
    }
  } else {
    for (const cents of oscs) {
      let ph = 0;
      let mph = 0;
      for (let i = 0; i < n; i++) {
        const s = i / SR;
        const vib = v.vibrato ? 2 ** ((v.vibrato * Math.sin(2 * Math.PI * 5.2 * s) * Math.min(1, s / 0.4)) / 12) : 1;
        const drop = v.drop ? 2 ** ((v.drop * Math.exp(-s / 0.05)) / 12) : 1;
        const f = f0 * 2 ** (cents / 1200) * vib * drop;
        ph += f / SR;
        const x = ph % 1;
        let y: number;
        switch (v.wave) {
          case "saw":
            y = 2 * x - 1;
            break;
          case "square":
            y = x < 0.5 ? 1 : -1;
            break;
          case "triangle":
            y = 4 * Math.abs(x - 0.5) - 1;
            break;
          case "fm": {
            mph += (f * (v.ratio ?? 2)) / SR;
            const idx = (v.index ?? 1.5) * Math.exp(-s / Math.max(0.05, v.decay * 0.6));
            y = Math.sin(2 * Math.PI * x + idx * Math.sin(2 * Math.PI * (mph % 1)));
            break;
          }
          case "piano":
            y = 0;
            for (let k = 1; k <= 6; k++) y += (Math.sin(2 * Math.PI * ((ph * k) % 1)) * Math.exp(-s * (0.4 + k * 0.55))) / k;
            break;
          case "organ":
            y = Math.sin(2 * Math.PI * x) + 0.5 * Math.sin(4 * Math.PI * x) + 0.3 * Math.sin(6 * Math.PI * x) + 0.18 * Math.sin(8 * Math.PI * x);
            y *= 0.55;
            break;
          case "noise":
            y = r() * 2 - 1;
            break;
          default:
            y = Math.sin(2 * Math.PI * x);
        }
        if (v.breath) y += (r() * 2 - 1) * v.breath;
        out[i] += y / oscs.length;
      }
    }
  }
  let shaped = out;
  if (v.formant) {
    // an "ah": three formant bands
    const a = band(out, 730, 6);
    const b = band(out, 1090, 7);
    const c = band(out, 2440, 8);
    shaped = new Float32Array(n);
    for (let i = 0; i < n; i++) shaped[i] = a[i] * 1.6 + b[i] * 1.1 + c[i] * 0.6;
  }
  lowpass(shaped, v.cutoff, v.resonance);
  // ADSR
  const a = Math.max(0.0005, v.attack);
  const gateN = gate * SR;
  for (let i = 0; i < n; i++) {
    const s = i / SR;
    let e: number;
    if (s < a) e = s / a;
    else e = v.sustain + (1 - v.sustain) * Math.exp(-(s - a) / Math.max(0.01, v.decay * 0.5));
    if (i > gateN) {
      const level = s < a ? gate / a : v.sustain + (1 - v.sustain) * Math.exp(-(gate - a) / Math.max(0.01, v.decay * 0.5));
      e = Math.min(e, level) * Math.exp(-((i - gateN) / SR) / Math.max(0.01, v.release / 4));
    }
    shaped[i] *= e * vel * v.level;
  }
  return shaped;
}

/** One drum hit. `tune` in semitones, `decay` stretches its length. */
function renderDrum(kind: string, tune: number, decay: number, vel: number, r: () => number): Float32Array {
  const k = 2 ** (tune / 12);
  const len = (sec: number) => Math.round(sec * decay * SR);
  const noise = (n: number) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
    return a;
  };
  const env = (x: Float32Array, tau: number) => {
    for (let i = 0; i < x.length; i++) x[i] *= Math.min(1, i / (SR * 0.001)) * Math.exp(-i / (SR * tau * decay));
    return x;
  };
  let out: Float32Array;
  switch (kind) {
    case "kick": {
      out = new Float32Array(len(0.45));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const s = i / SR;
        ph += ((48 + 110 * Math.exp(-s / 0.03)) * k) / SR;
        out[i] = Math.tanh(1.6 * Math.sin(2 * Math.PI * ph)) * Math.exp(-s / (0.16 * decay));
      }
      out[0] = 0;
      break;
    }
    case "snare":
    case "snap": {
      const n = len(kind === "snap" ? 0.12 : 0.25);
      const body = band(noise(n), 1900 * k, 0.8);
      out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const s = i / SR;
        out[i] = body[i] * 1.4 * Math.exp(-s / (0.07 * decay)) + (kind === "snare" ? 0.5 * Math.sin(2 * Math.PI * 190 * k * s) * Math.exp(-s / 0.05) : 0);
      }
      break;
    }
    case "clap": {
      const n = len(0.3);
      const src = band(noise(n), 1400 * k, 1.1);
      out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const s = i / SR;
        const bursts = [0, 0.011, 0.022].reduce((acc, at) => acc + (s >= at ? Math.exp(-(s - at) / 0.006) : 0), 0);
        out[i] = src[i] * (bursts * 0.8 + Math.exp(-s / (0.09 * decay))) * 1.3;
      }
      break;
    }
    case "hat":
    case "openhat":
    case "shaker":
    case "crash":
    case "ride": {
      const tau = { hat: 0.018, openhat: 0.16, shaker: 0.04, crash: 0.9, ride: 0.5 }[kind];
      out = noise(len(tau * 5));
      highpass(out, (kind === "shaker" ? 5000 : 7500) * k);
      env(out, tau);
      for (let i = 0; i < out.length; i++) out[i] *= kind === "crash" ? 0.5 : 0.7;
      break;
    }
    case "rim":
    case "cowbell":
    case "perc": {
      const f = { rim: 1700, cowbell: 560, perc: 880 }[kind] * k;
      out = new Float32Array(len(kind === "cowbell" ? 0.4 : 0.08));
      for (let i = 0; i < out.length; i++) {
        const s = i / SR;
        out[i] = (Math.sin(2 * Math.PI * f * s) + (kind === "cowbell" ? 0.6 * Math.sin(2 * Math.PI * f * 1.48 * s) : 0.3 * Math.sin(2 * Math.PI * f * 2.7 * s))) * Math.exp(-s / ((kind === "cowbell" ? 0.09 : 0.015) * decay)) * 0.6;
      }
      break;
    }
    default: {
      // tom, conga: a pitched skin that falls a little
      const base = (kind === "conga" ? 260 : 120) * k;
      out = new Float32Array(len(0.4));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const s = i / SR;
        ph += (base * (1 + 0.5 * Math.exp(-s / 0.02))) / SR;
        out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-s / ((kind === "conga" ? 0.08 : 0.18) * decay)) * 0.8;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] *= vel;
  return out;
}

// ── Reverb (a small Freeverb: 4 combs + 2 all-passes a side) ─────────────────────────────

function reverb(input: [Float32Array, Float32Array], size: number): [Float32Array, Float32Array] {
  const combs = [1116, 1188, 1277, 1356];
  const allpasses = [556, 441];
  const feedback = 0.74 + 0.2 * Math.min(1, size);
  const damp = 0.3;
  return input.map((x, ch) => {
    const spread = ch ? 23 : 0;
    const out = new Float32Array(x.length);
    for (const c of combs) {
      const len = Math.round(((c + spread) * SR) / 44100);
      const buf = new Float32Array(len);
      let p = 0;
      let low = 0;
      for (let i = 0; i < x.length; i++) {
        const y = buf[p];
        low = y * (1 - damp) + low * damp;
        buf[p] = x[i] * 0.015 + low * feedback;
        out[i] += y;
        p = (p + 1) % len;
      }
    }
    for (const a of allpasses) {
      const len = Math.round(((a + spread) * SR) / 44100);
      const buf = new Float32Array(len);
      let p = 0;
      for (let i = 0; i < out.length; i++) {
        const b = buf[p];
        const y = -out[i] + b;
        buf[p] = out[i] + b * 0.5;
        out[i] = y;
        p = (p + 1) % len;
      }
    }
    return out;
  }) as [Float32Array, Float32Array];
}

// ── The score ───────────────────────────────────────────────────────────────────────────

interface Event {
  beat: number;
  dur: number;
  notes: number[];
  vel: number;
}

/** A part's events over `beats`: its notes (or hits, or steps) repeated every `loop` beats. */
export function partEvents(part: ScorePart, beats: number, swing = 0): Event[] {
  const base: Event[] = [];
  if (part.steps) {
    // "x" a hit, "X" an accent, anything else a rest; one character per 16th, and the
    // pattern repeats at its own length (16 characters = one 4-beat bar)
    const steps = part.steps.replace(/\s|\|/g, "");
    const loop = part.loop ?? Math.max(0.25, steps.length / 4);
    for (let i = 0; i < steps.length; i++) if (steps[i] === "x" || steps[i] === "X") base.push({ beat: i / 4, dur: 0.25, notes: [], vel: steps[i] === "X" ? 1 : 0.75 });
    return repeat(base, loop, part, beats, swing);
  }
  for (const h of part.hits ?? []) base.push({ beat: h, dur: 0.25, notes: [], vel: 0.85 });
  for (const n of part.notes ?? []) {
    const notes = (Array.isArray(n.n) ? n.n : [n.n]).flatMap((x) => parseNote(x, part.octave ?? 0));
    if (notes.length || part.drum) base.push({ beat: n.t, dur: n.d ?? 1, notes, vel: n.v ?? 0.8 });
  }
  return repeat(base, part.loop, part, beats, swing);
}

function repeat(base: Event[], loop: number | undefined, part: ScorePart, beats: number, swing: number): Event[] {
  const from = part.from ?? 0;
  const to = Math.min(beats, part.to ?? beats);
  const out: Event[] = [];
  // no loop: the notes play once
  const span = loop && loop > 0 ? loop : 0;
  for (let k = 0; k === 0 || (span > 0 && from + k * span < to); k++) {
    for (const e of base) {
      let beat = from + k * span + e.beat;
      // swing pushes the off-beat 8ths late
      if (swing && Math.abs((e.beat * 2) % 2 - 1) < 1e-6) beat += swing * 0.5;
      if (beat >= from && beat < to) out.push({ ...e, beat });
    }
  }
  return out;
}

const KICKS = (parts: ScorePart[], beats: number, swing: number) =>
  parts.filter((p) => p.drum === "kick" || p.instrument === "808").flatMap((p) => partEvents(p, beats, swing).map((e) => e.beat));

export class ScoreTrack {
  private buffer: [Float32Array, Float32Array] | null = null;
  private beat: number;
  private seconds: number;

  constructor(private track: AudioTrack, seconds: number) {
    this.beat = 60 / Math.min(220, Math.max(40, track.tempo ?? 100));
    this.seconds = Math.max(0.5, seconds);
  }

  private render(): [Float32Array, Float32Array] {
    const total = Math.ceil((this.seconds + TAIL) * SR);
    const dry: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
    const send: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
    const drums: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
    const beats = this.seconds / this.beat;
    const swing = Math.min(0.5, Math.max(0, this.track.swing ?? 0));
    const parts = this.track.parts ?? [];
    parts.forEach((part, pi) => {
      const r = seeded(`score:${this.track.id}:${pi}`);
      const gain = 10 ** ((part.gain ?? 0) / 20);
      const pan = Math.max(-1, Math.min(1, part.pan ?? 0));
      const l = Math.sqrt(0.5 * (1 - pan)) * gain;
      const rr = Math.sqrt(0.5 * (1 + pan)) * gain;
      const preset = part.instrument ? PRESETS[part.instrument] ?? PRESETS.synth : null;
      const voice: Voice | null = preset
        ? {
            ...preset,
            ...(part.wave ? { wave: part.wave } : {}),
            ...(part.attack !== undefined ? { attack: part.attack } : {}),
            ...(part.decay !== undefined ? { decay: part.decay } : {}),
            ...(part.sustain !== undefined ? { sustain: part.sustain } : {}),
            ...(part.release !== undefined ? { release: part.release } : {}),
            ...(part.cutoff !== undefined ? { cutoff: part.cutoff } : {}),
            ...(part.resonance !== undefined ? { resonance: part.resonance } : {}),
            ...(part.detune !== undefined ? { detune: part.detune } : {}),
            ...(part.vibrato !== undefined ? { vibrato: part.vibrato } : {}),
          }
        : null;
      const wet = part.reverb ?? voice?.reverb ?? (part.drum ? 0.12 : 0.3);
      for (const e of partEvents(part, beats, swing)) {
        const at = Math.round(e.beat * this.beat * SR);
        const sigs = part.drum
          ? [renderDrum(part.drum, part.tune ?? 0, part.decay ?? 1, e.vel, r)]
          : voice
            ? e.notes.map((m) => renderVoice(voice, m, e.dur * this.beat, e.vel, r))
            : [];
        const bus = part.drum ? drums : dry;
        for (const sig of sigs) {
          for (let i = 0; i < sig.length && at + i < total; i++) {
            const v = sig[i];
            bus[0][at + i] += v * l;
            bus[1][at + i] += v * rr;
            if (wet > 0) {
              send[0][at + i] += v * l * wet;
              send[1][at + i] += v * rr * wet;
            }
          }
        }
      }
    });
    const room = reverb(send, this.track.reverb ?? 0.6);
    // chords and pads make room for the kick
    const kicks = this.track.sidechain === false ? [] : KICKS(parts, beats, swing);
    const span = Math.round(0.28 * SR);
    const duck = new Float32Array(total).fill(1);
    for (const k of kicks) {
      const i0 = Math.round(k * this.beat * SR);
      for (let i = 0; i < span && i0 + i < total; i++) duck[i0 + i] = Math.min(duck[i0 + i], 1 - 0.45 * Math.exp(-i / (0.07 * SR)));
    }
    const out: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < total; i++) out[ch][i] = (dry[ch][i] + room[ch][i] * 0.9) * duck[i] + drums[ch][i];
    return out;
  }

  /** `n` samples of the score starting `from` samples after it starts. */
  window(from: number, n: number): [Float32Array, Float32Array] {
    this.buffer ??= this.render();
    const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    for (let ch = 0; ch < 2; ch++) {
      const src = this.buffer[ch];
      for (let i = 0; i < n; i++) {
        const j = from + i;
        if (j >= 0 && j < src.length) out[ch][i] = src[j];
      }
    }
    return out;
  }
}

export type { ScoreNote, ScorePart };
