/**
 * MP4 export on the GPU: frames drawn by the engine, encoded by WebCodecs (NVENC / AMF /
 * Quick Sync through Windows, no download), muxed by mediabunny, and streamed to disk in
 * chunks through the agent — so memory stays flat however long the video is. The agent
 * reads the file back at the end and only then calls it done.
 */

import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  type StreamTargetChunk,
} from "mediabunny";
import { MixStream, SAMPLE_RATE, hasAudio, type Stereo } from "./audio";
import { allLayers, type MotionEngine } from "./engine";
import { makeCanvas, type Ctx } from "./render";
import type { Layer } from "./types";

export type ExportSize = "720p" | "1080p" | "1440p" | "2160p";

export interface ExportSettings {
  format: "mp4";
  size: ExportSize;
  fps?: number;
  codec: "h264" | "h265";
  quality?: "auto" | "high";
  encoder?: "auto" | "gpu" | "ffmpeg";
}

export interface RenderInfo {
  id: string;
  path: string;
  status: string;
  error?: string | null;
  report?: Record<string, unknown> | null;
}

/** How the export reaches the disk (implemented over the agent's render endpoints). */
export interface ExportIO {
  start(settings: ExportSettings): Promise<{ id: string; path: string }>;
  write(id: string, position: number, data: Uint8Array): Promise<void>;
  finish(id: string, expect: Record<string, unknown>, encoder: string): Promise<RenderInfo>;
  fail(id: string, error: string, canceled: boolean): Promise<void>;
  /** H.265, or an encoder the GPU doesn't have, goes through FFmpeg (phase 7). */
  transcode?(id: string, settings: ExportSettings, expect: Record<string, unknown>): Promise<RenderInfo>;
}

export interface Progress {
  frame: number;
  frames: number;
  fraction: number;
  /** Seconds left, once there's enough to tell. */
  eta: number | null;
  stage: "audio" | "video" | "finishing" | "checking";
  /** How far the sound's measuring pass is (0–1), while stage is "audio". */
  audio?: number;
}

export class NeedsFfmpeg extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsFfmpeg";
  }
}

const SHORT: Record<ExportSize, number> = { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 };

export function outputSize(width: number, height: number, size: ExportSize): { width: number; height: number } {
  const k = SHORT[size] / Math.min(width, height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(width * k), height: even(height * k) };
}

/** H.264 level for a size and rate (ITU-T H.264 Annex A: MaxFS / MaxMBPS). */
export function avcLevel(width: number, height: number, fps: number): { level: string; codec: string } {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = mbs * fps;
  const table: [string, number, number, string][] = [
    ["4.0", 8192, 245760, "28"],
    ["4.2", 8704, 522240, "2A"],
    ["5.0", 22080, 589824, "32"],
    ["5.1", 36864, 983040, "33"],
    ["5.2", 36864, 2073600, "34"],
    ["6.0", 139264, 4177920, "3C"],
    ["6.1", 139264, 8355840, "3D"],
    ["6.2", 139264, 16711680, "3E"],
  ];
  const fit = table.find(([, fs, mbps]) => mbs <= fs && rate <= mbps) ?? table[table.length - 1];
  return { level: fit[0], codec: `avc1.6400${fit[3]}` };
}

export function bitrateFor(width: number, height: number, fps: number, codec: "h264" | "h265", quality: "auto" | "high" = "auto"): number {
  const bpp = codec === "h265" ? 0.06 : 0.1;
  const bits = width * height * fps * bpp * (quality === "high" ? 1.6 : 1);
  return Math.round(Math.min(160e6, Math.max(2e6, bits)));
}

/** Feeds each video layer's frames in order, decoding every packet once. */
class VideoFeeder {
  private gens = new Map<string, AsyncGenerator<unknown>>();
  constructor(private engine: MotionEngine, private fps: number, private frames: number) {}

  init() {
    for (const layer of allLayers(this.engine.scene.layers)) {
      if (layer.type !== "video" || !layer.asset) continue;
      const id = this.engine.scene.assets?.[layer.asset]?.src.replace("asset://", "");
      const clip = id ? this.engine.clips.get(id) : undefined;
      if (!clip) continue;
      const times: number[] = [];
      for (let i = 0; i < this.frames; i++) {
        const t = i / this.fps;
        if (t >= layer.start && t < layer.end && !layer.hidden) {
          const s = (layer.in ?? 0) + (t - layer.start) * (layer.speed ?? 1);
          times.push(layer.out !== undefined ? Math.min(s, layer.out) : s);
        }
      }
      if (times.length) this.gens.set(layer.id, clip.framesAt(times));
    }
  }

  async advance(t: number, layers: Layer[]) {
    for (const layer of layers) {
      const gen = this.gens.get(layer.id);
      if (!gen || layer.hidden || t < layer.start || t >= layer.end) continue;
      const next = await gen.next();
      if (!next.done) this.engine.setVideoFrame(layer.id, next.value as never);
    }
  }
}

