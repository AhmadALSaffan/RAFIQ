/** Spending, the diagnostics report, and the logs. */

import { errorText, request } from "./client";
import { getApiConfig } from "../config";
import { locale } from "../../i18n";
import type { Diagnostics, LogInfo, LogOut, UsageSource, UsageSummary } from "../types";

export async function getUsage(days = 30): Promise<UsageSummary> {
  return request<UsageSummary>(`/usage?days=${days}`);
}

/** Which part of the usage an export covers: a day range (YYYY-MM-DD, inclusive), a model, a chat or task. */
export interface UsageFilter {
  since?: string;
  until?: string;
  modelRef?: string;
  source?: string;
}

function usageQuery(filter: UsageFilter): string {
  const query = new URLSearchParams();
  if (filter.since) query.set("since", filter.since);
  if (filter.until) query.set("until", filter.until);
  if (filter.modelRef) query.set("model_ref", filter.modelRef);
  if (filter.source) query.set("source", filter.source);
  return query.toString();
}

/** The chats and tasks that made calls in the period, most expensive first. */
export async function getUsageSources(filter: UsageFilter): Promise<UsageSource[]> {
  return request<UsageSource[]>(`/usage/sources?${usageQuery({ since: filter.since, until: filter.until })}`);
}

/** Every call in the filter, as CSV text (with the byte-order mark Excel needs for Arabic). */
export async function exportUsage(filter: UsageFilter): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/usage/export?${usageQuery(filter)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": locale() },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errorText(detail?.detail) ?? `HTTP ${res.status}`);
  }
  return res.text();
}

export async function getDiagnostics(): Promise<Diagnostics> {
  return request<Diagnostics>("/diagnostics");
}

export async function listLogs(): Promise<LogInfo[]> {
  return request<LogInfo[]>("/logs");
}

/** The last `lines` lines of one log — secrets already masked by the agent. */
export async function readLog(id: string, lines = 500): Promise<LogOut> {
  return request<LogOut>(`/logs/${encodeURIComponent(id)}?lines=${lines}`);
}

/** Sends a recording and gets the text back (the key comes from an agent already set up). */
export async function transcribe(audio: Blob): Promise<string> {
  const { baseUrl, token } = await getApiConfig();
  const lang = locale();
  const form = new FormData();
  form.append("audio", audio, "speech.webm");
  form.append("language", lang);
  const res = await fetch(`${baseUrl}/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": lang },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(data.detail) ?? `HTTP ${res.status}`);
  return (data.text ?? "") as string;
}

/** A reply read out loud by the provider chosen in Settings (not Windows' own voices,
 * which the app plays itself). */
export async function speakText(text: string, signal?: AbortSignal, fallback = false): Promise<Blob> {
  const { baseUrl, token } = await getApiConfig();
  const res = await fetch(`${baseUrl}/speak`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Language": locale() },
    body: JSON.stringify({ text, fallback }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(errorText(data.detail) ?? `HTTP ${res.status}`);
  }
  return res.blob();
}
