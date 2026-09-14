/** Fixed values the chat screen leans on: the remembered model, defaults, and the
 *  starter prompts shown in an empty conversation. */

import type { ReplySettings } from "../../lib/types";

export const MODEL_KEY = "rafiq-chat-model";
export const DEFAULT_REPLY_SETTINGS: ReplySettings = {
  length: "balanced",
  language: "auto",
  temperature: null,
  tools: true,
  reasoning: true,
  reasoning_effort: null,
  auto_summarize: true,
};
export const SUGGESTIONS = [
  { text: "اشرحلي الفرق بين Promise و async/await بمثال", hint: "سؤال عادي" },
  { text: "هاي خطتي: 1) اعمل ملف README للمشروع 2) رتّب الملفات بمجلدات 3) اكتبلي ملخص بالتغييرات", hint: "رفيق بيحوّلها لمهام بالدور" },
  { text: "افتح ملفات المجلد وقلّي شو في مشاكل ممكن تتصلّح", hint: "بيحتاج مجلد للمحادثة" },
];

export function savedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}
