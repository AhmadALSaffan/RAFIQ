/**
 * The soundtrack, mixed on the scene's own clock (sample-accurate, so a whoosh lands on the
 * frame it belongs to): procedural music and effects synthesised here, the user's files and
 * voice-overs decoded, the audio of video layers, ducking, then loudness to −14 LUFS
 * (ITU-R BS.1770 with gating) and a limiter that keeps peaks under −1 dB.
 *
 * Everything is deterministic: the noise comes from a seeded generator, so the same scene
 * gives the same samples on every export.
 */

import { t } from "../../../i18n";
import type { Issue } from "./lint";
import type { AudioTrack, Layer, Scene } from "./types";

export const SAMPLE_RATE = 48000;

export type Stereo = [Float32Array, Float32Array];

// ── Small DSP kit ───────────────────────────────────────────────────────────────────────

function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

/** RBJ biquad, in place. */
function biquad(x: Float32Array, type: "low" | "high" | "band" | "shelf", f0: number, q = 0.707, gainDb = 0): Float32Array {
  const w = (2 * Math.PI * Math.min(f0, SAMPLE_RATE * 0.45)) / SAMPLE_RATE;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === "low") {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === "high") {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === "band") {
    b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    const A = 10 ** (gainDb / 40);
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
    a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
}

const note = (m: number) => 440 * 2 ** ((m - 69) / 12);

function env(n: number, attack: number, decay: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / SAMPLE_RATE;
    out[i] = Math.min(1, s / Math.max(attack, 1e-4)) * Math.exp(-s / decay);
  }
  return out;
}

function place(buf: Stereo, start: number, sig: Float32Array, gain = 1, pan = 0) {
  const i0 = Math.round(start * SAMPLE_RATE);
  const l = Math.sqrt(0.5 * (1 - pan)) * gain;
  const r = Math.sqrt(0.5 * (1 + pan)) * gain;
  for (let i = 0; i < sig.length; i++) {
    const j = i0 + i;
    if (j < 0) continue;
    if (j >= buf[0].length) break;
    buf[0][j] += sig[i] * l;
    buf[1][j] += sig[i] * r;
  }
}

function noise(n: number, r: () => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gaussian(r) * 0.5;
  return out;
}

// ── Effects ─────────────────────────────────────────────────────────────────────────────

const SFX: Record<string, (r: () => number) => Float32Array> = {
  pop: () => {
    const n = Math.round(0.12 * SAMPLE_RATE);
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const s = i / SAMPLE_RATE;
      ph += (2 * Math.PI * (520 + 520 * Math.exp(-s / 0.02))) / SAMPLE_RATE;
      out[i] = Math.sin(ph) * Math.min(1, s / 0.002) * Math.exp(-s / 0.035);
    }
    return out;
  },
  click: (r) => {
    const n = Math.round(0.03 * SAMPLE_RATE);
    const out = biquad(noise(n, r), "high", 3000);
    const e = env(n, 0.0003, 0.004);
    for (let i = 0; i < n; i++) out[i] = out[i] * e[i] + 0.4 * Math.sin((2 * Math.PI * 2200 * i) / SAMPLE_RATE) * e[i];
    return out;
  },
  tick: (r) => {
    const n = Math.round(0.03 * SAMPLE_RATE);
    const out = biquad(noise(n, r), "band", 3500, 1.2);
    const e = env(n, 0.0005, 0.006);
    for (let i = 0; i < n; i++) out[i] *= e[i] * 1.5;
    return out;
  },
  whoosh: (r) => sweep(0.45, 500, 6, r),
  swoosh: (r) => sweep(0.3, 900, 5, r),
  riser: (r) => {
    const n = Math.round(1.2 * SAMPLE_RATE);
    const src = noise(n, r);
    const out = new Float32Array(n);
    const chunks = 30;
    for (let c = 0; c < chunks; c++) {
      const a = Math.floor((c * n) / chunks);
      const b = Math.floor(((c + 1) * n) / chunks);
      const part = biquad(src.slice(0, b), "low", 300 + 9000 * (c / chunks) ** 2);
      for (let i = a; i < b; i++) out[i] = part[i] * (i / n) ** 2;
    }
    return out;
  },
  impact: (r) => {
    const n = Math.round(1.2 * SAMPLE_RATE);
    const out = new Float32Array(n);
    const nz = biquad(noise(n, r), "low", 1200);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const s = i / SAMPLE_RATE;
      ph += (2 * Math.PI * (42 + 70 * Math.exp(-s / 0.06))) / SAMPLE_RATE;
      out[i] = Math.sin(ph) * Math.min(1, s / 0.002) * Math.exp(-s / 0.45) + nz[i] * Math.exp(-s / 0.08) * 0.5;
    }
    return out;
  },
  ding: () => {
    const n = Math.round(1.2 * SAMPLE_RATE);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i / SAMPLE_RATE;
      const base = 1318.5;
      out[i] =
        (Math.sin(2 * Math.PI * base * s) * Math.exp(-s / 0.45) +
          0.45 * Math.sin(2 * Math.PI * base * 2 * s) * Math.exp(-s / 0.25) +
          0.2 * Math.sin(2 * Math.PI * base * 3.01 * s) * Math.exp(-s / 0.12)) *
        Math.min(1, s / 0.003) * 0.6;
    }
    return out;
  },
  typing: (r) => {
    const n = Math.round(1.0 * SAMPLE_RATE);
    const out = new Float32Array(n);
    for (let k = 0; k < 12; k++) {
      const tick = SFX.tick(r);
      const at = Math.round((k / 12 + (r() - 0.5) * 0.02) * SAMPLE_RATE);
      for (let i = 0; i < tick.length && at + i < n; i++) if (at + i >= 0) out[at + i] += tick[i] * (0.6 + 0.4 * r());
    }
    return out;
  },
};

