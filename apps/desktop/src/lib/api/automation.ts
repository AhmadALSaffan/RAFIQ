/** Task templates, schedules, and MCP servers. */

import { request } from "./client";
import type { CatalogTemplate, McpConnectResult, McpRequirements, McpServer, McpServerInput, Schedule, ScheduleInput, TaskTemplate } from "../types";

export async function listTemplates(): Promise<TaskTemplate[]> {
  return request<TaskTemplate[]>("/templates");
}

export async function saveTemplate(
  input: { name: string; prompt: string; model_id?: string | null; working_dir?: string | null },
  id?: string,
): Promise<TaskTemplate> {
  return request<TaskTemplate>(id ? `/templates/${id}` : "/templates", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await request<void>(`/templates/${id}`, { method: "DELETE" });
}

/** Community templates — the latest list from the repository, or the copy shipped with the app. */
export async function templateCatalog(): Promise<{ source: "remote" | "bundled"; templates: CatalogTemplate[] }> {
  return request("/templates/catalog");
}

/** The user's templates as a shareable list (names and prompts only). */
export async function exportTemplates(): Promise<{ name: string; prompt: string }[]> {
  return request("/templates/export");
}

/** Adds templates from a JSON URL or a list; names already present are skipped. */
export async function importTemplates(body: { url?: string; templates?: { name: string; prompt: string }[] }): Promise<TaskTemplate[]> {
  return request<TaskTemplate[]>("/templates/import", { method: "POST", body: JSON.stringify(body) });
}

export async function listSchedules(): Promise<Schedule[]> {
  return request<Schedule[]>("/schedules");
}

export async function saveSchedule(input: ScheduleInput, id?: string): Promise<Schedule> {
  return request<Schedule>(id ? `/schedules/${id}` : "/schedules", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  await request<void>(`/schedules/${id}`, { method: "DELETE" });
}

export async function runScheduleNow(id: string): Promise<string> {
  const out = await request<{ task_id: string }>(`/schedules/${id}/run`, { method: "POST" });
  return out.task_id;
}

/** Which runtimes the preset MCP servers need (node/npx, uvx, docker) are installed. */
export async function mcpRequirements(): Promise<McpRequirements> {
  return request<McpRequirements>("/mcp/requirements");
}

export async function listMcpServers(): Promise<McpServer[]> {
  return request<McpServer[]>("/mcp");
}

export async function saveMcpServer(input: McpServerInput, id?: string): Promise<McpServer> {
  return request<McpServer>(id ? `/mcp/${id}` : "/mcp", { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
}

export async function deleteMcpServer(id: string): Promise<void> {
  await request<void>(`/mcp/${id}`, { method: "DELETE" });
}

/** Starts connecting. An OAuth server that isn't authorized yet answers with the page to
 *  open; the connection then completes on its own — watch `listMcpServers()`. */
export async function connectMcpServer(id: string): Promise<McpConnectResult> {
  return request<McpConnectResult>(`/mcp/${id}/connect`, { method: "POST" });
}

/** Forgets an OAuth server's tokens; the next connect asks the user again. */
export async function logoutMcpServer(id: string): Promise<McpServer> {
  return request<McpServer>(`/mcp/${id}/logout`, { method: "POST" });
}

/** Connects now and lists the server's tools; throws with the reason when it can't. */
export async function testMcpServer(id: string): Promise<McpServer> {
  return request<McpServer>(`/mcp/${id}/test`, { method: "POST" });
}
