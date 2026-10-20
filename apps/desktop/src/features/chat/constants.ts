/** Fixed values the chat screen leans on: the remembered model, defaults, and the
 *  starter prompts shown in an empty conversation. */

import type { ReplySettings } from "../../lib/types";

import { t } from "../../i18n";
export const MODEL_KEY = "rafiq-chat-model";
export const DEFAULT_REPLY_SETTINGS: ReplySettings = {
  length: "balanced",
  language: "auto",
  temperature: null,
  tools: true,
  reasoning: true,
  reasoning_effort: null,
  auto_summarize: true,
  web_search: null,
  mcp: true,
  browser: true,
  economy: false,
  saver: false,
};
export const SUGGESTIONS = [
  { text: t("اشرحلي الفرق بين Promise و async/await بمثال"), hint: t("سؤال عادي") },
  { text: t("هاي خطتي: 1) اعمل ملف README للمشروع 2) رتّب الملفات بمجلدات 3) اكتبلي ملخص بالتغييرات"), hint: t("رفيق بيحوّلها لمهام وبيستنى نتايجها") },
  { text: t("افتح ملفات المجلد وقلّي شو في مشاكل ممكن تتصلّح"), hint: t("بيحتاج مجلد للمحادثة") },
];

export function savedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

export const EFFORT_KEY = "rafiq-chat-effort";

/** The reasoning level new chats start with (picked on Home or before a chat exists). */
export function savedEffort(): ReplySettings["reasoning_effort"] {
  try {
    const v = localStorage.getItem(EFFORT_KEY);
    return v === "low" || v === "medium" || v === "high" ? v : null;
  } catch {
    return null;
  }
}

export function rememberEffort(effort: ReplySettings["reasoning_effort"]): void {
  try {
    if (effort) localStorage.setItem(EFFORT_KEY, effort);
    else localStorage.removeItem(EFFORT_KEY);
  } catch {
    // convenience only
  }
}

/** Remember the model for the next new chat (convenience only — storage may be unavailable). */
export function rememberModel(id: string): void {
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    // convenience only
  }
}
