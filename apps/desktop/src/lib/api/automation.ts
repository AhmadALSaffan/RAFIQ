/** Task templates, schedules, and MCP servers. */

import { request } from "./client";
import type { McpServer, McpServerInput, Schedule, ScheduleInput, TaskTemplate } from "../types";

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

export async function listMcpServers(): Promise<McpServer[]> {
  return request<McpServer[]>("/mcp");
}

export async function saveMcpServer(input: McpServerInput, id?: string): Promise<McpServer> {
  return request<McpServer>(id ? `/mcp/${id}` : "/mcp", { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
}

export async function deleteMcpServer(id: string): Promise<void> {
  await request<void>(`/mcp/${id}`, { method: "DELETE" });
}

/** Connects now and lists the server's tools; throws with the reason when it can't. */
export async function testMcpServer(id: string): Promise<McpServer> {
  return request<McpServer>(`/mcp/${id}/test`, { method: "POST" });
}
