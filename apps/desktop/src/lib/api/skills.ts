/** The skills the model reads — bundled ones and the user's own. */

import { request } from "./client";
import type { AgentSkill, SkillInstallResult } from "../types";

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

/** Installs from a URL — a GitHub repo (or folder in one), a raw SKILL.md, or a zip. */
export async function installSkillFromUrl(url: string, name?: string): Promise<SkillInstallResult> {
  return request<SkillInstallResult>("/skills/install", { method: "POST", body: JSON.stringify({ url, name }) });
}

export async function deleteSkill(name: string): Promise<void> {
  await request<void>(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
}