function sweep(dur: number, base: number, span: number, r: () => number): Float32Array {
  const n = Math.round(dur * SAMPLE_RATE);
  const src = noise(n, r);
  const out = new Float32Array(n);
  const chunks = 24;
  for (let c = 0; c < chunks; c++) {
    const a = Math.floor((c * n) / chunks);
    const b = Math.floor(((c + 1) * n) / chunks);
    const centre = base * span ** (c / chunks);
    const part = biquad(src.slice(0, b), "band", centre, 0.9);
    for (let i = a; i < b; i++) out[i] = part[i] * Math.sin((Math.PI * i) / n) ** 1.6 * 1.6;
  }
  return out;
}

// ── Music ───────────────────────────────────────────────────────────────────────────────

interface Pattern {
  tempo: number;
  minor: boolean;
  pad: "saw" | "organ" | "strings";
  kick: number[]; // beats in the bar (0..3.75)
  snare: number[];
  hats: number; // per beat
  arp: boolean;
  pluck: boolean;
  bars?: number;
}

const PATTERNS: Record<string, Pattern> = {
  "warm-lofi": { tempo: 90, minor: false, pad: "organ", kick: [0, 2.5], snare: [1, 3], hats: 2, arp: false, pluck: true },
  upbeat: { tempo: 120, minor: false, pad: "saw", kick: [0, 1, 2, 3], snare: [1, 3], hats: 4, arp: true, pluck: false },
  cinematic: { tempo: 80, minor: true, pad: "strings", kick: [0], snare: [], hats: 0, arp: false, pluck: false },
  minimal: { tempo: 100, minor: true, pad: "organ", kick: [0, 2], snare: [], hats: 2, arp: false, pluck: true },
  corporate: { tempo: 110, minor: false, pad: "saw", kick: [0, 2], snare: [1, 3], hats: 2, arp: false, pluck: true },
};

const KEYS: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

