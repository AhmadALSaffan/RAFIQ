/** What Rafiq remembers across chats — the user sees and controls every entry. */

import { request } from "./client";
import type { Memory } from "../types";

export async function listMemories(): Promise<Memory[]> {
  return request<Memory[]>("/memories");
}

export async function addMemory(text: string, kind = "fact"): Promise<Memory> {
  return request<Memory>("/memories", { method: "POST", body: JSON.stringify({ text, kind }) });
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, "text" | "kind" | "enabled">>): Promise<Memory> {
  return request<Memory>(`/memories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteMemory(id: string): Promise<void> {
  await request<void>(`/memories/${id}`, { method: "DELETE" });
}

export async function clearMemories(): Promise<void> {
  await request<void>("/memories", { method: "DELETE" });
}
