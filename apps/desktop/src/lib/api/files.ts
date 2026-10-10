/** Files inside a session's folder, and where unhomed sessions keep theirs. */

import { request } from "./client";
import { getApiConfig } from "../config";
import type {
  WorkspaceFile,
} from "../types";

export async function listWorkspaceFiles(dir: string, query = "", limit = 60): Promise<WorkspaceFile[]> {
  const params = new URLSearchParams({ dir, limit: String(limit) });
  if (query) params.set("query", query);
  return request<WorkspaceFile[]>(`/files?${params}`);
}

/** Whether a folder is in a git repository, and the branch checked out there. */
export async function gitInfo(dir: string): Promise<{ repo: boolean; branch: string | null }> {
  return request(`/files/git?${new URLSearchParams({ dir })}`);
}

/** The folder Rafiq uses for sessions that have no folder of their own. */
export async function getWorkspace(): Promise<string> {
  const out = await request<{ path: string }>("/workspace");
  return out.path;
}

export interface FilePreview {
  path: string;
  name: string;
  size: number;
  kind: "text" | "markdown" | "html" | "image" | "pdf" | "binary";
  text?: string;
  truncated?: boolean;
}

/** A file the model wrote, ready to show: text as text, everything else by its raw URL. */
export async function previewFile(dir: string, path: string): Promise<FilePreview> {
  return request<FilePreview>(`/files/preview?${new URLSearchParams({ dir, path })}`);
}

/** The file itself, for an <img> or <iframe> (they can't send the Authorization header). */
export async function rawFileUrl(dir: string, path: string, version = ""): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  return `${baseUrl}/files/raw?${new URLSearchParams({ dir, path, token, v: version })}`;
}
