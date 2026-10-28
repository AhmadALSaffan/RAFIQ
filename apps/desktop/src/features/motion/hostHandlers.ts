/** The engine's work for the agent channel — loaded only when the first request arrives. */

import { getMotionProject, type EngineRequest } from "../../lib/api";
import { MixStream, hasAudio } from "./engine/audio";
import { MotionEngine, openAudio } from "./engine/engine";
import type { ExportSettings } from "./engine/export";
import { inspectFrames } from "./engine/inspect";
import { lintScene, type Issue } from "./engine/lint";
import { formatReview, reviewScene } from "./engine/review";
import { analyzeVideo, blobToDataUrl, VideoClip } from "./engine/video";
import type { Asset, BrandKit, Scene } from "./engine/types";
import { assetLoader, runExport } from "./exports";
import { breather } from "./engine/breathe";

// One engine kept between the model's requests. A model working on a reel checks it again
// after every edit; a new engine each time decoded every picture, reopened every video and
// built the 3D (lighting, shadows, shaders) from nothing — on a laptop, seconds of a frozen
// app per check. `update` keeps whatever the edit didn't touch. Let go after a minute idle.
const IDLE_MS = 60_000;
let kept: MotionEngine | null = null;
let idle = 0;

async function engineFor(scene: Scene, kit: BrandKit): Promise<MotionEngine> {
  window.clearTimeout(idle);
  if (kept) {
    try {
      await kept.update(scene, kit);
      return kept;
    } catch {
      kept.dispose();
      kept = null;
    }
  }
  const engine = new MotionEngine(scene, kit, await assetLoader());
  await engine.ready();
  kept = engine;
  return engine;
}

function release(): void {
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    kept?.dispose();
    kept = null;
  }, IDLE_MS);
}

/** The project closed: let the engine go now, not a minute later. */
export function closeEngine(): void {
  window.clearTimeout(idle);
  kept?.dispose();
  kept = null;
}

// One request at a time: they share the engine.
let queue: Promise<unknown> = Promise.resolve();

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

export function handle(request: EngineRequest): Promise<unknown> {
  const run = queue.then(() => work(request));
  queue = run.catch(() => undefined);
  return run;
}

async function work(request: EngineRequest): Promise<unknown> {
  const p = request.payload;
  switch (request.kind) {
    case "lint": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        return { issues: await fullLint(engine, (p.target as "mp4" | "lottie") ?? "mp4") };
      } finally {
        release();
      }
    }
    case "inspect": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        return { report: await inspectFrames(engine, (p.times as number[]) ?? [0]) };
      } finally {
        release();
      }
    }
    case "review": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        return { report: formatReview(reviewScene(engine)) };
      } finally {
        release();
      }
    }
    case "frames": {
      const engine = await engineFor(p.scene as Scene, p.kit as BrandKit);
      try {
        const images: string[] = [];
        const breathe = breather();
        for (const t of (p.times as number[]) ?? [0]) {
          await breathe();
          if (engine.hasVideo()) await engine.prepareFrame(t);
          images.push(await blobToDataUrl(await engine.png(t, Number(p.maxSide) || 960)));
        }
        return { images };
      } finally {
        release();
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

