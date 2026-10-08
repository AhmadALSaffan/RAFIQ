/**
 * Running exports, in one small store: started from the export window or by the model
 * (`motion_render`), watched by whichever page is open, cancellable from either.
 */

import { useSyncExternalStore } from "react";
import {
  failMotionRender,
  finishMotionRender,
  getMotionProject,
  motionAssetUrl,
  startMotionRender,
  transcodeMotionRender,
  writeMotionChunk,
} from "../../lib/api";
import { getApiConfig } from "../../lib/config";
import { MotionEngine, type AssetLoader } from "./engine/engine";
import { exportMp4, type ExportIO, type ExportSettings, type Progress, type RenderInfo } from "./engine/export";
import type { BrandKit, Scene } from "./engine/types";

export interface ExportJob {
  key: string;
  projectId: string;
  settings: ExportSettings;
  progress: Progress | null;
  result: RenderInfo | null;
  error: string | null;
  controller: AbortController;
}

let jobs: ExportJob[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  jobs = [...jobs];
  listeners.forEach((fn) => fn());
};

export function useExports(projectId?: string): ExportJob[] {
  const all = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => jobs,
  );
  return projectId ? all.filter((j) => j.projectId === projectId) : all;
}

export function dismissExport(key: string) {
  jobs = jobs.filter((j) => j.key !== key);
  emit();
}

/** Reads assets from the agent (blobs for pictures and audio, ranged URLs for video). */
export async function assetLoader(): Promise<AssetLoader> {
  const { baseUrl, token } = await getApiConfig();
  const url = (id: string) => `${baseUrl}/motion/assets/${id}/file?token=${encodeURIComponent(token)}`;
  return {
    url,
    blob: async (id) => {
      const res = await fetch(await motionAssetUrl(id));
      if (!res.ok) throw new Error(`asset ${id}: ${res.status}`);
      return res.blob();
    },
    meta: async (id) => {
      const res = await fetch(`${baseUrl}/motion/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return ((await res.json()) as { meta: Record<string, unknown> | null }).meta;
    },
  };
}

const io = (projectId: string): ExportIO => ({
  start: (settings) => startMotionRender(projectId, settings as never),
  write: (id, position, data) => writeMotionChunk(id, position, data),
  finish: (id, expect, encoder) => finishMotionRender(id, expect, encoder),
  fail: async (id, error, canceled) => {
    await failMotionRender(id, error, canceled);
  },
  transcode: (id, settings, expect) => transcodeMotionRender(id, settings as never, expect),
});

export async function runExport(projectId: string, settings: ExportSettings, scene?: Scene, kit?: BrandKit): Promise<ExportJob> {
  const job: ExportJob = { key: `${projectId}:${Date.now()}`, projectId, settings, progress: null, result: null, error: null, controller: new AbortController() };
  jobs = [...jobs, job];
  emit();
  try {
    if (!scene || !kit) {
      const project = await getMotionProject(projectId);
      scene = project.scene;
      kit = project.kit;
    }
    const engine = new MotionEngine(scene, kit, await assetLoader());
    await engine.ready();
    job.result = await exportMp4(
      engine,
      settings,
      io(projectId),
      (p) => {
        job.progress = p;
        emit();
      },
      job.controller.signal,
    );
    if (job.result.status !== "done") job.error = job.result.error ?? "failed";
    engine.dispose();
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
  }
  emit();
  return job;
}

/** The scene as Lottie: exported, played back with lottie-web and compared with the engine
 *  frame by frame; only kept if every checked frame matches (SSIM ≥ 0.98). */
export async function runLottieExport(projectId: string, scene: Scene, kit: BrandKit, format: "lottie" | "dotlottie"): Promise<{ path: string; ssim: number[]; skipped: { layer: string; reason: string }[]; ok: boolean; error?: string }> {
  const { exportLottie, dotLottie, verifyLottie } = await import("./engine/lottieExport");
  const engine = new MotionEngine(scene, kit, await assetLoader());
  await engine.ready();
  try {
    const { json, skipped } = await exportLottie(engine);
    const d = scene.composition.duration;
    const times = [0.25, 0.5, 0.75, 0.9].map((k) => Math.round(d * k * scene.composition.fps) / scene.composition.fps);
    // Compared with the engine drawing what the file carries: layers Lottie can't hold (and
    // that the panel already listed) are hidden on both sides.
    let reference = engine;
    if (skipped.length) {
      const left = new Set(skipped.map((s) => s.layer));
      const hide = (layers: Scene["layers"]): Scene["layers"] => layers.map((l) => ({ ...l, hidden: l.hidden || left.has(l.id), children: l.children ? hide(l.children) : undefined }));
      reference = new MotionEngine({ ...scene, layers: hide(scene.layers) }, kit, await assetLoader());
      await reference.ready();
    }
    const checks = await verifyLottie(reference, json, times);
    if (reference !== engine) reference.dispose();
    const scores = checks.map((c) => Math.round(c.ssim * 1000) / 1000);
    const worst = Math.min(...scores);
    const problems = worst < 0.98 ? [`frames differ from the engine (SSIM ${worst} < 0.98)`] : [];
    const bytes = format === "dotlottie" ? dotLottie(json) : new TextEncoder().encode(JSON.stringify(json));
    const render = await startMotionRender(projectId, { format });
    await writeMotionChunk(render.id, 0, bytes);
    const done = await finishMotionRender(render.id, {}, "rafiq lottie (shapes + outlines)", { ssim: scores, skipped, problems, player: "lottie-web" });
    return { path: done.path, ssim: scores, skipped, ok: done.status === "done", error: done.error ?? undefined };
  } finally {
    engine.dispose();
  }
}
