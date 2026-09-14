import type { Provider } from "./types";

export interface ProviderMeta {
  value: Provider;
  label: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  keyPlaceholder?: string;
  hint?: string;
}

export const PROVIDERS: ProviderMeta[] = [
  { value: "anthropic", label: "Anthropic", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-ant-…" },
  { value: "openai", label: "OpenAI", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "gemini", label: "Google Gemini", needsKey: true, needsBaseUrl: false, keyPlaceholder: "AIza…" },
  { value: "deepseek", label: "DeepSeek", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "groq", label: "Groq", needsKey: true, needsBaseUrl: false, keyPlaceholder: "gsk_…" },
  { value: "mistral", label: "Mistral", needsKey: true, needsBaseUrl: false },
  { value: "xai", label: "xAI (Grok)", needsKey: true, needsBaseUrl: false, keyPlaceholder: "xai-…" },
  { value: "openrouter", label: "OpenRouter", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-or-…" },
  {
    value: "ollama",
    label: "Ollama (محلي)",
    needsKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:11434",
    hint: "لازم يكون Ollama شغّال على جهازك.",
  },
  {
    value: "custom",
    label: "مخصص (متوافق مع OpenAI)",
    needsKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    hint: "LM Studio، vLLM، أو أي سيرفر بيحكي بصيغة OpenAI.",
  },
];

export function providerMeta(provider: Provider): ProviderMeta {
  return PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
}
