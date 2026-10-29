/**
 * The quick-ask box's global shortcut, and what the box does with the text that was
 * selected when it opened. The settings live in the agent with the others; the native
 * side registers the keys and reads the selection. Outside the desktop app the shortcut
 * is a quiet no-op.
 */

import { t } from "../i18n";
import type { QuickAction } from "./types";

/** The shortcuts offered in Settings. Ctrl+Shift+Space first: free on a stock Windows. */
export const QUICK_ASK_SHORTCUTS = ["Ctrl+Shift+Space", "Ctrl+Alt+Space", "Ctrl+Shift+K", "Ctrl+Alt+R"];

/** How many actions of their own a user can keep (the agent holds the same limit). */
export const MAX_QUICK_ACTIONS = 20;

/** The default for "ask about my screen". */
export const SCREEN_ASK_SHORTCUT = "Ctrl+Alt+S";

/** Registers `shortcut` and `screen` (null = none). Resolves to a reason the user can act on, or null. */
export async function syncQuickAsk(shortcut: string | null, selection = true, screen: string | null = null): Promise<string | null> {
  const core = await import("@tauri-apps/api/core");
  if (!core.isTauri()) return null;
  try {
    await core.invoke("set_quick_ask_shortcut", { shortcut, selection, screen });
    return null;
  } catch (e) {
    const detail = String(e);
    return /already|registered|in use/i.test(detail)
      ? t("برنامج تاني ماسك هالاختصار — اختار غيره.")
      : t("ما قدرت أسجّل الاختصار: {0}", { 0: detail });
  }
}

/** The built-in actions. The prompts talk to the model, so they stay in English; the
 * reply follows the text's own language. */
export function builtinActions(): QuickAction[] {
  return [
    {
      id: "translate",
      label: t("ترجم"),
      prompt: "Translate the text below. If it is in Arabic, translate it into English; otherwise translate it into Arabic. Reply with the translation only.",
    },
    {
      id: "fix",
      label: t("صحّح"),
      prompt: "Correct the spelling, grammar and punctuation of the text below, keeping its language, meaning and tone. Reply with the corrected text only.",
    },
    {
      id: "rephrase",
      label: t("أعد الصياغة"),
      prompt: "Rewrite the text below so it reads more clearly and smoothly, in the same language and about the same length. Reply with the new text only.",
    },
    {
      id: "summarize",
      label: t("لخّص"),
      prompt: "Summarise the text below in a few short bullet points, in the same language as the text.",
    },
    {
      id: "reply",
      label: t("رد على هالرسالة"),
      prompt: "This is a message I received. Write a short, polite reply in the same language and dialect, ready to send. Reply with the message only.",
    },
  ];
}

/** What the model is sent for an action on a piece of text. */
export function actionMessage(prompt: string, text: string): string {
  return `${prompt.trim()}\n\n"""\n${text}\n"""`;
}

/** A question typed while text was selected: the text goes along as what it's about. */
export function questionAbout(question: string, selection: string): string {
  return `${question}\n\nThe text I selected:\n"""\n${selection}\n"""`;
}

/** A tidy action from what the user typed in Settings, or a reason it can't be saved. */
export function draftAction(label: string, prompt: string, taken: QuickAction[], id?: string): QuickAction | string {
  const name = label.trim();
  const body = prompt.trim();
  if (!name || !body) return t("اكتب اسم الأمر وشو بدك يعمل بالنص.");
  if (name.length > 40) return t("الاسم طويل — خلّيه 40 حرف أو أقل.");
  if (body.length > 2000) return t("التعليمات طويلة — خلّيها 2000 حرف أو أقل.");
  const clash = [...builtinActions(), ...taken].some((a) => a.id !== id && a.label.trim() === name);
  if (clash) return t("في أمر بنفس الاسم.");
  if (!id && taken.length >= MAX_QUICK_ACTIONS) return t("وصلت لحد {0} أوامر.", { 0: String(MAX_QUICK_ACTIONS) });
  return { id: id ?? `a${Date.now().toString(36)}`, label: name, prompt: body };
}

/** A part of the screen picture, in the picture's on-screen pixels. */
export type Area = { x: number; y: number; width: number; height: number };

/** The box between where the drag started and where the pointer is, whichever way it went. */
export function pickedArea(from: { x: number; y: number }, to: { x: number; y: number }): Area {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}

/** One press on a picture of the screen. The prompts talk to the model, so English; the
 * reply follows the user's language. */
export function imageActions(): QuickAction[] {
  return [
    { id: "explain", label: t("اشرحلي شو هاد"), prompt: "Explain what this part of my screen shows, briefly and plainly. Answer in Arabic unless the screen is clearly for someone working in another language." },
    { id: "problem", label: t("شو الغلط هون؟"), prompt: "This is part of my screen. Find the error or problem it shows, say what causes it and how to fix it, step by step." },
    { id: "text", label: t("طلّع النص"), prompt: "Copy out all the text in this picture exactly as written, keeping its lines and order. Reply with the text only." },
    { id: "translate-image", label: t("ترجم اللي فيه"), prompt: "Translate the text in this picture. If it is in Arabic, translate it into English; otherwise into Arabic. Reply with the translation only." },
  ];
}
