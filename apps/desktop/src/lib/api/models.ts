/** Model registry: what the user configured, and what a provider offers. */

import { request } from "./client";
import { providerMeta } from "../providers";
import type {
  DiscoveredModel,
  LlmModel,
  Provider,
} from "../types";

export async function listModels(): Promise<LlmModel[]> {
  return request<LlmModel[]>("/models");
}

export async function createModel(input: {
  name: string;
  provider: Provider;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<LlmModel> {
  return request<LlmModel>("/models", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      provider: input.provider,
      model_id: input.modelId,
      base_url: input.baseUrl,
      api_key: input.apiKey,
    }),
  });
}

export async function deleteModel(id: string): Promise<void> {
  await request<void>(`/models/${id}`, { method: "DELETE" });
}

export async function discoverModels(input: {
  provider: Provider;
  apiKey?: string;
  baseUrl?: string;
}): Promise<DiscoveredModel[]> {
  return request<DiscoveredModel[]>("/models/discover", {
    method: "POST",
    body: JSON.stringify({ provider: input.provider, api_key: input.apiKey, base_url: input.baseUrl }),
  });
}

export async function verifyModel(id: string): Promise<LlmModel> {
  return request<LlmModel>(`/models/${id}/verify`, { method: "POST" });
}

export function providerLabel(provider: Provider): string {
  return providerMeta(provider).label;
}
