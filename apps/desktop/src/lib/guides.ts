/**
 * Guides for the failures a user can fix themselves: Copilot not turned on, a provider that
 * doesn't serve their country, a wrong key, no credit left… The agent sorts each failure
 * into a kind (agent/rafiq_agent/llm/errors.py); whoever receives one calls `showGuide`,
 * and the dialog mounted in the shell opens with the steps for it. The user is never left
 * to work out what «403 Forbidden» means.
 */

export type GuideKind =
  | "copilot_not_enabled"
  | "region_blocked"
  | "bad_key"
  | "no_credit"
  | "rate_limited"
  | "local_server_down"
  | "cant_reach"
  | "model_not_found";

const KINDS: ReadonlySet<string> = new Set<GuideKind>([
  "copilot_not_enabled",
  "region_blocked",
  "bad_key",
  "no_credit",
  "rate_limited",
  "local_server_down",
  "cant_reach",
  "model_not_found",
]);

export interface GuideRequest {
  kind: GuideKind;
  /** The provider's display name («OpenAI»), when known. */
  provider?: string | null;
  /** What «Try again» does, when the caller can retry what failed. */
  onRetry?: () => void;
}

export function isGuideKind(kind: unknown): kind is GuideKind {
  return typeof kind === "string" && KINDS.has(kind);
}

/** Display names for providers given by id («openai» → «OpenAI»); the agent sends names already. */
const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  vertex_ai: "Google Vertex AI",
  deepseek: "DeepSeek",
  github_copilot: "GitHub Copilot",
  openrouter: "OpenRouter",
  xai: "xAI",
  mistral: "Mistral",
  groq: "Groq",
  azure: "Azure OpenAI",
  bedrock: "AWS Bedrock",
  ollama: "Ollama",
  lm_studio: "LM Studio",
};

let listener: ((request: GuideRequest) => void) | null = null;
let last: { kind: string; at: number } | null = null;

/** Opens the guide for this kind. The same kind twice within a few seconds (several
 * requests failing for one reason) opens it once. */
export function showGuide(request: { kind?: string | null; provider?: string | null; onRetry?: () => void }): boolean {
  if (!isGuideKind(request.kind)) return false;
  const now = Date.now();
  if (last && last.kind === request.kind && now - last.at < 4000) return true;
  last = { kind: request.kind, at: now };
  const provider = request.provider ? (PROVIDER_NAMES[request.provider] ?? request.provider) : null;
  listener?.({ kind: request.kind, provider, onRetry: request.onRetry });
  return true;
}

export function onGuide(fn: (request: GuideRequest) => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Where to get a new key, per provider. */
export const KEY_PAGES: Record<string, string> = {
  OpenAI: "https://platform.openai.com/api-keys",
  Anthropic: "https://console.anthropic.com/settings/keys",
  DeepSeek: "https://platform.deepseek.com/api_keys",
  "Google Gemini": "https://aistudio.google.com/apikey",
  OpenRouter: "https://openrouter.ai/settings/keys",
  xAI: "https://console.x.ai",
  Mistral: "https://console.mistral.ai/api-keys",
  Groq: "https://console.groq.com/keys",
};

/** Where to add credit, per provider. */
export const BILLING_PAGES: Record<string, string> = {
  OpenAI: "https://platform.openai.com/settings/organization/billing/overview",
  Anthropic: "https://console.anthropic.com/settings/billing",
  DeepSeek: "https://platform.deepseek.com/top_up",
  OpenRouter: "https://openrouter.ai/settings/credits",
  xAI: "https://console.x.ai",
  Mistral: "https://console.mistral.ai/billing",
  Groq: "https://console.groq.com/settings/billing",
};

export const COPILOT_SETTINGS = "https://github.com/settings/copilot";
export const OLLAMA_DOWNLOAD = "https://ollama.com/download";
