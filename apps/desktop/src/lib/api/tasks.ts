/** Background tasks: create, watch, cancel, and answer their permission prompts. */

import { getApiConfig } from "../config";
import { request } from "./client";
import type {
  TaskDetail,
  TaskEvent,
  TaskStatus,
  TaskSummary,
} from "../types";

import { t } from "../../i18n";
type RawEvent = { id: string; type: string; payload: Record<string, unknown>; created_at: string };

function toTaskEvent(raw: RawEvent): TaskEvent {
  return { id: raw.id, type: raw.type, created_at: raw.created_at, ...raw.payload } as TaskEvent;
}

export async function listTasks(): Promise<TaskSummary[]> {
  return request<TaskSummary[]>("/tasks");
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
}): Promise<TaskDetail> {
  const raw = await request<Omit<TaskDetail, "events"> & { events: RawEvent[] }>("/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      prompt: input.prompt,
      model_id: input.modelId,
      working_dir: input.workingDir || undefined,
      attachment_ids: input.attachmentIds ?? [],
    }),
  });
  return { ...raw, events: raw.events.map(toTaskEvent) };
}

export async function deleteTask(id: string): Promise<void> {
  await request<void>(`/tasks/${id}`, { method: "DELETE" });
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
    case "completed":
      return t("مكتمل");
    case "failed":
      return t("فشل");
    case "cancelled":
      return t("أُلغي");
  }
}
