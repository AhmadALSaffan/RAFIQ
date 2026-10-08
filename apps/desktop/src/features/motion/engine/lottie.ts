/**
 * Imported Lottie files as layers: each one is played by lottie-web's canvas renderer on
 * the scene's clock (frame = local time × the file's frame rate) and drawn into the frame.
 * `.lottie` (dotLottie) files are zip archives; their first animation is used.
 */

import lottie, { type AnimationItem } from "lottie-web";
import type { AssetLoader } from "./engine";
import { allLayers } from "./engine";
import type { Ctx, Resources } from "./render";
import type { Layer, Scene } from "./types";

interface Player {
  anim: AnimationItem;
  canvas: HTMLCanvasElement;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

// ── A tiny zip reader (stored + deflate), enough for dotLottie ────────────────────────

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // the central directory tells the real sizes even when local headers defer them
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let k = 0; k < count; k++) {
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compressed);
    if (!name.endsWith("/")) out.set(name, method === 8 ? await inflateRaw(raw) : raw.slice());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function animationData(blob: Blob, name: string): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return JSON.parse(new TextDecoder().decode(bytes));
  const files = await unzip(bytes);
  const anim = [...files.keys()].find((f) => f.startsWith("animations/") && f.endsWith(".json")) ?? [...files.keys()].find((f) => f.endsWith(".json") && f !== "manifest.json");
  if (!anim) throw new Error(`${name}: no animation inside`);
  const data = JSON.parse(new TextDecoder().decode(files.get(anim)!)) as Record<string, unknown>;
  // inline any images the archive carries
  const assets = (data.assets as { p?: string; u?: string; e?: number }[] | undefined) ?? [];
  for (const asset of assets) {
    if (!asset.p || asset.e === 1) continue;
    const file = files.get(`images/${asset.p}`) ?? files.get(`${asset.u ?? ""}${asset.p}`);
    if (!file) continue;
    const b64 = btoa(String.fromCharCode(...file));
    asset.p = `data:image/png;base64,${b64}`;
    asset.u = "";
    asset.e = 1;
  }
  return data;
}

export function lottiePlayer() {
  const players = new Map<string, Player>();

  async function load(scene: Scene, loader: AssetLoader) {
    for (const layer of allLayers(scene.layers)) {
      if (layer.type !== "lottie" || !layer.asset) continue;
      const id = scene.assets?.[layer.asset]?.src.replace("asset://", "");
      // keyed by the scene's asset name, which is what a layer carries
      if (!id || players.has(layer.asset)) continue;
      const data = await animationData(await loader.blob(id), layer.asset);
      const width = Number(data.w) || 512;
      const height = Number(data.h) || 512;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const anim = lottie.loadAnimation({
        renderer: "canvas",
        loop: false,
        autoplay: false,
        animationData: data,
        rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
      } as Parameters<typeof lottie.loadAnimation>[0]);
      players.set(layer.asset, { anim, canvas, fps: Number(data.fr) || 30, frames: (Number(data.op) || 60) - (Number(data.ip) || 0), width, height });
    }
  }

  const draw: NonNullable<Resources["lottie"]> = (layer: Layer, ctx: Ctx, box, localTime) => {
    const player = layer.asset ? players.get(layer.asset) : undefined;
    if (!player) return;
    const frame = Math.min(player.frames - 0.001, Math.max(0, localTime * player.fps));
    player.anim.goToAndStop(frame, true);
    const k = Math.min(box.w / player.width, box.h / player.height);
    const w = player.width * k;
    const h = player.height * k;
    ctx.drawImage(player.canvas, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  };

  return { load, draw, players };
}
