/**
 * The user's videos: demuxed and decoded with WebCodecs (hardware) through mediabunny,
 * frame-exact at any time. Preview asks for single frames; the export walks each clip in
 * order, which decodes every packet at most once.
 */

import { ALL_FORMATS, CanvasSink, Input, UrlSource, type InputVideoTrack, type WrappedCanvas } from "mediabunny";
import { SAMPLE_RATE, type AudioReader } from "./audio";
import type { ImageLike } from "./render";

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  codec: string | null;
  canDecode: boolean;
}

export class VideoClip {
  readonly url: string;
  private input: Input;
  private track: InputVideoTrack | null = null;
  private sink: CanvasSink | null = null;
  info: VideoInfo | null = null;
  private last: { t: number; canvas: ImageLike } | null = null;
  private pending = new Map<number, Promise<ImageLike | null>>();
  /** Playing forward: one decoder run that steps ahead, instead of a seek from the
   * keyframe for every frame. */
  private run: { frames: AsyncGenerator<WrappedCanvas, void, unknown>; current: WrappedCanvas; next: WrappedCanvas | null } | null = null;
  private stepping: Promise<ImageLike | null> | null = null;

  constructor(url: string) {
    this.url = url;
    this.input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  }

  async open(maxWidth?: number): Promise<VideoInfo> {
    if (this.info) return this.info;
    this.track = await this.input.getPrimaryVideoTrack();
    if (!this.track) throw new Error("no video track");
    const audio = await this.input.getPrimaryAudioTrack();
    const canDecode = await this.track.canDecode();
    const width = this.track.displayWidth;
    const height = this.track.displayHeight;
    this.sink = new CanvasSink(this.track, {
      poolSize: 4,
      ...(maxWidth && width > maxWidth ? { width: maxWidth } : {}),
    });
    this.info = {
      duration: await this.input.computeDuration(),
      width,
      height,
      hasAudio: !!audio,
      codec: this.track.codec,
      canDecode,
    };
    return this.info;
  }

  /** The frame shown at `t` seconds into the clip (clamped to the clip). A little ahead of
   * the last one (playing) steps the running decoder forward; anything else seeks. */
  async frameAt(t: number): Promise<ImageLike | null> {
    if (!this.sink || !this.info) await this.open();
    const time = Math.max(0, Math.min(t, (this.info?.duration ?? 0) - 1e-3));
    const run = this.run;
    if (run && time >= run.current.timestamp - 1e-4 && time - run.current.timestamp < 1) {
      // one step at a time: a second call waits for the first rather than racing it
      const step = (this.stepping ?? Promise.resolve(null)).then(async () => {
        while (run === this.run && run.next && run.next.timestamp <= time + 1e-4) {
          run.current = run.next;
          run.next = (await run.frames.next()).value ?? null;
        }
        return run.current.canvas as ImageLike;
      });
      this.stepping = step;
      return step;
    }
    const key = Math.round(time * 1000);
    if (this.last && Math.round(this.last.t * 1000) === key) return this.last.canvas;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    // a jump (or the first frame): start a decoder run here for the frames that follow
    void this.run?.frames.return(undefined);
    this.run = null;
    this.stepping = null;
    const frames = this.sink!.canvases(time);
    const job = (async () => {
      const first = (await frames.next()).value ?? null;
      this.pending.delete(key);
      if (!first) return null;
      this.run = { frames, current: first, next: (await frames.next()).value ?? null };
      const canvas = first.canvas as ImageLike;
      this.last = { t: time, canvas };
      return canvas;
    })();
    this.pending.set(key, job);
    return job;
  }

  /** Frames at these times, in order (decoded once each) — for the export. */
  async *framesAt(times: number[]): AsyncGenerator<ImageLike | null> {
    if (!this.sink || !this.info) await this.open();
    const d = this.info!.duration;
    for await (const wrapped of this.sink!.canvasesAtTimestamps(times.map((x) => Math.max(0, Math.min(x, d - 1e-3))))) {
      yield wrapped ? (wrapped.canvas as ImageLike) : null;
    }
  }

  /** Small frames at a steady rate, for finding cuts. */
  async *thumbs(step: number, width = 64): AsyncGenerator<{ t: number; canvas: ImageLike }> {
    if (!this.track) await this.open();
    const sink = new CanvasSink(this.track!, { width, poolSize: 2 });
    const d = this.info!.duration;
    const times: number[] = [];
    for (let x = 0; x < d; x += step) times.push(x);
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (wrapped) yield { t: times[i], canvas: wrapped.canvas as ImageLike };
      i++;
    }
  }

  dispose(): void {
    void this.run?.frames.return(undefined);
    this.run = null;
    this.input.dispose();
  }
}

// ── Analysis: cuts, sample frames, loudness over time ─────────────────────────────────

function luma(canvas: ImageLike): Float32Array {
  const w = canvas.width;
  const h = canvas.height;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  return out;
}

export interface Analysis {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  codec: string | null;
  shots: { start: number; end: number }[];
  images: string[];
  loudness?: { second: number; db: number }[];
}

export async function analyzeVideo(clip: VideoClip, audio: AudioReader | null): Promise<Analysis> {
  const info = await clip.open();
  const step = info.duration > 600 ? 1 : 0.5;
  const cuts: number[] = [0];
  let prev: Float32Array | null = null;
  for await (const { t, canvas } of clip.thumbs(step)) {
    const cur = luma(canvas);
    if (prev) {
      let diff = 0;
      for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - prev[i]);
      diff /= cur.length;
      if (diff > 0.18 && t - cuts[cuts.length - 1] > 0.8) cuts.push(t);
    }
    prev = cur;
  }
  const shots = cuts.map((start, i) => ({ start: Math.round(start * 100) / 100, end: Math.round((cuts[i + 1] ?? info.duration) * 100) / 100 }));
  // one picture from the middle of each of the longest shots (up to six)
  const picked = [...shots].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 6).sort((a, b) => a.start - b.start);
  const images: string[] = [];
  for (const shot of picked) {
    const frame = await clip.frameAt((shot.start + shot.end) / 2);
    if (!frame) continue;
    const k = Math.min(1, 512 / Math.max(frame.width, frame.height));
    const c = new OffscreenCanvas(Math.round(frame.width * k), Math.round(frame.height * k));
    c.getContext("2d")!.drawImage(frame, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    images.push(await blobToDataUrl(blob));
  }
  let loudness: Analysis["loudness"];
  if (audio) {
    // a second at a time, so an hour of video costs a second of samples
    loudness = [];
    try {
      for (let s = 0; s < audio.duration; s++) {
        const n = Math.round(Math.min(1, audio.duration - s) * SAMPLE_RATE);
        if (n <= 0) break;
        const [left] = await audio.read(s, n);
        let sum = 0;
        for (let i = 0; i < n; i++) sum += left[i] * left[i];
        loudness.push({ second: s, db: Math.round(10 * Math.log10(sum / n + 1e-12)) });
      }
    } finally {
      audio.close();
    }
  }
  return { duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, codec: info.codec, shots, images, loudness };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