function chordsFor(key: string | undefined, minor: boolean): { root: number; tones: number[] }[] {
  const m = /^([A-G](?:#|b)?)(m)?$/.exec(key ?? "") ?? null;
  const isMinor = m ? !!m[2] : minor;
  const tonic = 48 + (m ? KEYS[m[1]] : isMinor ? 9 : 0); // default C major / A minor
  const triad = (deg: number, minorChord: boolean) => {
    const r = tonic + deg;
    return { root: r - 12, tones: [r, r + (minorChord ? 3 : 4), r + 7, r + 12] };
  };
  // major: I – V – vi – IV · minor: i – VI – III – VII
  return isMinor
    ? [triad(0, true), triad(8, false), triad(3, false), triad(10, false)]
    : [triad(0, false), triad(7, false), triad(9, true), triad(5, false)];
}

/**
 * Procedural music, rendered a bar at a time so any stretch of a long video can be asked for
 * without the whole track in memory. Each bar has its own seeded noise, so the same bar
 * always sounds the same, whichever window asks for it.
 */
class MusicTrack {
  private pat: Pattern;
  private beat: number;
  private bar: number;
  private chords: { root: number; tones: number[] }[];
  private cache = new Map<number, Float32Array[]>();
  private static TAIL = 1.0; // the longest sound a bar starts (bass 0.9 s) rings past its end

  constructor(private track: AudioTrack) {
    this.pat = PATTERNS[track.pattern ?? "warm-lofi"] ?? PATTERNS["warm-lofi"];
    this.beat = 60 / (track.tempo ?? this.pat.tempo);
    this.bar = this.beat * 4;
    this.chords = chordsFor(track.key, this.pat.minor);
  }

  /** Bar `b` alone, from its first beat to the end of its tail (bar-relative time). */
  private renderBar(b: number): Stereo {
    const { pat, beat, bar } = this;
    const out: Stereo = [new Float32Array(Math.ceil((bar + MusicTrack.TAIL) * SAMPLE_RATE)), new Float32Array(Math.ceil((bar + MusicTrack.TAIL) * SAMPLE_RATE))];
    const { root, tones } = this.chords[b % 4];
    const r = rng(`music:${this.track.id}:${b}`);
    const len = Math.round((bar + 0.4) * SAMPLE_RATE);
    // pad
    const pad = new Float32Array(len);
    for (const m of tones) {
      const f = note(m);
      for (let i = 0; i < len; i++) {
        const s = i / SAMPLE_RATE;
        if (pat.pad === "saw") pad[i] += ((((s * f * 1.003) % 1) * 2 - 1) + (((s * f * 0.997) % 1) * 2 - 1)) * 0.5;
        else if (pat.pad === "strings") pad[i] += Math.sin(2 * Math.PI * f * s + 0.3 * Math.sin(2 * Math.PI * 5 * s)) + 0.3 * Math.sin(4 * Math.PI * f * s);
        else pad[i] += Math.sin(2 * Math.PI * f * s) + 0.35 * Math.sin(4 * Math.PI * f * s) + 0.15 * Math.sin(6 * Math.PI * f * s);
      }
    }
    biquad(pad, "low", pat.pad === "saw" ? 1400 : 2200);
    for (let i = 0; i < len; i++) {
      const s = i / SAMPLE_RATE;
      pad[i] *= Math.min(1, s / 0.35) * Math.min(1, (len - i) / (0.4 * SAMPLE_RATE)) * 0.045;
    }
    place(out, 0, pad, 1, -0.2);
    place(out, 0.006, pad, 1, 0.2);
    // bass
    if (b >= 1) {
      for (const at of pat.kick.length ? [0, 2] : [0]) {
        const bn = Math.round(0.9 * SAMPLE_RATE);
        const sig = new Float32Array(bn);
        const e = env(bn, 0.005, 0.32);
        for (let i = 0; i < bn; i++) sig[i] = Math.tanh(2 * Math.sin((2 * Math.PI * note(root) * i) / SAMPLE_RATE)) * e[i];
        place(out, at * beat, biquad(sig, "low", 500), 0.28);
      }
    }
    // pluck / arp
    if ((pat.pluck || pat.arp) && b >= 2) {
      const steps = pat.arp ? 8 : 6;
      const seq = [...tones, ...[...tones].reverse().slice(1, -1)];
      for (let k = 0; k < steps; k++) {
        const at = pat.arp ? (k * beat) / 2 : [0, 0.75, 1, 1.5, 2.25, 2.5][k] * beat;
        const m = seq[k % seq.length] + 12;
        const an = Math.round(0.5 * SAMPLE_RATE);
        const f = note(m);
        const sig = new Float32Array(an);
        for (let i = 0; i < an; i++) {
          const s = i / SAMPLE_RATE;
          sig[i] = Math.sin(2 * Math.PI * f * s + 1.6 * Math.exp(-s / 0.08) * Math.sin(2 * Math.PI * 3.5 * f * s)) * Math.min(1, s / 0.002) * Math.exp(-s / (pat.arp ? 0.12 : 0.22));
        }
        place(out, at, sig, 0.055, k % 2 ? 0.35 : -0.35);
      }
    }
    // drums
    if (b >= 1) {
      for (const k of pat.kick) {
        const kn = Math.round(0.35 * SAMPLE_RATE);
        const sig = new Float32Array(kn);
        let ph = 0;
        for (let i = 0; i < kn; i++) {
          const s = i / SAMPLE_RATE;
          ph += (2 * Math.PI * (48 + 90 * Math.exp(-s / 0.035))) / SAMPLE_RATE;
          sig[i] = Math.sin(ph) * Math.min(1, s / 0.001) * Math.exp(-s / 0.12);
        }
        place(out, k * beat, sig, pat.pad === "strings" ? 0.7 : 0.5);
      }
      for (const k of pat.snare) {
        const sn = Math.round(0.22 * SAMPLE_RATE);
        const sig = biquad(noise(sn, r), "band", 1800, 0.8);
        const e = env(sn, 0.001, 0.06);
        for (let i = 0; i < sn; i++) sig[i] *= e[i];
        place(out, k * beat, sig, 0.16, -0.1);
      }
      if (b >= 2) {
        for (let k = 0; k < 4 * pat.hats; k++) {
          const hn = Math.round(0.05 * SAMPLE_RATE);
          const sig = biquad(noise(hn, r), "high", 7000);
          const e = env(hn, 0.0005, 0.015);
          for (let i = 0; i < hn; i++) sig[i] *= e[i];
          place(out, (k * beat) / pat.hats, sig, k % 2 ? 0.05 : 0.08, 0.3);
        }
      }
    }
    return out;
  }

  /** `n` samples of the music starting `from` samples after it starts. */
  window(from: number, n: number): Stereo {
    const out: Stereo = [new Float32Array(n), new Float32Array(n)];
    const barLen = this.bar * SAMPLE_RATE;
    const first = Math.max(0, Math.floor((from - MusicTrack.TAIL * SAMPLE_RATE) / barLen));
    const last = Math.floor((from + n) / barLen);
    for (const b of [...this.cache.keys()]) if (b < first) this.cache.delete(b);
    for (let b = first; b <= last; b++) {
      let rendered = this.cache.get(b) as Stereo | undefined;
      if (!rendered) {
        rendered = this.renderBar(b);
        this.cache.set(b, rendered);
      }
      const offset = Math.round(b * barLen) - from;
      for (let i = Math.max(0, -offset); i < rendered[0].length && offset + i < n; i++) {
        out[0][offset + i] += rendered[0][i];
        out[1][offset + i] += rendered[1][i];
      }
    }
    // pads and plucks breathe under the kick
    if (this.pat.kick.length) {
      const span = Math.round(0.3 * SAMPLE_RATE);
      const firstKickBar = Math.max(1, Math.floor((from - span) / barLen));
      for (let b = firstKickBar; b <= last; b++) {
        for (const k of this.pat.kick) {
          const i0 = Math.round((b * this.bar + k * this.beat) * SAMPLE_RATE) - from;
          for (let i = Math.max(0, -i0); i < span && i0 + i < n; i++) {
            const g = 1 - 0.35 * Math.exp(-i / (0.08 * SAMPLE_RATE));
            out[0][i0 + i] *= g;
            out[1][i0 + i] *= g;
          }
        }
      }
    }
    return out;
  }
}

// ── Loudness (ITU-R BS.1770-4) ──────────────────────────────────────────────────────────

/** Integrated loudness in LUFS, with the absolute (−70) and relative (−10 LU) gates. */
export function integratedLoudness(ch: Stereo): number {
  const k = ch.map((c) => {
    const x = Float32Array.from(c);
    biquad(x, "shelf", 1681.97, 0.7072, 3.99984);
    biquad(x, "high", 38.13, 0.5003);
    return x;
  });
  const block = Math.round(0.4 * SAMPLE_RATE);
  const hop = Math.round(0.1 * SAMPLE_RATE);
  const powers: number[] = [];
  for (let s = 0; s + block <= k[0].length; s += hop) {
    let sum = 0;
    for (const c of k) for (let i = s; i < s + block; i++) sum += c[i] * c[i];
    powers.push(sum / block);
  }
  if (!powers.length) return -70;
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p + 1e-12);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -70;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => lufs(p) > lufs(mean) - 10);
  const gated = rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length);
  return lufs(gated);
}

