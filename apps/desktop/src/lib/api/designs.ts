/** Design sessions: the brief, the preview, and the handoff to a build session. */

import { request } from "./client";
import type {
  Design,
  DesignDocument,
  DesignSummary,
  HandoffResult,
  InitQuestion,
} from "../types";

export async function initQuestions(): Promise<InitQuestion[]> {
  return request<InitQuestion[]>("/designs/questions");
}

export async function listDesigns(workspaceId?: string | null): Promise<DesignSummary[]> {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return request<DesignSummary[]>(`/designs${query}`);
}

export async function getDesign(id: string): Promise<Design> {
  return request<Design>(`/designs/${id}`);
}

export async function createDesign(
  modelId: string,
  brief: Record<string, string | string[]>,
  workingDir?: string | null,
  title?: string,
  /** Rafiq's search tool for the design chat (null = decide by the model). */
  webSearch?: boolean | null,
  workspaceId?: string | null,
): Promise<Design> {
  return request<Design>("/designs", {
    method: "POST",
    body: JSON.stringify({
      model_id: modelId,
      brief,
      title,
      working_dir: workingDir ?? null,
      web_search: webSearch ?? null,
      workspace_id: workspaceId ?? null,
    }),
  });
}

/** Everything the preview can open, in the order the switcher shows it. */
export async function listDesignDocuments(id: string): Promise<DesignDocument[]> {
  return request<DesignDocument[]>(`/designs/${id}/documents`);
}

/** One HTML file from the design's folder (documents from the chat come with the design). */
export async function readDesignDocument(id: string, path: string): Promise<{ name: string; html: string }> {
  return request<{ name: string; html: string }>(`/designs/${id}/documents/read?path=${encodeURIComponent(path)}`);
}

export async function setDesignFolder(id: string, workingDir: string | null): Promise<Design> {
  return request<Design>(`/designs/${id}`, { method: "PATCH", body: JSON.stringify({ working_dir: workingDir ?? "" }) });
}

export async function renameDesign(id: string, title: string): Promise<Design> {
  return request<Design>(`/designs/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export async function deleteDesign(id: string): Promise<void> {
  await request<void>(`/designs/${id}`, { method: "DELETE" });
}

/** Sends the finished design to the session (or task) that will build it. */
export async function handoffDesign(
  id: string,
  body: { target: "chat" | "task"; chat_id?: string; model_id?: string; working_dir?: string },
): Promise<HandoffResult> {
  return request<HandoffResult>(`/designs/${id}/handoff`, { method: "POST", body: JSON.stringify(body) });
}
