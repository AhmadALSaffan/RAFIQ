import type { Provider } from "./types";

import { t } from "../i18n";
export interface ProviderMeta {
  value: Provider;
  label: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  keyPlaceholder?: string;
  hint?: string;
  /** Signs in with a connected account (Settings → الحسابات المتصلة) instead of a key. */
  account?: boolean;
  /** Works with a key *or* a connected account — the user picks. */
  accountOptional?: boolean;
  /** Experimental integration: hidden until the user connects an account for it. */
  experimental?: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  { value: "anthropic", label: "Anthropic", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-ant-…" },
  { value: "openai", label: "OpenAI", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "gemini", label: "Google Gemini", needsKey: true, needsBaseUrl: false, keyPlaceholder: "AIza…" },
  { value: "deepseek", label: "DeepSeek", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "groq", label: "Groq", needsKey: true, needsBaseUrl: false, keyPlaceholder: "gsk_…" },
  { value: "mistral", label: "Mistral", needsKey: true, needsBaseUrl: false },
  { value: "xai", label: "xAI (Grok)", needsKey: true, needsBaseUrl: false, keyPlaceholder: "xai-…" },
  {
    value: "openrouter",
    label: "OpenRouter",
    needsKey: true,
    needsBaseUrl: false,
    keyPlaceholder: "sk-or-…",
    accountOptional: true,
  },
  {
    value: "github_copilot",
    label: "GitHub Copilot",
    needsKey: false,
    needsBaseUrl: false,
    account: true,
    hint: t("بتسجّل دخول بحساب GitHub عليه اشتراك Copilot — بدون مفتاح."),
  },
  {
    value: "authai",
    label: t("AuthAI (تجريبي)"),
    needsKey: false,
    needsBaseUrl: false,
    account: true,
    experimental: true,
    hint: t("تكامل تجريبي وغير رسمي — الحساب بينربط من الإعدادات ← الحسابات المتصلة."),
  },
  {
    value: "ollama",
    label: t("Ollama (محلي)"),
    needsKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:11434",
    hint: t("لازم يكون Ollama شغّال على جهازك."),
  },
  {
    value: "custom",
    label: t("مخصص (متوافق مع OpenAI)"),
    needsKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    hint: t("LM Studio، vLLM، أو أي سيرفر بيحكي بصيغة OpenAI."),
  },
];

export function providerMeta(provider: Provider): ProviderMeta {
  return PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
}