/** Peak with 4× linear oversampling — close to a true peak for program material. */
export function truePeakDb(ch: Stereo): number {
  let peak = 0;
  for (const c of ch) {
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1];
      const b = c[i];
      for (let k = 0; k < 4; k++) peak = Math.max(peak, Math.abs(a + ((b - a) * k) / 4));
    }
  }
  return 20 * Math.log10(peak + 1e-12);
}

// ── Reading sources a window at a time ─────────────────────────────────────────────────

/** Audio from a file, asked for in windows: `n` samples at 48 kHz from source time `t`
 * (seconds), played `speed` times faster. Silence outside the file. */
export interface AudioReader {
  /** Seconds of audio in the source. */
  duration: number;
  read(t: number, n: number, speed?: number): Promise<Stereo>;
  close(): void;
}

/** A source decoded whole — fine for short files. */
export class BufferReader implements AudioReader {
  duration: number;
  constructor(private buffer: AudioBuffer) {
    this.duration = buffer.duration;
  }

  async read(t: number, n: number, speed = 1): Promise<Stereo> {
    const b = this.buffer;
    const left = b.getChannelData(0);
    const right = b.numberOfChannels > 1 ? b.getChannelData(1) : left;
    const ratio = (b.sampleRate * speed) / SAMPLE_RATE;
    const offset = t * b.sampleRate;
    const out: Stereo = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const pos = offset + i * ratio;
      const a = Math.floor(pos);
      if (a < 0 || a >= b.length) continue;
      const f = pos - a;
      out[0][i] = left[a] * (1 - f) + (left[a + 1] ?? left[a]) * f;
      out[1][i] = right[a] * (1 - f) + (right[a + 1] ?? right[a]) * f;
    }
    return out;
  }

  close() {}
}

interface Decoded {
  buffer: AudioBuffer;
  timestamp: number;
}

/**
 * A source decoded as it's read (mediabunny), keeping only the stretch around the read head —
 * a twenty-minute file costs a few seconds of samples, not hundreds of megabytes. Reads are
 * expected in order (the mixer goes front to back); a jump backwards or far ahead reopens the
 * decoder there.
 */
export class StreamReader implements AudioReader {
  private iterator: AsyncGenerator<Decoded, void, unknown> | null = null;
  private chunks: Decoded[] = [];
  private ended = false;
  private rate = 48000;

  constructor(
    private open: (from: number) => AsyncGenerator<Decoded, void, unknown>,
    public duration: number,
    private onClose?: () => void,
  ) {}

  private restart(from: number) {
    void this.iterator?.return(undefined);
    this.iterator = this.open(Math.max(0, from - 0.05));
    this.chunks = [];
    this.ended = false;
  }

