/** Background tasks: create, watch, cancel, and answer their permission prompts. */

import { getApiConfig } from "../config";
import { request } from "./client";
import type {
  CommitDescription,
  TaskChanges,
  TaskDetail,
  TaskEvent,
  TaskMode,
  TaskStatus,
  TaskSummary,
} from "../types";

import { t } from "../../i18n";
type RawEvent = { id: string; type: string; payload: Record<string, unknown>; created_at: string };

function toTaskEvent(raw: RawEvent): TaskEvent {
  return { id: raw.id, type: raw.type, created_at: raw.created_at, ...raw.payload } as TaskEvent;
}

export async function listTasks(workspaceId?: string | null): Promise<TaskSummary[]> {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return request<TaskSummary[]>(`/tasks${query}`);
}

export async function getTask(id: string): Promise<TaskDetail | undefined> {
  try {
    const raw = await request<Omit<TaskDetail, "events"> & { events: RawEvent[] }>(`/tasks/${id}`);
    return { ...raw, events: raw.events.map(toTaskEvent) };
  } catch {
    return undefined;
  }
}

export async function createTask(input: {
  title: string;
  prompt: string;
  modelId: string;
  workingDir?: string;
  attachmentIds?: string[];
  mode?: TaskMode;
  workspaceId?: string | null;
}): Promise<TaskDetail> {
  const raw = await request<Omit<TaskDetail, "events"> & { events: RawEvent[] }>("/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      prompt: input.prompt,
      model_id: input.modelId,
      working_dir: input.workingDir || undefined,
      attachment_ids: input.attachmentIds ?? [],
      mode: input.mode ?? "auto",
      workspace_id: input.workspaceId ?? null,
    }),
  });
  return { ...raw, events: raw.events.map(toTaskEvent) };
}

/** Plan mode: the user approved the plan (maybe edited) — the task runs it now. */
export async function approveTaskPlan(id: string, plan?: string): Promise<TaskSummary> {
  return request<TaskSummary>(`/tasks/${id}/plan/approve`, { method: "POST", body: JSON.stringify({ plan: plan ?? null }) });
}

export async function rejectTaskPlan(id: string): Promise<TaskSummary> {
  return request<TaskSummary>(`/tasks/${id}/plan/reject`, { method: "POST" });
}

/** A commit message and PR description for the task's applied changes, from its model. */
export async function describeTaskChanges(id: string): Promise<CommitDescription> {
  return request<CommitDescription>(`/tasks/${id}/changes/describe`, { method: "POST" });
}

/** Commits the task's applied changes (only its files) on the user's current branch. */
export async function commitTaskChanges(id: string, message: string): Promise<{ sha: string; files: number }> {
  return request<{ sha: string; files: number }>(`/tasks/${id}/changes/commit`, { method: "POST", body: JSON.stringify({ message }) });
}

export async function deleteTask(id: string): Promise<void> {
  await request<void>(`/tasks/${id}`, { method: "DELETE" });
}

/** What the task changed in its folder (a git repository), with the diff. */
export async function getTaskChanges(id: string): Promise<TaskChanges> {
  return request<TaskChanges>(`/tasks/${id}/changes`);
}

/** Applies a task's changes to the folder; `threeWay` merges and may leave conflict markers. */
export async function applyTaskChanges(id: string, threeWay = false): Promise<TaskChanges> {
  return request<TaskChanges>(`/tasks/${id}/changes/apply?three_way=${threeWay}`, { method: "POST" });
}

/** Takes a task's changes back out of the folder. */
export async function revertTaskChanges(id: string): Promise<TaskChanges> {
  return request<TaskChanges>(`/tasks/${id}/changes/revert`, { method: "POST" });
}

export async function cancelTask(id: string): Promise<void> {
  await request<void>(`/tasks/${id}/cancel`, { method: "POST" });
}

export async function resolvePermission(
  taskId: string,
  eventId: string,
  resolution: "approved" | "denied",
): Promise<void> {
  await request<void>(`/tasks/${taskId}/permission?event_id=${eventId}&resolution=${resolution}`, {
    method: "POST",
  });
}

/** Subscribes to a task's live transcript over the backend's WebSocket. */
export function subscribeTask(id: string, onUpdate: (task: TaskDetail) => void): () => void {
  let closed = false;
  let socket: WebSocket | undefined;
  let current: TaskDetail | undefined;

  getApiConfig().then(({ baseUrl, token }) => {
    if (closed) return;
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}/tasks/${id}/stream?token=${encodeURIComponent(token)}`;
    socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.kind === "snapshot") {
        current = current
          ? { ...current, status: msg.task.status, events: msg.task.events.map(toTaskEvent) }
          : ({ status: msg.task.status, events: msg.task.events.map(toTaskEvent) } as TaskDetail);
      } else if (msg.kind === "event" && current) {
        current = { ...current, events: [...current.events, toTaskEvent(msg.event)] };
      } else if (msg.kind === "event_updated" && current) {
        current = {
          ...current,
          events: current.events.map((e) => (e.id === msg.event.id ? toTaskEvent(msg.event) : e)),
        };
      } else if (msg.kind === "status" && current) {
        current = { ...current, status: msg.status as TaskStatus };
      }
      if (current) onUpdate(current);
    };
  });

  return () => {
    closed = true;
    socket?.close();
  };
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "queued":
      return t("بالدور");
    case "pending":
      return t("بالانتظار");
    case "running":
      return t("شغّال");
    case "planned":
      return t("خطة بانتظارك");
    case "completed":
      return t("مكتمل");
    case "failed":
      return t("فشل");
    case "cancelled":
      return t("أُلغي");
  }
}
