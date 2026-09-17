/** Workspaces: a project's folder, model and standing instructions. */

import { request } from "./client";
import type { Workspace, WorkspaceInput } from "../types";

export async function listWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>("/workspaces");
}

export async function saveWorkspace(input: WorkspaceInput, id?: string): Promise<Workspace> {
  return request<Workspace>(id ? `/workspaces/${id}` : "/workspaces", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

/** Removes the workspace; its chats, tasks and designs stay (just unassigned). */
export async function deleteWorkspace(id: string): Promise<void> {
  await request<void>(`/workspaces/${id}`, { method: "DELETE" });
}
