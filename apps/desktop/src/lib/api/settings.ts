/** App-wide settings (permission policy, tasks, tools, background). */

import { request } from "./client";
import type { AppSettings, WebSearchKeys } from "../types";

export async function getSettings(): Promise<AppSettings> {
  return request<AppSettings>("/settings");
}

export async function updateSettings(next: AppSettings): Promise<AppSettings> {
  return request<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(next) });
}

/** Which web-search services have a key saved (never the keys). */
export async function getWebSearchKeys(): Promise<WebSearchKeys> {
  return request<WebSearchKeys>("/settings/web-search");
}

/** Saves a search key in the keychain; an empty key removes it. */
export async function saveWebSearchKey(provider: "brave" | "tavily", key: string): Promise<WebSearchKeys> {
  return request<WebSearchKeys>("/settings/web-search", { method: "PUT", body: JSON.stringify({ provider, key }) });
}

/** How far the index of the user's files has got (core/file_index.py on the agent). */
export interface FileSearchStatus {
  files: number;
  scanning: boolean;
  last_scan: string | null;
  error: string | null;
  folders: string[];
}

export async function getFileSearchStatus(): Promise<FileSearchStatus> {
  return request<FileSearchStatus>("/settings/file-search");
}

export async function rescanFiles(): Promise<void> {
  await request<void>("/settings/file-search/rescan", { method: "POST" });
}

export async function clearFileIndex(): Promise<void> {
  await request<void>("/settings/file-search", { method: "DELETE" });
}
