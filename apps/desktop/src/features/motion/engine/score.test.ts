import { describe, expect, it } from "vitest";
import { INSTRUMENTS, ScoreTrack, parseNote, partEvents } from "./score";
import type { AudioTrack } from "./types";

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe("composed scores", () => {
  it("reads notes and chords", () => {
    expect(parseNote("A4")).toEqual([69]);
    expect(parseNote("C#3")).toEqual([49]);
    expect(parseNote("Bb2")).toEqual([46]);
    expect(parseNote(60, 1)).toEqual([72]);
    expect(parseNote("Am7")).toEqual([69, 72, 76, 79]);
    expect(parseNote("G/3")).toEqual([55, 59, 62]);
    expect(parseNote("nonsense")).toEqual([]);
  });

  it("repeats a part every loop, inside its range, and reads drum steps", () => {
    const notes = partEvents({ instrument: "pluck", notes: [{ t: 0, n: "C4" }, { t: 1, n: "E4" }], loop: 2, from: 0, to: 6 }, 8);
    expect(notes.map((e) => e.beat)).toEqual([0, 1, 2, 3, 4, 5]);
    const steps = partEvents({ drum: "hat", steps: "x.x.X..." }, 4);
    expect(steps.map((e) => e.beat)).toEqual([0, 0.5, 1, 2, 2.5, 3]);
    expect(steps[2].vel).toBe(1);
    const swung = partEvents({ drum: "hat", hits: [0, 0.5, 1] }, 2, 0.4);
    expect(swung.map((e) => e.beat)).toEqual([0, 0.7, 1]);
  });

  it("renders every instrument and drum, the same each time, and silence after the end", () => {
    const track: AudioTrack = {
      id: "score",
      source: "compose",
      tempo: 120,
      parts: [
        ...INSTRUMENTS.map((instrument, i) => ({ instrument, notes: [{ t: i * 0.25, n: "C4", d: 0.5 }] })),
        { drum: "kick", steps: "x...x...x...x..." },
        { drum: "snare", hits: [1, 3] },
        { drum: "clap", hits: [3] },
        { drum: "hat", steps: "xxxxxxxxxxxxxxxx" },
      ],
    };
    const a = new ScoreTrack(track, 4).window(0, 48000 * 4);
    const b = new ScoreTrack(track, 4).window(0, 48000 * 4);
    expect(rms(a[0])).toBeGreaterThan(0.01);
    expect(Array.from(a[1].slice(1000, 1100))).toEqual(Array.from(b[1].slice(1000, 1100)));
    expect(a[0].every((v) => Number.isFinite(v) && Math.abs(v) < 8)).toBe(true);
    const after = new ScoreTrack(track, 4).window(48000 * 10, 4800);
    expect(rms(after[0])).toBe(0);
  }, 30_000);
});
