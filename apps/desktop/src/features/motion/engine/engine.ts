/**
 * The engine in one object: give it a scene and a kit, `await ready()`, then ask for frames.
 * `ready()` loads every font, icon and picture the scene names before the first frame, so
 * a frame never draws with something missing that would appear a moment later.
 */

import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from "mediabunny";
import { BufferReader, StreamReader, type AudioReader } from "./audio";
import { DEFAULT_KIT } from "./brand";
import { evaluate, prepare, type Measure, type Prepared } from "./evaluate";
import { ensureFonts } from "./fonts";
import { loadIcons } from "./icons";
import { makeCanvas, renderFrame, type Ctx, type ImageLike, type Resources } from "./render";
import type { BrandKit, Frame, Layer, Scene } from "./types";
import { VideoClip } from "./video";

export interface AssetLoader {
  /** The bytes of `asset://id` as a Blob (from the agent). */
  blob(id: string): Promise<Blob>;
  /** A URL the decoder can read ranges from (videos are never loaded whole). */
  url(id: string): string;
  /** Saved facts about an asset (word timings for captions…). */
  meta?(id: string): Promise<Record<string, unknown> | null>;
}

/** A reader for the sound at `url`, decoded as it's read (mediabunny) so a long file never
 * sits in memory whole; formats it can't read fall back to `whole()`, if given. */
export async function openAudio(url: string, whole?: () => Promise<AudioBuffer | null>): Promise<AudioReader | null> {
  try {
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (track && (await track.canDecode())) {
      const sink = new AudioBufferSink(track);
      const duration = await track.computeDuration();
      return new StreamReader((from) => sink.buffers(from), duration, () => input.dispose());
    }
    input.dispose();
    if (!track) return null; // no sound at all
  } catch {
    // not a container mediabunny reads — try the browser's decoder
  }
  const buffer = whole ? await whole() : null;
  return buffer ? new BufferReader(buffer) : null;
}

let measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/** Width of `text` in `font`, measured by the browser (real shaping), memoised. */
export const measureText: Measure = (text, font) => {
  const key = `${font}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (!measureCtx) {
    const c = makeCanvas(8, 8);
    measureCtx = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
  }
  measureCtx.font = font;
  measureCtx.direction = /[؀-ۿ]/.test(text) ? "rtl" : "ltr";
  const w = measureCtx.measureText(text).width;
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(key, w);
  return w;
};

export function allLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  const walk = (list: Layer[]) => {
    for (const l of list) {
      out.push(l);
      if (l.children) walk(l.children);
    }
  };
  walk(layers);
  return out;
}

export class MotionEngine {
  scene: Scene;
  kit: BrandKit;
  prepared!: Prepared;
  resources: Resources;
  missingFonts: string[] = [];
  missingAssets: string[] = [];
  loader?: AssetLoader;
  /** Decoders for the scene's videos, by asset id. */
  clips = new Map<string, VideoClip>();
  /** The frame each video layer shows right now (filled by `prepareFrame`). */
  private videoFrames = new Map<string, ImageLike>();
  private audioCache = new Map<string, Promise<AudioBuffer | null>>();
  lottie?: { draw: NonNullable<Resources["lottie"]>; load: (scene: Scene, loader: AssetLoader) => Promise<void> };

  /** `preview`: videos are decoded no wider than 1280 px — plenty for the stage, and a 4K
   * source plays smoothly. Exports leave it off. */
  constructor(scene: Scene, kit: BrandKit = DEFAULT_KIT, loader?: AssetLoader, private options: { preview?: boolean } = {}) {
    this.scene = structuredClone(scene);
    this.kit = kit;
    this.loader = loader;
    this.resources = { kit, unit: 1, images: new Map(), video: (layer) => this.videoFrames.get(layer.id) ?? null };
  }

  private assetId(key: string | undefined): string | null {
    if (!key) return null;
    return this.scene.assets?.[key]?.src.replace("asset://", "") ?? null;
  }

  /** Decoders for every video the scene uses (opened once, kept across edits). */
  private async openVideos(layers: Layer[]): Promise<void> {
    if (!this.loader) return;
    for (const layer of layers) {
      if (layer.type !== "video") continue;
      const id = this.assetId(layer.asset);
      if (!id || this.clips.has(id)) continue;
      const clip = new VideoClip(this.loader.url(id));
      try {
        const side = Math.max(this.scene.composition.width, this.scene.composition.height);
        await clip.open(this.options.preview ? Math.min(1280, side) : side);
        this.clips.set(id, clip);
      } catch {
        this.missingAssets.push(layer.asset!);
      }
    }
  }

  /** Decodes the video frames this moment needs (call before `draw` when the scene has video). */
  async prepareFrame(t: number): Promise<void> {
    const work: Promise<void>[] = [];
    for (const layer of allLayers(this.scene.layers)) {
      if (layer.type !== "video" || layer.hidden || t < layer.start || t >= layer.end) continue;
      const clip = this.clips.get(this.assetId(layer.asset) ?? "");
      if (!clip) continue;
      const source = (layer.in ?? 0) + (t - layer.start) * (layer.speed ?? 1);
      work.push(
        clip.frameAt(layer.out !== undefined ? Math.min(source, layer.out) : source).then((frame) => {
          if (frame) this.videoFrames.set(layer.id, frame);
        }),
      );
    }
    await Promise.all(work);
  }

  /** For the export: hand in frames decoded elsewhere (in order, once each). */
  setVideoFrame(layerId: string, frame: ImageLike | null): void {
    if (frame) this.videoFrames.set(layerId, frame);
  }

  hasVideo(): boolean {
    return allLayers(this.scene.layers).some((l) => l.type === "video");
  }

  /** The decoded audio of an asset (voice-over, music file, a video's sound), cached. */
  decodeAudio(assetId: string): Promise<AudioBuffer | null> {
    const hit = this.audioCache.get(assetId);
    if (hit) return hit;
    const job = (async () => {
      if (!this.loader) return null;
      try {
        const blob = await this.loader.blob(assetId);
        const ctx = new OfflineAudioContext(2, 48000, 48000);
        return await ctx.decodeAudioData(await blob.arrayBuffer());
      } catch {
        return null;
      }
    })();
    this.audioCache.set(assetId, job);
    return job;
  }

  /** A reader for an asset's sound that decodes as it goes (mediabunny), so a long file
   * never sits in memory whole; formats it can't read fall back to a whole decode. */
  async audioReader(assetId: string): Promise<AudioReader | null> {
    if (!this.loader) return null;
    return openAudio(this.loader.url(assetId), () => this.decodeAudio(assetId));
  }

  async ready(): Promise<void> {
    const kit = this.kit;
    const fonts = [kit.fonts.display, kit.fonts.body, kit.fonts.latin, kit.fonts.mono ?? "IBM Plex Mono", "IBM Plex Sans Arabic", "Alexandria"];
    this.missingFonts = await ensureFonts(fonts);
    const layers = allLayers(this.scene.layers);
    await loadIcons(layers.map((l) => l.icon).filter((n): n is string => !!n));
    this.missingAssets = [];
    if (this.loader) {
      const wanted = new Set(layers.filter((l) => (l.type === "image" || l.type === "icon") && l.asset).map((l) => l.asset!));
      await Promise.all(
        [...wanted].map(async (id) => {
          if (this.resources.images.has(id)) return;
          const asset = this.scene.assets?.[id];
          if (!asset) return this.missingAssets.push(id);
          try {
            const blob = await this.loader!.blob(asset.src.replace("asset://", ""));
            const bitmap = await createImageBitmap(blob);
            this.resources.images.set(id, bitmap as ImageLike);
          } catch {
            this.missingAssets.push(id);
          }
        }),
      );
    }
    await this.openVideos(layers);
    // Captions that name a source get its word timings from the asset's saved transcript.
    if (this.loader?.meta) {
      for (const layer of layers) {
        if (layer.type !== "captions" || layer.words?.length || !layer.source) continue;
        const id = this.assetId(layer.source);
        const meta = id ? await this.loader.meta(id).catch(() => null) : null;
        const words = meta?.words as Layer["words"] | undefined;
        if (words?.length) layer.words = words;
      }
    }
    if (layers.some((l) => l.type === "lottie") && this.loader) {
      if (!this.lottie) {
        const mod = await import("./lottie");
        this.lottie = mod.lottiePlayer();
      }
      await this.lottie.load(this.scene, this.loader);
      this.resources.lottie = this.lottie.draw;
    }
    this.prepared = prepare(this.scene, kit, measureText);
    this.resources.unit = this.prepared.unit;
  }

  dispose(): void {
    for (const clip of this.clips.values()) clip.dispose();
    this.clips.clear();
  }

  /** Swap in an edited scene without reloading what's already loaded. */
  async update(scene: Scene, kit?: BrandKit): Promise<void> {
    this.scene = structuredClone(scene);
    if (kit) {
      this.kit = kit;
      this.resources.kit = kit;
    }
    await this.ready();
  }

  frame(t: number): Frame {
    return evaluate(this.prepared, t, measureText);
  }

  draw(ctx: Ctx, t: number, scale = 1): Frame {
    const frame = this.frame(t);
    renderFrame(ctx, frame, this.resources, scale);
    return frame;
  }

  /** One frame as a PNG (for a model that can look). */
  async png(t: number, maxSide = 1280): Promise<Blob> {
    const comp = this.scene.composition;
    const scale = Math.min(1, maxSide / Math.max(comp.width, comp.height));
    const canvas = makeCanvas(comp.width * scale, comp.height * scale);
    const ctx = canvas.getContext("2d") as Ctx;
    this.draw(ctx, t, scale);
    if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
    return new Promise((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
  }
}
