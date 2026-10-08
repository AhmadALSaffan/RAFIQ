import { describe, expect, it } from "vitest";
import { BufferReader, MixStream, SAMPLE_RATE, integratedLoudness, mixAudio, truePeakDb, type AudioReader, type Stereo } from "./audio";
import type { Scene } from "./types";

function scene(duration: number, audio: Scene["audio"], extra: Partial<Scene> = {}): Scene {
  return {
    version: 1,
    title: "t",
    brand: "workspace",
    assets: { tone: { kind: "audio", src: "asset://tone" } },
    composition: { width: 1080, height: 1920, fps: 30, duration, background: "brand.surface", safeArea: "none", direction: "rtl" },
    layers: [],
    audio,
    ...extra,
  } as unknown as Scene;
}

/** A sine "file" as an AudioBuffer stand-in (node has no Web Audio). */
function toneReader(seconds: number, rate = 44100, freq = 440): AudioReader {
  const n = Math.round(seconds * rate);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / rate);
  const fake = { duration: seconds, length: n, sampleRate: rate, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
  return new BufferReader(fake);
}

async function collect(stream: MixStream, seconds: number): Promise<Stereo> {
  const out: Stereo = [new Float32Array(stream.length), new Float32Array(stream.length)];
  let at = 0;
  for await (const piece of stream.chunks(seconds)) {
    out[0].set(piece[0], at);
    out[1].set(piece[1], at);
    at += piece[0].length;
  }
  expect(at).toBe(stream.length);
  return out;
}

const MUSIC_AND_VOICE: Scene["audio"] = [
  { id: "music", source: "procedural", pattern: "upbeat", gain: -6 },
  { id: "vo", source: "asset", asset: "tone", at: 2, gain: 0, duck: "music", fadeIn: 0.2, fadeOut: 0.5 },
  { id: "hit", source: "sfx", kind: "whoosh", at: 3.99 },
] as Scene["audio"];

describe("the streamed mix", () => {
  it("gives the same samples whatever the window size", async () => {
    const input = { scene: scene(9, MUSIC_AND_VOICE), open: async () => toneReader(4) };
    const small = await collect(new MixStream(input), 1);
    const large = await collect(new MixStream(input), 10);
    let worst = 0;
    for (let i = 0; i < small[0].length; i++) worst = Math.max(worst, Math.abs(small[0][i] - large[0][i]), Math.abs(small[1][i] - large[1][i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it("measures the loudness the same way the whole-buffer meter does", async () => {
    const stream = new MixStream({ scene: scene(6, MUSIC_AND_VOICE), open: async () => toneReader(3) });
    const report = await stream.measure();
    const raw = await mixAudio({ scene: scene(6, MUSIC_AND_VOICE), open: async () => toneReader(3) });
    expect(Math.abs(report.lufsBefore - raw.lufsBefore)).toBeLessThan(1e-6);
    // and the finished sound is at −14 LUFS with its peaks held under −1 dB
    expect(Math.abs(raw.lufs + 14)).toBeLessThan(0.6);
    expect(raw.peakDb).toBeLessThan(-1);
    expect(Math.abs(integratedLoudness(raw.channels) - raw.lufs)).toBeLessThan(1e-9);
    expect(truePeakDb(raw.channels)).toBe(raw.peakDb);
  });

  it("places a file where it belongs, resampled, with its fades", async () => {
    const audio = [{ id: "vo", source: "asset", asset: "tone", at: 1, fadeIn: 0.5 }] as Scene["audio"];
    const stream = new MixStream({ scene: scene(3, audio), open: async () => toneReader(1.5) });
    await stream.measure();
    const out = await collect(stream, 1);
    const rms = (a: number, b: number) => {
      let s = 0;
      for (let i = Math.round(a * SAMPLE_RATE); i < Math.round(b * SAMPLE_RATE); i++) s += out[0][i] ** 2;
      return Math.sqrt(s / ((b - a) * SAMPLE_RATE));
    };
    expect(rms(0, 0.99)).toBeLessThan(1e-4); // silent before it starts
    expect(rms(1.0, 1.1)).toBeLessThan(rms(1.6, 1.7)); // fading in
    expect(rms(2.55, 3)).toBeLessThan(1e-4); // over after its 1.5 s
  });

  it("loops a short file to the end of its track", async () => {
    const audio = [{ id: "bed", source: "asset", asset: "tone", loop: true }] as Scene["audio"];
    const out = await mixAudio({ scene: scene(5, audio), open: async () => toneReader(0.7) });
    let s = 0;
    for (let i = 4 * SAMPLE_RATE; i < 4.5 * SAMPLE_RATE; i++) s += out.channels[0][i] ** 2;
    expect(Math.sqrt(s / (0.5 * SAMPLE_RATE))).toBeGreaterThan(0.05);
  });

  it("is silent and calm with nothing to play", async () => {
    const out = await mixAudio({ scene: scene(2, []), open: async () => null });
    expect(out.lufsBefore).toBe(-70);
    expect(out.channels[0].every((x) => x === 0)).toBe(true);
  });

  it("flags loud music under a voice that doesn't duck it", async () => {
    const audio = [
      { id: "music", source: "procedural", gain: 0 },
      { id: "vo", source: "tts", asset: "tone", gain: 0 },
    ] as Scene["audio"];
    const report = await new MixStream({ scene: scene(3, audio), open: async () => toneReader(2) }).measure();
    expect(report.issues.map((i) => i.code)).toContain("A003");
  });
});
