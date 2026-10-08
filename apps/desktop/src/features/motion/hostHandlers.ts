/** The engine's work for the agent channel — loaded only when the first request arrives. */

import { getMotionProject, type EngineRequest } from "../../lib/api";
import { MixStream, hasAudio } from "./engine/audio";
import { MotionEngine, openAudio } from "./engine/engine";
import type { ExportSettings } from "./engine/export";
import { inspectFrames } from "./engine/inspect";
import { lintScene, type Issue } from "./engine/lint";
import { analyzeVideo, blobToDataUrl, VideoClip } from "./engine/video";
import type { Asset, BrandKit, Scene } from "./engine/types";
import { assetLoader, runExport } from "./exports";

async function engineFor(scene: Scene, kit: BrandKit): Promise<MotionEngine> {
  const engine = new MotionEngine(scene, kit, await assetLoader());
  await engine.ready();
  return engine;
}

/** Every check, the audio ones too when the scene has sound. */
export async function fullLint(engine: MotionEngine, target: "mp4" | "lottie" = "mp4"): Promise<Issue[]> {
  const issues = await lintScene(engine, { target });
  if (hasAudio(engine.scene)) {
    // one measuring pass — the checks only need the loudness, not the finished samples
    const mix = new MixStream({ scene: engine.scene, open: (id) => engine.audioReader(id) });
    try {
      issues.push(...(await mix.measure()).issues);
    } catch {
      /* a broken audio asset shows up as its own error at export */
    } finally {
      mix.close();
    }
  }
  return issues;
}

export async function handle(request: EngineRequest): Promise<unknown> {
  const p = request.payload;
  switch (request.kind) {
    case "lint": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        return { issues: await fullLint(engine, (p.target as "mp4" | "lottie") ?? "mp4") };
      } finally {
        engine.dispose();
      }
    }
    case "inspect": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        return { report: await inspectFrames(engine, (p.times as number[]) ?? [0]) };
      } finally {
        engine.dispose();
      }
    }
    case "frames": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        const images: string[] = [];
        for (const t of (p.times as number[]) ?? [0]) {
          if (engine.hasVideo()) await engine.prepareFrame(t);
          images.push(await blobToDataUrl(await engine.png(t, Number(p.maxSide) || 960)));
        }
        return { images };
      } finally {
        engine.dispose();
      }
    }
    case "export": {
      const job = await runExport(String(p.projectId), p.settings as ExportSettings);
      if (job.error || !job.result) return { ok: false, error: job.error ?? "failed" };
      return { ok: job.result.status === "done", path: job.result.path, report: job.result.report, error: job.result.error };
    }
    case "analyze": {
      const asset = p.asset as Asset;
      const project = await getMotionProject(String(p.projectId));
      void project;
      const loader = await assetLoader();
      const id = asset.src.replace("asset://", "");
      const clip = new VideoClip(loader.url(id));
      const audio = await openAudio(loader.url(id)).catch(() => null);
      try {
        return await analyzeVideo(clip, audio);
      } finally {
        clip.dispose();
      }
    }
    default:
      return null;
  }
}

