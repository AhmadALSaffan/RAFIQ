/** The council, the morning radio, and the offers Rafiq makes from what it noticed. */

import { locale } from "../../i18n";
import { getApiConfig } from "../config";
import { readEvents } from "./chats";
import { request } from "./client";

export type CouncilStage = "answer" | "critique" | "verdict";

export type CouncilEvent =
  | { type: "start"; chat_id: string; seats: { id: string; name: string }[] }
  | { type: "stage"; stage: CouncilStage }
  | { type: "chair"; seat: string }
  | { type: "delta"; stage: CouncilStage; seat: string; text: string }
  | { type: "error"; stage: CouncilStage; seat: string; message: string }
  | { type: "failed" }
  | { type: "done"; chat_id: string };

export async function askCouncil(
  question: string,
  modelIds: string[],
  workspaceId: string | null,
  onEvent: (event: CouncilEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/council`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Language": locale() },
    body: JSON.stringify({ question, model_ids: modelIds, workspace_id: workspaceId }),
  });
  await readEvents<CouncilEvent>(res, onEvent);
}

export interface RadioEpisode {
  id: string;
  day: string;
  script: string;
  error: string | null;
  heard_at: string | null;
  created_at: string;
}

export async function getRadioToday(): Promise<{ enabled: boolean; episode: RadioEpisode | null }> {
  return request("/radio/today");
}

export async function makeRadioEpisode(): Promise<RadioEpisode> {
  return request("/radio/make", { method: "POST" });
}

export async function markRadioHeard(id: string): Promise<void> {
  await request<void>(`/radio/${id}/heard`, { method: "POST" });
}

/** The episode as a chat, to ask about it. */
export async function radioChat(id: string): Promise<string> {
  return (await request<{ chat_id: string }>(`/radio/${id}/chat`, { method: "POST" })).chat_id;
}

export interface Suggestion {
  id: string;
  kind: "schedule" | "folder" | "template";
  title: string;
  draft: {
    prompt: string;
    count: number;
    kind?: "daily" | "weekly" | "often";
    hour?: number;
    /** 0 = Monday */
    weekday?: number;
    watch?: string;
    watch_filter?: string;
    to_dir?: string;
  };
  created_at: string;
}

export async function listSuggestions(): Promise<Suggestion[]> {
  return request("/suggestions");
}

export async function refreshSuggestions(): Promise<number> {
  return (await request<{ added: number }>("/suggestions/refresh", { method: "POST" })).added;
}

export async function acceptSuggestion(id: string): Promise<void> {
  await request(`/suggestions/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
}

export async function dismissSuggestion(id: string): Promise<void> {
  await request<void>(`/suggestions/${id}/dismiss`, { method: "POST" });
}

export interface CompareResult {
  first_ms: number | null;
  total_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export type CompareEvent =
  | { type: "start"; seats: { id: string; name: string }[] }
  | { type: "delta"; seat: string; text: string }
  | { type: "error"; seat: string; message: string }
  | ({ type: "finished"; seat: string } & CompareResult)
  | { type: "done" };

export async function compareModels(question: string, modelIds: string[], onEvent: (event: CompareEvent) => void, signal?: AbortSignal): Promise<void> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/compare`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Language": locale() },
    body: JSON.stringify({ question, model_ids: modelIds }),
  });
  await readEvents<CompareEvent>(res, onEvent);
}
