/**
 * The app's first launch opens in the language picked in the installer.
 *
 * The installer asks for a language on its first screen and leaves its choice next to the
 * program (src-tauri/installer/hooks.nsh). Here, before anything is drawn, that choice
 * becomes the app's language, unless one was already chosen inside the app, which always
 * wins. Deliberately free of the i18n module: it has to run before that module reads the
 * saved language.
 */

const STORAGE_KEY = "rafiq-locale"; // the same key i18n/index.ts reads

export async function adoptInstallerLanguage(): Promise<void> {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
  } catch {
    return; // no storage: nothing to save the choice in
  }
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (!isTauri()) return;
  const picked = await invoke<string | null>("installer_language").catch(() => null);
  if (picked === "ar" || picked === "en" || picked === "ru") {
    try {
      localStorage.setItem(STORAGE_KEY, picked);
    } catch {
      // storage refused: Arabic, as before
    }
  }
}
