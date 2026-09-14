/** Issue trackers (Jira, Linear, GitHub, GitLab) and the issues they return. */

import { request } from "./client";
import type {
  StatusOption,
  IntegrationAccount,
  IntegrationProvider,
  TrackerIssue,
  TrackerIssueDetail,
} from "../types";

export async function listIntegrationProviders(): Promise<IntegrationProvider[]> {
  return request<IntegrationProvider[]>("/integrations/providers");
}

export async function listIntegrations(): Promise<IntegrationAccount[]> {
  return request<IntegrationAccount[]>("/integrations");
}

export async function connectIntegration(input: {
  provider: string;
  name?: string;
  config: Record<string, string>;
}): Promise<IntegrationAccount> {
  return request<IntegrationAccount>("/integrations", { method: "POST", body: JSON.stringify(input) });
}

export async function verifyIntegration(id: string): Promise<IntegrationAccount> {
  return request<IntegrationAccount>(`/integrations/${id}/verify`, { method: "POST" });
}

export async function disconnectIntegration(id: string): Promise<void> {
  await request<void>(`/integrations/${id}`, { method: "DELETE" });
}

export async function listIssues(query = "", limit = 30, includeDone = false): Promise<TrackerIssue[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("query", query);
  if (includeDone) params.set("include_done", "true");
  return request<TrackerIssue[]>(`/integrations/issues?${params}`);
}

export async function getIssue(integrationId: string, key: string): Promise<TrackerIssueDetail> {
  return request<TrackerIssueDetail>(`/integrations/${integrationId}/issues/${encodeURIComponent(key)}`);
}

export async function commentOnIssue(integrationId: string, key: string, body: string): Promise<void> {
  await request<void>(`/integrations/${integrationId}/issues/${encodeURIComponent(key)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function completeIssue(integrationId: string, key: string, comment?: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/integrations/${integrationId}/issues/${encodeURIComponent(key)}/complete`, {
    method: "POST",
    body: JSON.stringify({ comment: comment || null }),
  });
}

/** What this issue can move to right now. Empty when the tracker offers no choice. */
export async function listIssueStatuses(integrationId: string, key: string): Promise<StatusOption[]> {
  return request<StatusOption[]>(`/integrations/${integrationId}/issues/${encodeURI(key)}/statuses`);
}

export async function setIssueStatus(
  integrationId: string,
  key: string,
  statusId: string,
  comment?: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(`/integrations/${integrationId}/issues/${encodeURI(key)}/status`, {
    method: "POST",
    body: JSON.stringify({ status_id: statusId, comment }),
  });
}