  private end(): number {
    const last = this.chunks[this.chunks.length - 1];
    return last ? last.timestamp + last.buffer.duration : -Infinity;
  }

  async read(t: number, n: number, speed = 1): Promise<Stereo> {
    const out: Stereo = [new Float32Array(n), new Float32Array(n)];
    const until = t + (n * speed) / SAMPLE_RATE + 0.01;
    if (t >= this.duration || until <= 0) return out;
    const start = this.chunks[0]?.timestamp ?? Infinity;
    if (!this.iterator || t < start - 1e-3 || t > this.end() + 2) this.restart(t);
    while (!this.ended && this.end() < until) {
      const next = await this.iterator!.next();
      if (next.done) this.ended = true;
      else {
        this.chunks.push(next.value);
        this.rate = next.value.buffer.sampleRate;
      }
    }
    // forget what's behind the read head
    while (this.chunks.length > 1 && this.chunks[1].timestamp <= t) this.chunks.shift();
    let c = 0;
    for (let i = 0; i < n; i++) {
      const time = t + (i * speed) / SAMPLE_RATE;
      if (time < 0) continue;
      while (c < this.chunks.length - 1 && time >= this.chunks[c + 1].timestamp) c++;
      const chunk = this.chunks[c];
      if (!chunk) break;
      const pos = (time - chunk.timestamp) * this.rate;
      const a = Math.floor(pos);
      const b = chunk.buffer;
      if (a < 0 || a >= b.length) continue;
      const f = pos - a;
      const l = b.getChannelData(0);
      const r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
      const nextL = a + 1 < b.length ? l[a + 1] : (this.chunks[c + 1]?.buffer.getChannelData(0)[0] ?? l[a]);
      const nextR = a + 1 < b.length ? r[a + 1] : (this.chunks[c + 1]?.buffer.getChannelData(Math.min(1, (this.chunks[c + 1]?.buffer.numberOfChannels ?? 1) - 1))[0] ?? r[a]);
      out[0][i] = l[a] * (1 - f) + nextL * f;
      out[1][i] = r[a] * (1 - f) + nextR * f;
    }
    return out;
  }

  close() {
    void this.iterator?.return(undefined);
    this.iterator = null;
    this.chunks = [];
    this.onClose?.();
  }
}

// ── The mix ─────────────────────────────────────────────────────────────────────────────

export interface MixInput {
  scene: Scene;
  /** A reader for an asset id (voice-overs, music files, videos' sound); null = can't read it. */
  open: (assetId: string) => Promise<AudioReader | null>;
}

export interface MixResult {
  channels: Stereo;
  lufsBefore: number;
  peakBeforeDb: number;
  lufs: number;
  peakDb: number;
  issues: Issue[];
}

export interface MixReport {
  lufsBefore: number;
  peakBeforeDb: number;
  issues: Issue[];
}

function dbToGain(db: number | undefined): number {
  return 10 ** ((db ?? 0) / 20);
}

function videoLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  const walk = (list: Layer[]) => list.forEach((l) => (l.type === "video" ? out.push(l) : l.children && walk(l.children)));
  walk(layers);
  return out;
}

/** A biquad that keeps its state between calls, for filtering a stream in pieces. */
class StreamBiquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private c: number[];
  constructor(type: "high" | "shelf", f0: number, q: number, gainDb = 0) {
    const w = (2 * Math.PI * f0) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const sin = Math.sin(w);
    const alpha = sin / (2 * q);
    if (type === "high") {
      this.c = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
    } else {
      const A = 10 ** (gainDb / 40);
      const s = 2 * Math.sqrt(A) * alpha;
      this.c = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s), A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
    }
  }
  run(x: Float32Array): Float32Array {
    const [b0, b1, b2, a0, a1, a2] = this.c;
    const out = new Float32Array(x.length);
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i];
      const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      out[i] = y0;
    }
    Object.assign(this, { x1, x2, y1, y2 });
    return out;
  }
}

/** BS.1770 integrated loudness over a stream: K-weighting with state, 100 ms sub-blocks,
 * 400 ms blocks at 75 % overlap, both gates — the same number integratedLoudness gives. */
class LoudnessMeter {
  private filters = [0, 1].map(() => [new StreamBiquad("shelf", 1681.97, 0.7072, 3.99984), new StreamBiquad("high", 38.13, 0.5003)]);
  private hop = Math.round(0.1 * SAMPLE_RATE);
  private acc = 0;
  private filled = 0;
  private subs: number[] = [];
  private peak = 0;
  private last = [0, 0];

