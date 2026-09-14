/** Files inside a session's folder, and where unhomed sessions keep theirs. */

import { request } from "./client";
import type {
  WorkspaceFile,
} from "../types";

export async function listWorkspaceFiles(dir: string, query = "", limit = 60): Promise<WorkspaceFile[]> {
  const params = new URLSearchParams({ dir, limit: String(limit) });
  if (query) params.set("query", query);
  return request<WorkspaceFile[]>(`/files?${params}`);
}

/** The folder Rafiq uses for sessions that have no folder of their own. */
export async function getWorkspace(): Promise<string> {
  const out = await request<{ path: string }>("/workspace");
  return out.path;
}
