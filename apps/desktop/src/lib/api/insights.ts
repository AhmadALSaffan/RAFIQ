/** Spending and the diagnostics report. */

import { request } from "./client";
import { getApiConfig } from "../config";
import { locale } from "../../i18n";
import type { Diagnostics, UsageSummary } from "../types";

export async function getUsage(days = 30): Promise<UsageSummary> {
  return request<UsageSummary>(`/usage?days=${days}`);
}

export async function getDiagnostics(): Promise<Diagnostics> {
  return request<Diagnostics>("/diagnostics");
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
  if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
  return (data.text ?? "") as string;
}