  add(ch: Stereo) {
    const k = ch.map((c, i) => this.filters[i][1].run(this.filters[i][0].run(c)));
    for (let i = 0; i < k[0].length; i++) {
      this.acc += k[0][i] * k[0][i] + k[1][i] * k[1][i];
      if (++this.filled === this.hop) {
        this.subs.push(this.acc);
        this.acc = 0;
        this.filled = 0;
      }
    }
    // the same 4× linear oversampled peak as truePeakDb
    ch.forEach((c, n) => {
      let a = this.last[n];
      for (let i = 0; i < c.length; i++) {
        const b = c[i];
        for (let s = 0; s < 4; s++) this.peak = Math.max(this.peak, Math.abs(a + ((b - a) * s) / 4));
        a = b;
      }
      this.last[n] = a;
    });
  }

  lufs(): number {
    const block = this.hop * 4;
    const powers: number[] = [];
    for (let s = 0; s + 4 <= this.subs.length; s++) powers.push((this.subs[s] + this.subs[s + 1] + this.subs[s + 2] + this.subs[s + 3]) / block);
    if (!powers.length) return -70;
    const lufs = (p: number) => -0.691 + 10 * Math.log10(p + 1e-12);
    const abs = powers.filter((p) => lufs(p) > -70);
    if (!abs.length) return -70;
    const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
    const rel = abs.filter((p) => lufs(p) > lufs(mean) - 10);
    return lufs(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
  }

  peakDb(): number {
    return 20 * Math.log10(this.peak + 1e-12);
  }
}

/** The look-ahead limiter on a stream: the output trails the input by the look-ahead (5 ms),
 * so the gain is already down when a peak arrives, whichever window it falls in. */
class StreamLimiter {
  private ceiling: number;
  private look = Math.round(0.005 * SAMPLE_RATE);
  private release = Math.exp(-1 / (0.08 * SAMPLE_RATE));
  private g = 1;
  private carry: Stereo = [new Float32Array(0), new Float32Array(0)];
  constructor(ceilingDb: number) {
    this.ceiling = 10 ** (ceilingDb / 20);
  }

  /** Feeds samples in; returns those that are ready (all of them when `last`). */
  process(ch: Stereo, last = false): Stereo {
    const n = this.carry[0].length + ch[0].length;
    const x: Stereo = [new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 2; c++) {
      x[c].set(this.carry[c]);
      x[c].set(ch[c], this.carry[c].length);
    }
    const ready = last ? n : Math.max(0, n - this.look);
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = Math.max(Math.abs(x[0][i]), Math.abs(x[1][i]));
      need[i] = p > this.ceiling ? this.ceiling / p : 1;
    }
    const queue = new Int32Array(n + 1);
    let head = 0;
    let tail = 0;
    let next = 0;
    let g = this.g;
    for (let i = 0; i < ready; i++) {
      const until = Math.min(n, i + this.look);
      while (next < until) {
        while (tail > head && need[queue[tail - 1]] >= need[next]) tail--;
        queue[tail++] = next++;
      }
      while (queue[head] < i) head++;
      const target = need[queue[head]];
      g = target < g ? target : target + (g - target) * this.release;
      x[0][i] *= g;
      x[1][i] *= g;
    }
    this.g = g;
    this.carry = [x[0].slice(ready), x[1].slice(ready)];
    return [x[0].subarray(0, ready), x[1].subarray(0, ready)];
  }
}

/**
 * The soundtrack as a stream. measure() runs through it once for the loudness and the
 * checks; chunks() then gives it normalised to −14 LUFS and limited, a window at a time.
 * Memory is a few windows whatever the length; both passes give the same samples, because
 * every source is deterministic.
 */
export class MixStream {
  readonly length: number;
  private readers = new Map<string, AudioReader | null>();
  private music = new Map<string, MusicTrack>();
  private sfx = new Map<string, Float32Array>();
  private follow = new Map<string, number>();
  private gain = 1;
  report: MixReport | null = null;

  constructor(private input: MixInput) {
    this.length = Math.ceil(input.scene.composition.duration * SAMPLE_RATE);
  }

  private assetId(key: string): string {
    return this.input.scene.assets?.[key]?.src.replace("asset://", "") ?? key;
  }

  private async reader(key: string): Promise<AudioReader | null> {
    const id = this.assetId(key);
    if (!this.readers.has(id)) this.readers.set(id, await this.input.open(id).catch(() => null));
    return this.readers.get(id) ?? null;
  }

