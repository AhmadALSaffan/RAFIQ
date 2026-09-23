import { locale } from "../../i18n";
/** Conversations, their settings, and the streaming send. */

import { getApiConfig } from "../config";
import { request } from "./client";
import type { ChatDetail, ChatMessage, ChatSearchResult, ChatSummary, ReplySettings, Resolution, SummarizeResult, TaskStatus, ToolCall } from "../types";

/** Chats whose messages or titles hold every word of `q`; Arabic is folded on the agent. */
export async function searchChats(q: string, workspaceId?: string | null, signal?: AbortSignal): Promise<ChatSearchResult[]> {
  const params = new URLSearchParams({ q });
  if (workspaceId) params.set("workspace_id", workspaceId);
  return request<ChatSearchResult[]>(`/chats/search?${params}`, { signal });
}

export async function listChats(workspaceId?: string | null): Promise<ChatSummary[]> {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return request<ChatSummary[]>(`/chats${query}`);
}

export async function createChat(modelId?: string, workingDir?: string | null, workspaceId?: string | null): Promise<ChatDetail> {
  return request<ChatDetail>("/chats", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId, working_dir: workingDir || undefined, workspace_id: workspaceId ?? null }),
  });
}

/** The whole chat as one file to share: self-contained HTML (both themes) or Markdown. */
export async function exportChat(id: string, format: "html" | "md"): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/chats/${id}/export?format=${format}`, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": locale() },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.text();
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

/** Drops a message and everything after it — how editing a question starts. */
export async function truncateChatFrom(chatId: string, messageId: string): Promise<ChatDetail> {
  return request<ChatDetail>(`/chats/${chatId}/messages/${messageId}/truncate`, { method: "POST" });
}

/** Copies the chat up to a message into a new one (leaving this one untouched). */
export async function forkChat(chatId: string, untilMessageId?: string): Promise<ChatDetail> {
  return request<ChatDetail>(`/chats/${chatId}/fork`, {
    method: "POST",
    body: JSON.stringify({ until_message_id: untilMessageId ?? null }),
  });
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
  | { type: "usage"; prompt_tokens: number; completion_tokens: number; cached_tokens: number; cost_usd: number }
  | { type: "done"; message: ChatMessage }
  | { type: "stopped" }
  | { type: "error"; message: string };

/**
 * Sends a message and streams the reply (Server-Sent Events over fetch). Aborting `signal`
 * only stops *watching*: the reply keeps being written on the agent, and
 * `attachChatStream` picks it up again. `stopChat` is what stops it.
 */
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
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Language": locale() },
    body: JSON.stringify({ content, model_id: modelId, attachment_ids: attachmentIds }),
  });
  await readEvents(res, onEvent);
}

/**
 * Rejoins the reply being written in a chat, replaying it from its first event.
 * Resolves `false` when the chat has no reply in progress.
 */
export async function attachChatStream(
  chatId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/chats/${chatId}/stream`, {
    cache: "no-store",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": locale() },
  });
  if (res.status === 204) return false;
  await readEvents(res, onEvent);
  return true;
}

/** Stops the reply being written; what it wrote so far is kept. */
export async function stopChat(chatId: string): Promise<boolean> {
  const out = await request<{ stopped: boolean }>(`/chats/${chatId}/stop`, { method: "POST" });
  return out.stopped;
}

async function readEvents(res: Response, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
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
