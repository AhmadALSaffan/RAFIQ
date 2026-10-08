/** Motion projects: scenes, versions, assets, exports, brand kits, and the engine channel. */

import { getApiConfig } from "../config";
import { request, tracked } from "./client";
import type { BrandKit, Scene } from "../../features/motion/engine/types";

export interface MotionProjectSummary {
  id: string;
  title: string;
  chat_id: string;
  model_id: string | null;
  workspace_id: string | null;
  version: number;
  width: number;
  height: number;
  fps: number;
  duration: number;
  layers: number;
  last_render: { id: string; status: string; path: string; settings: Record<string, unknown>; finished_at: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface MotionProject {
  id: string;
  title: string;
  chat_id: string;
  model_id: string | null;
  workspace_id: string | null;
  folder: string;
  version: number;
  scene: Scene;
  kit: BrandKit;
  created_at: string;
  updated_at: string;
}

export interface MotionVersion {
  number: number;
  author: "model" | "user" | "restore";
  summary: string;
  created_at: string;
}

export interface MotionAsset {
  id: string;
  kind: "image" | "svg" | "video" | "audio" | "lottie";
  name: string;
  mime: string;
  size: number;
  source: string;
  credit: string | null;
  license: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface MotionRender {
  id: string;
  project_id: string;
  settings: Record<string, unknown>;
  path: string;
  encoder: string | null;
  status: "running" | "done" | "failed" | "canceled";
  size: number;
  report: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface StructuralIssue {
  code: string;
  severity: "error" | "warning";
  blocking: boolean;
  layer: string | null;
  t: number | null;
  message: string;
  fix: string;
}

export interface NewMotionProject {
  model_id: string;
  title?: string;
  aspect: "9:16" | "1:1" | "16:9" | "4:5" | "custom";
  fps: number;
  duration: number;
  brand?: string | null;
  workspace_id?: string | null;
  working_dir?: string | null;
}

export const listMotionProjects = (workspaceId?: string | null) =>
  request<MotionProjectSummary[]>(`/motion/projects${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`);

export const createMotionProject = (body: NewMotionProject) =>
  request<MotionProject>("/motion/projects", { method: "POST", body: JSON.stringify(body) });

export const getMotionProject = (id: string) => request<MotionProject>(`/motion/projects/${id}`);

export const renameMotionProject = (id: string, title: string) =>
  request<MotionProject>(`/motion/projects/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });

export const deleteMotionProject = (id: string) => request<void>(`/motion/projects/${id}`, { method: "DELETE" });

export const patchMotionScene = (id: string, patch: unknown[], summary: string, note = true) =>
  request<{ version: number; scene: Scene; issues: StructuralIssue[] }>(`/motion/projects/${id}/patch`, {
    method: "POST",
    body: JSON.stringify({ patch, summary, note }),
  });

export const replaceMotionScene = (id: string, scene: Scene, summary: string) =>
  request<{ version: number; scene: Scene }>(`/motion/projects/${id}/scene`, { method: "PUT", body: JSON.stringify({ scene, summary }) });

export const listMotionVersions = (id: string) => request<MotionVersion[]>(`/motion/projects/${id}/versions`);

export const getMotionVersion = (id: string, number: number) =>
  request<{ number: number; scene: Scene; author: string; summary: string }>(`/motion/projects/${id}/versions/${number}`);

export const restoreMotionVersion = (id: string, number: number) =>
  request<MotionProject>(`/motion/projects/${id}/versions/${number}/restore`, { method: "POST" });

export const listMotionAssets = (id: string) => request<MotionAsset[]>(`/motion/projects/${id}/assets`);

export const updateMotionAsset = (assetId: string, body: Partial<Pick<MotionAsset, "width" | "height" | "duration" | "meta">>) =>
  request<MotionAsset>(`/motion/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(body) });

export const deleteMotionAsset = (assetId: string) => request<void>(`/motion/assets/${assetId}`, { method: "DELETE" });

export const getMotionAsset = (assetId: string) => request<MotionAsset>(`/motion/assets/${assetId}`);

export async function uploadMotionAsset(projectId: string, file: File, extra: { width?: number; height?: number; duration?: number } = {}): Promise<MotionAsset> {
  const { baseUrl, token } = await getApiConfig();
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) form.append(k, String(v));
  return tracked(
    fetch(`${baseUrl}/motion/projects/${projectId}/assets`, { method: "POST", body: form, headers: { Authorization: `Bearer ${token}` } }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? res.statusText);
      return res.json() as Promise<MotionAsset>;
    }),
  );
}

export async function motionAssetUrl(assetId: string): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  return `${baseUrl}/motion/assets/${assetId}/file?token=${encodeURIComponent(token)}`;
}

export async function motionRenderUrl(renderId: string): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  return `${baseUrl}/motion/renders/${renderId}/file?token=${encodeURIComponent(token)}`;
}

export const transcribeMotionAsset = (projectId: string, assetId: string, language?: string) =>
  request<{ text: string; words: { w: string; t0: number; t1: number }[] }>(
    `/motion/projects/${projectId}/assets/${assetId}/transcribe${language ? `?language=${language}` : ""}`,
    { method: "POST" },
  );

export const speakMotion = (projectId: string, text: string, voice?: string) =>
  request<MotionAsset>(`/motion/projects/${projectId}/tts`, { method: "POST", body: JSON.stringify({ text, voice }) });