  /** One track's sound for samples [i0, i0 + n) of the scene, or null when it's silent there. */
  private async track(track: AudioTrack, i0: number, n: number): Promise<Stereo | null> {
    const duration = this.input.scene.composition.duration;
    const at = Math.round((track.at ?? 0) * SAMPLE_RATE);
    const end = Math.min(this.length, track.end !== undefined ? Math.round(track.end * SAMPLE_RATE) : this.length);
    const gain = dbToGain(track.gain);
    const pan = track.pan ?? 0;
    if (track.source === "sfx" && track.kind) {
      let sig = this.sfx.get(track.id);
      if (!sig) {
        sig = SFX[track.kind]?.(rng(`sfx:${track.id}`));
        if (!sig) return null;
        this.sfx.set(track.id, sig);
      }
      if (at + sig.length <= i0 || at >= i0 + n) return null;
      const out: Stereo = [new Float32Array(n), new Float32Array(n)];
      place(out, (at - i0) / SAMPLE_RATE, sig, gain * 0.7, pan);
      return out;
    }
    const from = Math.max(i0, at);
    const to = Math.min(i0 + n, end);
    if (to <= from) return null;
    let src: Stereo;
    let length: number; // the sound's own length, for the fade-out
    let fadeOut = track.fadeOut ?? 0;
    if (track.source === "procedural") {
      let m = this.music.get(track.id);
      if (!m) this.music.set(track.id, (m = new MusicTrack(track)));
      src = m.window(from - at, to - from);
      length = Math.min(this.length, Math.round(((track.end ?? duration) - (track.at ?? 0)) * SAMPLE_RATE));
      fadeOut = track.fadeOut ?? 1.2;
    } else if ((track.source === "asset" || track.source === "tts") && track.asset) {
      const reader = await this.reader(track.asset);
      if (!reader) return null;
      const skip = track.in ?? 0;
      const own = Math.max(0, Math.round((reader.duration - skip) * SAMPLE_RATE));
      if (track.loop && own > 0) {
        src = [new Float32Array(to - from), new Float32Array(to - from)];
        let i = 0;
        while (i < to - from) {
          const pos = (from - at + i) % own;
          const take = Math.min(to - from - i, own - pos);
          const part = await reader.read(skip + pos / SAMPLE_RATE, take);
          src[0].set(part[0], i);
          src[1].set(part[1], i);
          i += take;
        }
        length = Math.round(((track.end ?? duration) - (track.at ?? 0)) * SAMPLE_RATE);
      } else {
        if (from - at >= own) return null;
        src = await reader.read(skip + (from - at) / SAMPLE_RATE, to - from);
        length = own;
      }
      length = Math.min(length, this.length);
    } else {
      return null;
    }
    const out: Stereo = [new Float32Array(n), new Float32Array(n)];
    const l = gain * Math.min(1, 1 - pan);
    const r = gain * Math.min(1, 1 + pan);
    const fi = Math.round((track.fadeIn ?? 0) * SAMPLE_RATE);
    const fo = Math.round(fadeOut * SAMPLE_RATE);
    for (let j = from; j < to; j++) {
      const k = j - at; // position in the sound
      let g = 1;
      if (fi && k < fi) g *= k / fi;
      if (fo && k > length - fo) g *= Math.max(0, (length - k) / fo);
      out[0][j - i0] = src[0][j - from] * l * g;
      out[1][j - i0] = src[1][j - from] * r * g;
    }
    return out;
  }

  private async videoSound(layer: Layer, i0: number, n: number): Promise<Stereo | null> {
    if ((layer.volume ?? 1) <= 0 || !layer.asset) return null;
    const start = Math.round(layer.start * SAMPLE_RATE);
    const from = Math.max(i0, start);
    const to = Math.min(i0 + n, Math.round(layer.end * SAMPLE_RATE), this.length);
    if (to <= from) return null;
    const reader = await this.reader(layer.asset);
    if (!reader) return null;
    const speed = layer.speed ?? 1;
    const src = await reader.read((layer.in ?? 0) + ((from - start) / SAMPLE_RATE) * speed, to - from, speed);
    const out: Stereo = [new Float32Array(n), new Float32Array(n)];
    const v = layer.volume ?? 1;
    for (let j = from; j < to; j++) {
      out[0][j - i0] = src[0][j - from] * v;
      out[1][j - i0] = src[1][j - from] * v;
    }
    return out;
  }

  /** Samples [i0, i0 + n) of the mix, before loudness and limiting. */
  private async window(i0: number, n: number): Promise<Stereo> {
    const tracks = this.input.scene.audio ?? [];
    const parts = new Map<string, Stereo>();
    for (const track of tracks) {
      const s = await this.track(track, i0, n);
      if (s) parts.set(track.id, s);
    }
    for (const layer of videoLayers(this.input.scene.layers)) {
      const s = await this.videoSound(layer, i0, n);
      if (s) parts.set(`video:${layer.id}`, s);
    }
    // Ducking: a track with `duck` pushes the named one down by ~10 dB while it sounds. The
    // follower runs on even while the voice is silent, so it lets go the same way it would
    // over the whole track.
    const up = Math.exp(-1 / (0.02 * SAMPLE_RATE));
    const down = Math.exp(-1 / (0.4 * SAMPLE_RATE));
    for (const track of tracks) {
      if (!track.duck) continue;
      const voice = parts.get(track.id);
      const target = parts.get(track.duck);
      let e = this.follow.get(track.id) ?? 0;
      for (let i = 0; i < n; i++) {
        const x = voice ? Math.max(Math.abs(voice[0][i]), Math.abs(voice[1][i])) : 0;
        e = x > e ? x + (e - x) * up : x + (e - x) * down;
        if (target) {
          const g = 1 - 0.68 * Math.min(1, e / 0.05);
          target[0][i] *= g;
          target[1][i] *= g;
        }
      }
      this.follow.set(track.id, e);
    }
    const mix: Stereo = [new Float32Array(n), new Float32Array(n)];
    for (const s of parts.values()) {
      for (let i = 0; i < n; i++) {
        mix[0][i] += s[0][i];
        mix[1][i] += s[1][i];
      }
    }
    return mix;
  }

