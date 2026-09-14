/** The skills the model reads — bundled ones and the user's own. */

import { request } from "./client";
import type {
  AgentSkill,
} from "../types";

export async function listSkills(): Promise<AgentSkill[]> {
  return request<AgentSkill[]>("/skills");
}

export async function readSkill(name: string, file?: string): Promise<{ name: string; file: string; content: string }> {
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return request<{ name: string; file: string; content: string }>(`/skills/${encodeURIComponent(name)}${query}`);
}

/** Adds one of the user's own skills — a folder on disk, or pasted markdown. */
export async function addSkill(body: { path?: string; name?: string; content?: string }): Promise<AgentSkill> {
  return request<AgentSkill>("/skills", { method: "POST", body: JSON.stringify(body) });
}

export async function deleteSkill(name: string): Promise<void> {
  await request<void>(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
}
