/** Conversations, their settings, and the streaming send. */

import { getApiConfig } from "../config";
import { request } from "./client";
import type {
  ChatDetail,
  ChatMessage,
  ChatSummary,
  ReplySettings,
  Resolution,
  SummarizeResult,
  TaskStatus,
  ToolCall,
} from "../types";

export async function listChats(): Promise<ChatSummary[]> {
  return request<ChatSummary[]>("/chats");
}

export async function createChat(modelId?: string, workingDir?: string | null): Promise<ChatDetail> {
  return request<ChatDetail>("/chats", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId, working_dir: workingDir || undefined }),
  });
}

export async function setChatFolder(id: string, workingDir: string | null): Promise<ChatSummary> {
  return request<ChatSummary>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ working_dir: workingDir ?? "" }) });
}

export async function resolveChatPermission(chatId: string, requestId: string, resolution: "approved" | "denied"): Promise<void> {
  await request<void>(`/chats/${chatId}/permissions/${requestId}?resolution=${resolution}`, { method: "POST" });
}

export async function getChat(id: string): Promise<ChatDetail> {
  return request<ChatDetail>(`/chats/${id}`);
}

export async function renameChat(id: string, title: string): Promise<ChatSummary> {
  return request<ChatSummary>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export async function setChatPinned(id: string, pinned: boolean): Promise<ChatSummary> {
  return request<ChatSummary>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ pinned }) });
}

export async function updateChatSettings(id: string, settings: ReplySettings): Promise<ChatSummary> {
  return request<ChatSummary>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ settings }) });
}

/** Folds the older turns into a summary so later messages stop resending the whole history. */
export async function summarizeChat(id: string, modelId: string, keep = 4): Promise<SummarizeResult> {
  return request<SummarizeResult>(`/chats/${id}/summarize`, {
    method: "POST",
    body: JSON.stringify({ model_id: modelId, keep }),
  });
}

export async function deleteChatMessage(chatId: string, messageId: string): Promise<void> {
  await request<void>(`/chats/${chatId}/messages/${messageId}`, { method: "DELETE" });
}

export async function deleteChat(id: string): Promise<void> {
  await request<void>(`/chats/${id}`, { method: "DELETE" });
}

export type ChatStreamEvent =
  | { type: "start"; user_message: ChatMessage; title: string }
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool_call"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "permission"; id: string; call: ToolCall }
  | { type: "permission_resolved"; id: string; resolution: Resolution }
  | { type: "task_created"; task: { id: string; title: string; status: TaskStatus } }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

/** Sends a message and streams the reply (Server-Sent Events over fetch). Abort via `signal`. */
export async function sendChatMessage(
  chatId: string,
  content: string,
  modelId: string,
  attachmentIds: string[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/chats/${chatId}/messages`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content, model_id: modelId, attachment_ids: attachmentIds }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as ChatStreamEvent);
      boundary = buffer.indexOf("\n\n");
    }
  }
}
