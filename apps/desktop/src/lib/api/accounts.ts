/** Connected accounts: sign in with a provider account, list them, disconnect. */

import { request } from "./client";
import type { AccountProvider, AuthAccount, AuthAIConfig, ConnectPoll, ConnectStart, Provider } from "../types";

export async function listAccountProviders(): Promise<AccountProvider[]> {
  return request<AccountProvider[]>("/accounts/providers");
}

export async function listAccounts(): Promise<AuthAccount[]> {
  return request<AuthAccount[]>("/accounts");
}

/** What Rafiq knows about a ChatGPT plan's usage (llm/plan_usage.py on the agent). */
export interface PlanUsage {
  /** The highest window's figure OpenAI reported; else Rafiq's estimate (`estimated`); 100
   *  at the limit; null when there's nothing to go on yet. */
  used_percent: number | null;
  /** The figure is Rafiq's estimate: tokens in the last window against what filled it last time. */
  estimated: boolean;
  /** Tokens Rafiq spent on the plan in the last `window_hours`. */
  window_tokens: number;
  window_hours: number;
  /** About how many tokens the window holds, learned from the last limit; null until then. */
  capacity: number | null;
  windows: { name: string; used_percent: number; window_minutes: number | null; resets_in_seconds: number | null }[];
  limited: boolean;
  /** Epoch seconds of the last limit error. */
  limit_at: number | null;
  today: { requests: number; tokens: number };
  week: { requests: number; tokens: number };
}

export async function getPlanUsage(accountId: string): Promise<PlanUsage> {
  return request<PlanUsage>(`/accounts/${encodeURIComponent(accountId)}/plan-usage`);
}

/** Starts a sign-in; the user finishes it in their browser. `target` picks the upstream
 * service for adapters that front several (AuthAI: "openai" | "xai" | "github"). */
export async function startConnect(provider: Provider, target?: string): Promise<ConnectStart> {
  const query = target ? `?target=${encodeURIComponent(target)}` : "";
  return request<ConnectStart>(`/accounts/${provider}/connect${query}`, { method: "POST" });
}

export async function getAuthAIConfig(): Promise<AuthAIConfig> {
  return request<AuthAIConfig>("/accounts/authai/config");
}

/** `secret` is sent only when changing it; it's stored in the keychain, never returned. */
export async function saveAuthAIConfig(input: {
  enabled: boolean;
  relay_url: string | null;
  secret?: string;
}): Promise<AuthAIConfig> {
  return request<AuthAIConfig>("/accounts/authai/config", { method: "PUT", body: JSON.stringify(input) });
}

/** `now`: the user says they've approved — ask the provider straight away. */
export async function pollConnect(flowId: string, now = false): Promise<ConnectPoll> {
  return request<ConnectPoll>(`/accounts/connect/${flowId}/poll${now ? "?now=true" : ""}`, { method: "POST" });
}

export async function disconnectAccount(id: string): Promise<void> {
  await request<void>(`/accounts/${id}`, { method: "DELETE" });
}
