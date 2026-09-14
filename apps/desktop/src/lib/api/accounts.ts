/** Connected accounts: sign in with a provider account, list them, disconnect. */

import { request } from "./client";
import type { AccountProvider, AuthAccount, AuthAIConfig, ConnectPoll, ConnectStart, Provider } from "../types";

export async function listAccountProviders(): Promise<AccountProvider[]> {
  return request<AccountProvider[]>("/accounts/providers");
}

export async function listAccounts(): Promise<AuthAccount[]> {
  return request<AuthAccount[]>("/accounts");
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

export async function pollConnect(flowId: string): Promise<ConnectPoll> {
  return request<ConnectPoll>(`/accounts/connect/${flowId}/poll`, { method: "POST" });
}

export async function disconnectAccount(id: string): Promise<void> {
  await request<void>(`/accounts/${id}`, { method: "DELETE" });
}