export async function exportMp4(
  engine: MotionEngine,
  settings: ExportSettings,
  io: ExportIO,
  onProgress: (p: Progress) => void = () => {},
  signal?: AbortSignal,
): Promise<RenderInfo> {
  const comp = engine.scene.composition;
  const fps = settings.fps ?? comp.fps;
  const { width, height } = outputSize(comp.width, comp.height, settings.size);
  const frames = Math.max(1, Math.round(comp.duration * fps));
  const bitrate = bitrateFor(width, height, fps, settings.codec, settings.quality);
  const avc = avcLevel(width, height, fps);
  const wantsAudio = hasAudio(engine.scene);

  // What this machine can do, before anything is written.
  const viaFfmpeg = settings.encoder === "ffmpeg" || settings.codec === "h265";
  const videoCodec = "avc" as const;
  if (!viaFfmpeg) {
    const ok = await canEncodeVideo(videoCodec, { width, height, bitrate, frameRate: fps, fullCodecString: avc.codec } as never);
    if (!ok) throw new NeedsFfmpeg(`H.264 ${width}×${height}@${fps} isn't supported by this GPU's encoder`);
  } else if (!io.transcode) {
    throw new NeedsFfmpeg("H.265 export needs FFmpeg");
  }
  const aac = wantsAudio ? await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }) : false;
  if (wantsAudio && !aac && !io.transcode) throw new NeedsFfmpeg("AAC audio isn't supported here");

  const render = await io.start(settings);
  let failed = false;
  try {
    // The sound is measured first (one quick pass for its loudness — and a broken asset stops
    // the export before minutes of video are drawn), then streamed alongside the frames, a
    // second at a time, so memory stays flat however long the video is.
    let mix: MixStream | null = null;
    if (wantsAudio) {
      onProgress({ frame: 0, frames, fraction: 0, eta: null, stage: "audio" });
      mix = new MixStream({ scene: engine.scene, open: (id) => engine.audioReader(id) });
      await mix.measure((f) => onProgress({ frame: 0, frames, fraction: 0, eta: null, stage: "audio", audio: f }));
    }

    let pending = Promise.resolve();
    const writable = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        // keep the order of writes; each waits for the previous one
        pending = pending.then(() => io.write(render.id, chunk.position, chunk.data));
        return pending;
      },
    });
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
    });
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false }) as Ctx;
    // An intermediate for FFmpeg is encoded at a high rate so the second pass loses little.
    const intermediateRate = viaFfmpeg ? Math.min(160e6, bitrate * 3) : bitrate;
    const video = new CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: intermediateRate,
      keyFrameInterval: 2,
      hardwareAcceleration: "prefer-hardware",
      fullCodecString: avc.codec,
      latencyMode: "quality",
    } as never);
    output.addVideoTrack(video, { frameRate: fps });
    let audioSource: AudioBufferSource | null = null;
    if (mix && aac) {
      audioSource = new AudioBufferSource({ codec: "aac", bitrate: 192000 });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    const sound = audioSource && mix ? mix.chunks(1) : null;
    let soundUntil = 0; // seconds of audio handed to the encoder so far
    const feedSound = async (upTo: number) => {
      if (!sound || !audioSource) return;
      while (soundUntil < upTo) {
        const next = await sound.next();
        if (next.done) {
          soundUntil = Infinity;
          break;
        }
        await audioSource.add(toBuffer(next.value));
        soundUntil += next.value[0].length / SAMPLE_RATE;
      }
    };

    const feeder = new VideoFeeder(engine, fps, frames);
    feeder.init();
    const layers = allLayers(engine.scene.layers).filter((l) => l.type === "video");
    const scale = width / comp.width;
    const started = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) {
        await output.cancel();
        await io.fail(render.id, "canceled", true);
        failed = true;
        throw new DOMException("canceled", "AbortError");
      }
      const t = i / fps;
      if (layers.length) await feeder.advance(t, layers);
      engine.draw(ctx, t, scale);
      await video.add(t, 1 / fps);
      // the muxer interleaves the tracks, so the sound keeps a second ahead of the picture
      await feedSound(t + 1);
      if (i % 5 === 0 || i === frames - 1) {
        const elapsed = (performance.now() - started) / 1000;
        const fraction = (i + 1) / frames;
        onProgress({ frame: i + 1, frames, fraction, eta: i > 10 ? (elapsed / fraction) * (1 - fraction) : null, stage: "video" });
      }
    }
    video.close();
    if (audioSource) {
      await feedSound(Infinity);
      audioSource.close();
    }
    mix?.close();
    onProgress({ frame: frames, frames, fraction: 1, eta: 0, stage: "finishing" });
    await output.finalize();
    await pending;
    onProgress({ frame: frames, frames, fraction: 1, eta: 0, stage: "checking" });
    const expect = { width, height, fps, duration: frames / fps, audio: !!audioSource };
    if (viaFfmpeg || (wantsAudio && !aac)) return await io.transcode!(render.id, settings, { ...expect, audio: wantsAudio });
    return await io.finish(render.id, expect, `webcodecs ${avc.codec} @ ${(bitrate / 1e6).toFixed(1)} Mbps`);
  } catch (error) {
    if (!failed) {
      await io.fail(render.id, error instanceof Error ? error.message : String(error), false).catch(() => {});
    }
    throw error;
  }
}

function toBuffer(ch: Stereo): AudioBuffer {
  const buffer = new AudioBuffer({ length: ch[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  buffer.copyToChannel(ch[0] as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(ch[1] as Float32Array<ArrayBuffer>, 1);
  return buffer;
}

/** What each export setting is possible on this machine: H.264 sizes and rates via WebCodecs. */
export async function capabilities(width: number, height: number): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const size of ["720p", "1080p", "1440p", "2160p"] as ExportSize[]) {
    for (const fps of [30, 60, 120]) {
      const o = outputSize(width, height, size);
      const avc = avcLevel(o.width, o.height, fps);
      out[`${size}@${fps}`] = await canEncodeVideo("avc", { width: o.width, height: o.height, bitrate: bitrateFor(o.width, o.height, fps, "h264"), frameRate: fps, fullCodecString: avc.codec } as never).catch(() => false);
    }
  }
  out.hevc = await canEncodeVideo("hevc", { width: 1920, height: 1080, bitrate: 8e6 } as never).catch(() => false);
  out.aac = await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }).catch(() => false);
  return out;
}