  /** Pass one: the loudness, the peak and the sound checks. */
  async measure(onProgress?: (fraction: number) => void): Promise<MixReport> {
    const step = 10 * SAMPLE_RATE;
    const meter = new LoudnessMeter();
    this.follow.clear();
    for (let i0 = 0; i0 < this.length; i0 += step) {
      meter.add(await this.window(i0, Math.min(step, this.length - i0)));
      onProgress?.(Math.min(1, (i0 + step) / this.length));
    }
    const lufsBefore = meter.lufs();
    const peakBeforeDb = meter.peakDb();
    const issues: Issue[] = [];
    const tracks = this.input.scene.audio ?? [];
    // A003: loud music under a voice with no duck
    const voices = tracks.filter((tr) => tr.source === "tts" || (tr.source === "asset" && /^vo|voice/i.test(tr.id)));
    for (const music of tracks.filter((tr) => tr.source === "procedural" || /music/i.test(tr.id))) {
      for (const voice of voices) {
        if (voice.duck === music.id) continue;
        if ((music.gain ?? 0) > (voice.gain ?? 0) - 10) {
          issues.push({ code: "A003", severity: "warning", blocking: false, layer: null, t: voice.at ?? 0, message: t("الموسيقى ({m}) عالية تحت التعليق ({v})", { m: music.id, v: voice.id }), fix: t("ضيف duck على مسار الموسيقى تحت التعليق") });
        }
      }
    }
    if (peakBeforeDb > 0) {
      issues.push({ code: "A001", severity: "warning", blocking: false, layer: null, t: null, message: t("ذروة الصوت {p} dB قبل الحد", { p: peakBeforeDb.toFixed(1) }), fix: t("خفّض صوت المصدر — الإنجن بيحد الذروة بس الأحسن من المصدر") });
    }
    if (lufsBefore > -70 && Math.abs(lufsBefore + 14) > 6) {
      issues.push({ code: "A002", severity: "warning", blocking: false, layer: null, t: null, message: t("المستوى {l} LUFS قبل الضبط", { l: lufsBefore.toFixed(1) }), fix: t("الإنجن بيظبط المستوى لـ −14 LUFS تلقائياً") });
    }
    this.gain = lufsBefore > -70 ? 10 ** ((-14 - lufsBefore) / 20) : 1;
    this.report = { lufsBefore, peakBeforeDb, issues };
    return this.report;
  }

  /** Pass two: the finished sound, `seconds` at a time (the first and last pieces differ by
   * the limiter's 5 ms look-ahead); exactly `length` samples in all. */
  async *chunks(seconds = 1): AsyncGenerator<Stereo> {
    if (!this.report) await this.measure();
    const step = Math.round(seconds * SAMPLE_RATE);
    const limiter = new StreamLimiter(-1.6);
    this.follow.clear();
    for (let i0 = 0; i0 < this.length; i0 += step) {
      const n = Math.min(step, this.length - i0);
      const w = await this.window(i0, n);
      for (let i = 0; i < n; i++) {
        w[0][i] *= this.gain;
        w[1][i] *= this.gain;
      }
      const out = limiter.process(w, i0 + n >= this.length);
      if (out[0].length) yield out;
    }
  }

  close() {
    for (const r of this.readers.values()) r?.close();
    this.readers.clear();
    this.music.clear();
  }
}

/** The whole soundtrack in memory — for the preview and short scenes. Long exports use
 * MixStream directly so memory stays flat. */
export async function mixAudio(input: MixInput): Promise<MixResult> {
  const stream = new MixStream(input);
  try {
    const report = await stream.measure();
    const mix: Stereo = [new Float32Array(stream.length), new Float32Array(stream.length)];
    let at = 0;
    for await (const piece of stream.chunks(10)) {
      mix[0].set(piece[0], at);
      mix[1].set(piece[1], at);
      at += piece[0].length;
    }
    return { channels: mix, lufsBefore: report.lufsBefore, peakBeforeDb: report.peakBeforeDb, lufs: integratedLoudness(mix), peakDb: truePeakDb(mix), issues: report.issues };
  } finally {
    stream.close();
  }
}

export function toAudioBuffer(ch: Stereo): AudioBuffer {
  const buffer = new AudioBuffer({ length: ch[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  buffer.copyToChannel(ch[0] as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(ch[1] as Float32Array<ArrayBuffer>, 1);
  return buffer;
}

export function hasAudio(scene: Scene): boolean {
  return (scene.audio?.length ?? 0) > 0 || videoLayers(scene.layers).some((l) => (l.volume ?? 1) > 0);
}