export interface StockItem {
  id: string;
  provider: "unsplash" | "pexels";
  thumb: string;
  url: string;
  width: number;
  height: number;
  credit: string;
  author_url: string;
  license: string;
  alt: string;
}

export const searchStock = (provider: string, query: string, orientation?: string) =>
  request<StockItem[]>("/motion/stock/search", { method: "POST", body: JSON.stringify({ provider, query, orientation }) });

export const addStock = (projectId: string, item: StockItem) =>
  request<MotionAsset>(`/motion/projects/${projectId}/stock`, { method: "POST", body: JSON.stringify(item) });

// ── Renders ─────────────────────────────────────────────────────────────────────────────

export const startMotionRender = (projectId: string, settings: Record<string, unknown>, name?: string) =>
  request<MotionRender>(`/motion/projects/${projectId}/renders`, { method: "POST", body: JSON.stringify({ settings, name }) });

export async function writeMotionChunk(renderId: string, position: number, data: Uint8Array): Promise<void> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/motion/renders/${renderId}/chunk?position=${position}`, {
    method: "PUT",
    body: data as BodyInit,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`write failed: ${res.status}`);
}

export const finishMotionRender = (renderId: string, expect: Record<string, unknown>, encoder: string, extra: Record<string, unknown> = {}) =>
  request<MotionRender>(`/motion/renders/${renderId}/finish`, { method: "POST", body: JSON.stringify({ expect, encoder, extra }) });

export const failMotionRender = (renderId: string, error: string, canceled: boolean) =>
  request<MotionRender>(`/motion/renders/${renderId}/fail`, { method: "POST", body: JSON.stringify({ error, canceled }) });

export const transcodeMotionRender = (renderId: string, settings: Record<string, unknown>, expect: Record<string, unknown>) =>
  request<MotionRender>(`/motion/renders/${renderId}/transcode`, { method: "POST", body: JSON.stringify({ settings, expect }) });

export const listMotionRenders = (projectId: string) => request<MotionRender[]>(`/motion/projects/${projectId}/renders`);

// ── Kits, keys, engine ──────────────────────────────────────────────────────────────────

export const motionKitTemplates = () =>
  request<{ templates: Record<string, BrandKit>; fonts: string[]; default: string }>("/motion/kits");

export const getMotionKit = (workspaceId?: string | null) =>
  request<{ kit: BrandKit; own: boolean }>(`/motion/kit${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`);

export const saveMotionKit = (kit: BrandKit | null, workspaceId?: string | null) =>
  request<{ kit: BrandKit; own: boolean }>("/motion/kit", { method: "PUT", body: JSON.stringify({ kit, workspace_id: workspaceId ?? null }) });

export const motionMediaKeys = () => request<Record<string, boolean>>("/motion/keys");

export const saveMotionMediaKey = (name: string, value: string | null) =>
  request<Record<string, boolean>>("/motion/keys", { method: "PUT", body: JSON.stringify({ name, value }) });

export const motionEngineStatus = () =>
  request<{ connected: boolean; ffmpeg: Record<string, unknown>; local: Record<string, unknown> }>("/motion/engine/status");

export const replyToEngine = (requestId: string, ok: boolean, result?: unknown, error?: string) =>
  request<{ accepted: boolean }>(`/motion/engine/reply/${requestId}`, { method: "POST", body: JSON.stringify({ ok, result, error }) });

export interface EngineRequest {
  id: string;
  kind: "hello" | "lint" | "inspect" | "frames" | "export" | "analyze";
  payload: Record<string, unknown>;
}

/** The engine channel: the agent's requests, one per event, until `signal` aborts. */
export async function listenToEngineRequests(onRequest: (request: EngineRequest) => void, signal: AbortSignal): Promise<void> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/motion/engine/stream`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!res.ok || !res.body) throw new Error(`engine stream: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onRequest(JSON.parse(data) as EngineRequest);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export interface FfmpegStatus {
  installed: boolean;
  version: string | null;
  source: string | null;
  encoders: Record<string, boolean>;
  hevc: string | null;
  h264: string | null;
  download_size: number;
  progress: { state: "idle" | "downloading" | "unpacking" | "testing" | "done" | "failed"; done?: number; total?: number; error?: string };
}

export const ffmpegStatus = () => request<FfmpegStatus>("/motion/ffmpeg");
export const installFfmpeg = () => request<FfmpegStatus>("/motion/ffmpeg/install", { method: "POST" });
export const removeFfmpeg = () => request<void>("/motion/ffmpeg", { method: "DELETE" });
export const makeWorkingCopy = (assetId: string) => request<MotionAsset>(`/motion/assets/${assetId}/working-copy`, { method: "POST" });

// ── Local models (whisper, an Arabic voice), on demand ─────────────────────────────────

export interface LocalPack {
  installed: boolean;
  version: string;
  /** Shown to the user before the download starts. */
  licenses: string[];
  download_size: number;
  progress: { state: "idle" | "downloading" | "unpacking" | "testing" | "done" | "failed"; done?: number; total?: number; file?: string; error?: string };
}

export type LocalPackName = "whisper" | "voice";

export const localModels = () => request<Record<LocalPackName, LocalPack>>("/motion/local");
export const installLocalModel = (pack: LocalPackName) => request<Record<LocalPackName, LocalPack>>(`/motion/local/${pack}/install`, { method: "POST" });
export const removeLocalModel = (pack: LocalPackName) => request<void>(`/motion/local/${pack}`, { method: "DELETE" });
