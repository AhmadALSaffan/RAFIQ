/**
 * The quick-ask box's global shortcut. The setting lives in the agent with the others; the
 * native side registers the keys. Outside the desktop app this is a quiet no-op.
 */

import { t } from "../i18n";

/** The shortcuts offered in Settings. Ctrl+Shift+Space first: free on a stock Windows. */
export const QUICK_ASK_SHORTCUTS = ["Ctrl+Shift+Space", "Ctrl+Alt+Space", "Ctrl+Shift+K", "Ctrl+Alt+R"];

/** Registers `shortcut` (null = none). Resolves to a reason the user can act on, or null. */
export async function syncQuickAsk(shortcut: string | null): Promise<string | null> {
  const core = await import("@tauri-apps/api/core");
  if (!core.isTauri()) return null;
  try {
    await core.invoke("set_quick_ask_shortcut", { shortcut });
    return null;
  } catch (e) {
    const detail = String(e);
    return /already|registered|in use/i.test(detail)
      ? t("برنامج تاني ماسك هالاختصار — اختار غيره.")
      : t("ما قدرت أسجّل الاختصار: {0}", { 0: detail });
  }
}
