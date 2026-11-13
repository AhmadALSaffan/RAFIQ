/** App-wide settings (permission policy, tasks, tools, background). */

import { request } from "./client";
import type { AppSettings, CitationDetail, KnowledgeBase, WebSearchKeys } from "../types";

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

/** How far the knowledge folder has been read (core/knowledge.py on the agent). */
export interface KnowledgeStatus {
  files: number;
  passages: number;
  /** Files with no text to read, usually scanned PDFs. */
  unread: string[];
  scanning: boolean;
  last_scan: string | null;
  error: string | null;
  /** Scanned PDFs the vision model has read (agent core/ocr.py). */
  scanned?: number;
  reading_scans?: boolean;
}

export async function getKnowledgeStatus(): Promise<KnowledgeStatus> {
  return request<KnowledgeStatus>("/settings/knowledge");
}

export async function rescanKnowledge(): Promise<void> {
  await request<void>("/settings/knowledge/rescan", { method: "POST" });
}

export async function clearKnowledge(): Promise<void> {
  await request<void>("/settings/knowledge", { method: "DELETE" });
}

/** How a code editor starts Rafiq as its agent over ACP (agent rafiq_agent/acp.py). */
export interface AcpCommand {
  command: string;
  args: string[];
  zed: Record<string, unknown>;
}

export async function getAcpCommand(): Promise<AcpCommand> {
  return request<AcpCommand>("/settings/acp");
}

// ── An agent's knowledge base (agent api/agent_knowledge.py) ────────────────────────────

const kb = (agentId: string) => `/settings/knowledge-bases/agents/${encodeURIComponent(agentId)}`;

export async function getKnowledgeBase(agentId: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(kb(agentId));
}

export async function attachKnowledgeFolder(agentId: string, path: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`${kb(agentId)}/sources`, { method: "POST", body: JSON.stringify({ path }) });
}

export async function detachKnowledgeFolder(agentId: string, sourceId: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`${kb(agentId)}/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
}

export async function refreshKnowledgeFolder(agentId: string, sourceId: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`${kb(agentId)}/sources/${encodeURIComponent(sourceId)}/refresh`, { method: "POST" });
}

/** The cited passage, if this agent may still read it (404 otherwise). */
export async function getCitation(agentId: string, citationId: string): Promise<CitationDetail> {
  return request<CitationDetail>(`${kb(agentId)}/citations/${encodeURIComponent(citationId)}`);
}

/** Opens the cited file: in VS Code at the line when it's installed, else the default app. */
export async function openCitation(agentId: string, citationId: string): Promise<{ opened: "editor" | "default"; line: number | null }> {
  return request(`${kb(agentId)}/citations/${encodeURIComponent(citationId)}/open`, { method: "POST" });
}
