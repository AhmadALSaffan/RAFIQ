import type { Provider } from "./types";

import { t } from "../i18n";

export type ProviderGroup = "main" | "cloud" | "fast" | "china" | "local";

export const GROUP_LABEL: Record<ProviderGroup, string> = {
  main: t("الأساسية"),
  cloud: t("سحابات الشركات"),
  fast: t("سريعة ورخيصة"),
  china: t("Qwen · Kimi · GLM"),
  local: t("محلية ومخصصة"),
};

/** A non-secret setting the provider needs besides the key (sent as `options`). */
export interface ProviderOption {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

export interface ProviderMeta {
  value: Provider;
  label: string;
  group: ProviderGroup;
  needsKey: boolean;
  needsBaseUrl: boolean;
  /** The base URL can be changed but has a working default (e.g. a region's endpoint). */
  baseUrlOptional?: boolean;
  baseUrlLabel?: string;
  defaultBaseUrl?: string;
  keyPlaceholder?: string;
  hint?: string;
  /** How the secret is entered: one key (default), an AWS key pair, or a JSON key file. */
  credential?: "key" | "aws" | "json";
  options?: ProviderOption[];
  /** Signs in with a connected account (Settings → الحسابات المتصلة) instead of a key. */
  account?: boolean;
  /** Works with a key *or* a connected account — the user picks. */
  accountOptional?: boolean;
  /** Experimental integration: hidden until the user connects an account for it. */
  experimental?: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  { value: "anthropic", label: "Anthropic", group: "main", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-ant-…" },
  { value: "openai", label: "OpenAI", group: "main", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "gemini", label: "Google Gemini", group: "main", needsKey: true, needsBaseUrl: false, keyPlaceholder: "AIza…" },
  { value: "deepseek", label: "DeepSeek", group: "main", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "mistral", label: "Mistral", group: "main", needsKey: true, needsBaseUrl: false },
  { value: "xai", label: "xAI (Grok)", group: "main", needsKey: true, needsBaseUrl: false, keyPlaceholder: "xai-…" },
  {
    value: "openrouter",
    label: "OpenRouter",
    group: "main",
    needsKey: true,
    needsBaseUrl: false,
    keyPlaceholder: "sk-or-…",
    accountOptional: true,
  },
  {
    value: "github_copilot",
    label: "GitHub Copilot",
    group: "main",
    needsKey: false,
    needsBaseUrl: false,
    account: true,
    hint: t("بتسجّل دخول بحساب GitHub عليه اشتراك Copilot — بدون مفتاح."),
  },
  {
    value: "azure",
    label: "Azure OpenAI",
    group: "cloud",
    needsKey: true,
    needsBaseUrl: true,
    baseUrlLabel: t("عنوان المورد (Endpoint)"),
    defaultBaseUrl: "https://YOUR-RESOURCE.openai.azure.com",
    options: [{ key: "api_version", label: "API version", placeholder: "2024-10-21" }],
    hint: t("اسم الموديل هو اسم الـ deployment اللي عملته بـ Azure."),
  },
  {
    value: "bedrock",
    label: "AWS Bedrock",
    group: "cloud",
    needsKey: true,
    needsBaseUrl: false,
    credential: "aws",
    options: [{ key: "region", label: t("المنطقة (Region)"), placeholder: "us-east-1", required: true }],
    hint: t("مفتاح وصول IAM عليه صلاحية bedrock:InvokeModel. للنماذج الجديدة (مثل Claude 4) اختار الـ inference profile اللي بيبلش بـ us. أو eu."),
  },
  {
    value: "vertex_ai",
    label: "Google Vertex AI",
    group: "cloud",
    needsKey: true,
    needsBaseUrl: false,
    credential: "json",
    options: [
      { key: "location", label: t("المنطقة (Location)"), placeholder: "us-central1" },
      { key: "project", label: t("المشروع (اختياري)"), placeholder: t("من ملف الحساب") },
    ],
    hint: t("الصق ملف JSON لحساب خدمة (Service Account) عليه دور Vertex AI User."),
  },
  { value: "groq", label: "Groq", group: "fast", needsKey: true, needsBaseUrl: false, keyPlaceholder: "gsk_…" },
  { value: "cerebras", label: "Cerebras", group: "fast", needsKey: true, needsBaseUrl: false, keyPlaceholder: "csk-…" },
  { value: "fireworks_ai", label: "Fireworks", group: "fast", needsKey: true, needsBaseUrl: false, keyPlaceholder: "fw_…" },
  { value: "together_ai", label: "Together", group: "fast", needsKey: true, needsBaseUrl: false },
  {
    value: "dashscope",
    label: t("Qwen (علي بابا)"),
    group: "china",
    needsKey: true,
    needsBaseUrl: false,
    baseUrlOptional: true,
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    keyPlaceholder: "sk-…",
    hint: t("المفتاح من Model Studio. إذا حسابك بالصين، غيّر العنوان لـ dashscope.aliyuncs.com."),
  },
  { value: "moonshot", label: "Kimi (Moonshot)", group: "china", needsKey: true, needsBaseUrl: false, keyPlaceholder: "sk-…" },
  { value: "zai", label: "GLM (Z.ai)", group: "china", needsKey: true, needsBaseUrl: false },
  {
    value: "ollama",
    label: t("Ollama (محلي)"),
    group: "local",
    needsKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:11434",
    hint: t("لازم يكون Ollama شغّال على جهازك."),
  },
  {
    value: "lm_studio",
    label: t("LM Studio (محلي)"),
    group: "local",
    needsKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    hint: t("شغّل السيرفر المحلي من LM Studio (Developer ← Start Server)."),
  },
  {
    value: "custom",
    label: t("مخصص (متوافق مع OpenAI)"),
    group: "local",
    needsKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "http://localhost:1234/v1",
    hint: t("vLLM، أو أي سيرفر بيحكي بصيغة OpenAI."),
  },
  {
    value: "authai",
    label: t("AuthAI (تجريبي)"),
    group: "local",
    needsKey: false,
    needsBaseUrl: false,
    account: true,
    experimental: true,
    hint: t("تكامل تجريبي وغير رسمي — الحساب بينربط من الإعدادات ← الحسابات المتصلة."),
  },
];

export function providerMeta(provider: Provider): ProviderMeta {
  return PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
}
