/** The skills the model reads — bundled ones and the user's own. */

import { request } from "./client";
import type { AgentSkill, SkillCheck, SkillFile, SkillInstallResult } from "../types";

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

// ── Writing skills in the app ──────────────────────────────────────────────────────────

const skillPath = (name: string) => `/skills/${encodeURIComponent(name)}`;

/** What's wrong with a SKILL.md, without saving it. */
export async function checkSkill(content: string): Promise<SkillCheck> {
  return request<SkillCheck>("/skills/check", { method: "POST", body: JSON.stringify({ content }) });
}

/** A new skill of the user's from its SKILL.md (refused while the check has errors). */
export async function createSkill(content: string): Promise<AgentSkill> {
  return request<AgentSkill>("/skills/create", { method: "POST", body: JSON.stringify({ content }) });
}

/** The user's own, editable copy of a bundled skill — it takes over the same name. */
export async function copySkill(name: string): Promise<AgentSkill> {
  return request<AgentSkill>(`${skillPath(name)}/copy`, { method: "POST" });
}

export async function listSkillFiles(name: string): Promise<SkillFile[]> {
  return request<SkillFile[]>(`${skillPath(name)}/files`);
}

/** The whole file, untrimmed, for editing. */
export async function readSkillFile(name: string, path: string): Promise<string> {
  const out = await request<{ path: string; content: string }>(`${skillPath(name)}/file?path=${encodeURIComponent(path)}`);
  return out.content;
}

export async function saveSkillFile(name: string, path: string, content: string): Promise<AgentSkill> {
  return request<AgentSkill>(`${skillPath(name)}/file`, { method: "PUT", body: JSON.stringify({ path, content }) });
}

export async function deleteSkillFile(name: string, path: string): Promise<void> {
  await request<void>(`${skillPath(name)}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}
