/** Issue trackers and git hosts (Jira, Linear, GitHub, GitLab, Azure DevOps, Trello, Asana,
 *  ClickUp, YouTrack, Bitbucket, Gitea, Plane), their issues, and everything around them:
 *  notices, the log of what Rafiq changed, and team channels. */

import { getApiConfig } from "../config";
import { locale } from "../../i18n";
import { request } from "./client";
import type {
  BulkResult,
  DeviceSignIn,
  DevLink,
  IntegrationAccount,
  IntegrationAction,
  IntegrationProvider,
  IntegrationSettings,
  IssueMeta,
  IssueNotice,
  IssueProject,
  NotifyChannel,
  StatusOption,
  TrackerIssue,
  TrackerIssueDetail,
} from "../types";

// Keys hold "/" and "#" (owner/repo#7): "#" must be escaped or the browser cuts the URL there.
const issuePath = (integrationId: string, key: string) => `/integrations/${integrationId}/issues/${encodeURIComponent(key).replace(/%2F/gi, "/")}`;

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

export async function editIntegration(id: string, input: { name?: string; config?: Record<string, string> }): Promise<IntegrationAccount> {
  return request<IntegrationAccount>(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function saveIntegrationSettings(id: string, settings: IntegrationSettings): Promise<IntegrationAccount> {
  return request<IntegrationAccount>(`/integrations/${id}/settings`, { method: "PUT", body: JSON.stringify(settings) });
}

export async function verifyIntegration(id: string): Promise<IntegrationAccount> {
  return request<IntegrationAccount>(`/integrations/${id}/verify`, { method: "POST" });
}

export async function disconnectIntegration(id: string): Promise<void> {
  await request<void>(`/integrations/${id}`, { method: "DELETE" });
}

/** Device sign-in (GitHub / GitLab): a code to enter on the provider's page. */
export async function startDeviceSignIn(input: { provider: "github" | "gitlab"; client_id: string; base_url?: string; name?: string }): Promise<DeviceSignIn> {
  return request<DeviceSignIn>("/integrations/oauth/start", { method: "POST", body: JSON.stringify(input) });
}

export async function pollDeviceSignIn(flowId: string): Promise<{ status: "pending" | "slow_down" | "done" | "expired" | "denied"; integration?: IntegrationAccount }> {
  return request("/integrations/oauth/poll", { method: "POST", body: JSON.stringify({ flow_id: flowId }) });
}

// ── Lists ─────────────────────────────────────────────────────────────────────────────

export async function listIssues(query = "", limit = 60, includeDone = false, integrationId?: string): Promise<TrackerIssue[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("query", query);
  if (includeDone) params.set("include_done", "true");
  if (integrationId) params.set("integration_id", integrationId);
  return request<TrackerIssue[]>(`/integrations/issues?${params}`);
}

export async function listReviewRequests(): Promise<TrackerIssue[]> {
  return request<TrackerIssue[]>("/integrations/reviews");
}

export async function searchIssues(integrationId: string, q: string, limit = 50): Promise<TrackerIssue[]> {
  return request<TrackerIssue[]>(`/integrations/${integrationId}/search?${new URLSearchParams({ q, limit: String(limit) })}`);
}

export async function sprintIssues(integrationId: string, project?: string, mine = false): Promise<{ name: string | null; issues: TrackerIssue[] }> {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (mine) params.set("mine", "true");
  return request(`/integrations/${integrationId}/sprint?${params}`);
}

export async function runSavedView(integrationId: string, viewId: string): Promise<TrackerIssue[]> {
  return request<TrackerIssue[]>(`/integrations/${integrationId}/views/${viewId}`);
}

export async function listIssueProjects(integrationId: string): Promise<IssueProject[]> {
  return request<IssueProject[]>(`/integrations/${integrationId}/projects`);
}

export async function issueMeta(integrationId: string, project?: string): Promise<IssueMeta> {
  const params = project ? `?${new URLSearchParams({ project })}` : "";
  return request<IssueMeta>(`/integrations/${integrationId}/meta${params}`);
}

// ── One issue ───────────────────────────────────────────────────────────────────────────

export async function getIssue(integrationId: string, key: string): Promise<TrackerIssueDetail> {
  return request<TrackerIssueDetail>(issuePath(integrationId, key));
}

export async function issueDevLinks(integrationId: string, key: string): Promise<DevLink[]> {
  return request<DevLink[]>(`${issuePath(integrationId, key)}/dev`);
}

export async function createIssue(
  integrationId: string,
  input: {
    project: string;
    title: string;
    description?: string;
    issue_type?: string | null;
    labels?: string[];
    assignee?: string | null;
    priority?: string | null;
    due_date?: string | null;
    parent?: string | null;
    estimate_hours?: number | null;
  },
): Promise<TrackerIssue> {
  return request<TrackerIssue>(`/integrations/${integrationId}/issues`, { method: "POST", body: JSON.stringify(input) });
}

export async function updateIssue(
  integrationId: string,
  key: string,
  changes: Partial<{
    title: string;
    description: string;
    labels: string[];
    add_labels: string[];
    remove_labels: string[];
    assignee: string;
    priority: string;
    due_date: string;
    estimate_hours: number;
    parent: string;
  }>,
): Promise<TrackerIssue> {
  return request<TrackerIssue>(issuePath(integrationId, key), { method: "PATCH", body: JSON.stringify(changes) });
}

export async function commentOnIssue(integrationId: string, key: string, body: string): Promise<void> {
  await request<void>(`${issuePath(integrationId, key)}/comment`, { method: "POST", body: JSON.stringify({ body }) });
}

export async function editIssueComment(integrationId: string, key: string, commentId: string, body: string): Promise<void> {
  await request<void>(`${issuePath(integrationId, key)}/comments/${encodeURIComponent(commentId)}`, { method: "PUT", body: JSON.stringify({ body }) });
}

export async function deleteIssueComment(integrationId: string, key: string, commentId: string): Promise<void> {
  await request<void>(`${issuePath(integrationId, key)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}

export async function completeIssue(integrationId: string, key: string, comment?: string): Promise<{ status: string }> {
  return request<{ status: string }>(`${issuePath(integrationId, key)}/complete`, {
    method: "POST",
    body: JSON.stringify({ comment: comment || null }),
  });
}

/** What this issue can move to right now. Empty when the tracker offers no choice. */
export async function listIssueStatuses(integrationId: string, key: string): Promise<StatusOption[]> {
  return request<StatusOption[]>(`${issuePath(integrationId, key)}/statuses`);
}

export async function setIssueStatus(integrationId: string, key: string, statusId: string, comment?: string): Promise<{ status: string }> {
  return request<{ status: string }>(`${issuePath(integrationId, key)}/status`, {
    method: "POST",
    body: JSON.stringify({ status_id: statusId, comment }),
  });
}

export async function linkIssues(integrationId: string, key: string, other: string, kind: "relates" | "blocks" | "blocked_by" | "duplicates"): Promise<void> {
  await request<void>(`${issuePath(integrationId, key)}/link`, { method: "POST", body: JSON.stringify({ other, kind }) });
}

export async function logIssueWork(integrationId: string, key: string, minutes: number, note = ""): Promise<void> {
  await request<void>(`${issuePath(integrationId, key)}/worklog`, { method: "POST", body: JSON.stringify({ minutes, note }) });
}

/** Uploads a file the user picked or dropped (multipart, not JSON). */
export async function attachToIssue(integrationId: string, key: string, file: File): Promise<{ url: string | null }> {
  const { baseUrl, token } = await getApiConfig();
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${baseUrl}${issuePath(integrationId, key)}/attach`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": locale() },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error((detail && (detail.detail as string)) || response.statusText);
  }
  return response.json();
}

export async function bulkIssues(
  items: { integration_id: string; key: string }[],
  action: "complete" | "status" | "comment" | "assign_me" | "add_label" | "remove_label" | "unassign",
  value?: string,
): Promise<BulkResult[]> {
  return request<BulkResult[]>("/integrations/bulk", { method: "POST", body: JSON.stringify({ items, action, value }) });
}

// ── What Rafiq changed ───────────────────────────────────────────────────────────────────

export async function listIntegrationActions(filter: { integrationId?: string; key?: string; limit?: number } = {}): Promise<IntegrationAction[]> {
  const params = new URLSearchParams({ limit: String(filter.limit ?? 100) });
  if (filter.integrationId) params.set("integration_id", filter.integrationId);
  if (filter.key) params.set("key", filter.key);
  return request<IntegrationAction[]>(`/integrations/actions?${params}`);
}

export async function undoIntegrationAction(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/integrations/actions/${id}/undo`, { method: "POST" });
}

// ── Notices ───────────────────────────────────────────────────────────────────────────────

export async function listNotices(opts: { unreadOnly?: boolean; limit?: number; after?: string } = {}): Promise<IssueNotice[]> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.unreadOnly) params.set("unread_only", "true");
  if (opts.after) params.set("after", opts.after);
  return request<IssueNotice[]>(`/integrations/notices?${params}`);
}

export async function markNoticesRead(ids: string[] | "all"): Promise<void> {
  await request<void>("/integrations/notices/read", {
    method: "POST",
    body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
  });
}

export async function pollTrackers(): Promise<{ new: number }> {
  return request<{ new: number }>("/integrations/poll", { method: "POST" });
}

// ── Team channels ────────────────────────────────────────────────────────────────────────

export async function listChannels(): Promise<NotifyChannel[]> {
  return request<NotifyChannel[]>("/integrations/channels");
}

export async function addChannel(input: { kind: NotifyChannel["kind"]; name: string; url: string; events: string[] }): Promise<NotifyChannel> {
  return request<NotifyChannel>("/integrations/channels", { method: "POST", body: JSON.stringify(input) });
}

export async function editChannel(id: string, input: { kind: NotifyChannel["kind"]; name: string; url?: string; events: string[] }): Promise<NotifyChannel> {
  return request<NotifyChannel>(`/integrations/channels/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export async function removeChannel(id: string): Promise<void> {
  await request<void>(`/integrations/channels/${id}`, { method: "DELETE" });
}

export async function testChannel(id: string): Promise<void> {
  await request<void>(`/integrations/channels/${id}/test`, { method: "POST" });
}
