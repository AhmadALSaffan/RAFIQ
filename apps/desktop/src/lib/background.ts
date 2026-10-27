/**
 * Running in the background: the tray, Windows notifications, and starting with Windows.
 *
 * The native side owns the tray and the close-to-tray behaviour; the page tells it what the
 * user chose (the setting lives with the rest in the agent) and gives the tray menu its
 * words in the UI's language. Outside the desktop app (plain `vite dev`) all of this is a
 * quiet no-op.
 */

import { t } from "../i18n";

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  return core.isTauri() ? core : null;
}

/** Tells the native side whether closing the window hides it to the tray. */
export async function syncBackground(runInBackground: boolean): Promise<void> {
  const core = await tauri();
  if (!core) return;
  await core.invoke("set_run_in_background", { enabled: runInBackground }).catch(() => undefined);
  await core
    .invoke("set_tray_labels", { open: t("افتح رفيق"), quit: t("إنهاء رفيق"), tooltip: t("رفيق") })
    .catch(() => undefined);
}

/** Quits for real — the window's close button only hides it while background mode is on. */
export async function quitApp(): Promise<void> {
  const core = await tauri();
  if (core) await core.invoke("quit_app").catch(() => undefined);
}

export async function autostartEnabled(): Promise<boolean | null> {
  if (!(await tauri())) return null;
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled().catch(() => null);
}

export async function setAutostart(on: boolean): Promise<boolean | null> {
  if (!(await tauri())) return null;
  const autostart = await import("@tauri-apps/plugin-autostart");
  await (on ? autostart.enable() : autostart.disable()).catch(() => undefined);
  return autostart.isEnabled().catch(() => null);
}

let permission: Promise<boolean> | null = null;

/** The start of a reply as plain words, for a notification's body. */
export function gist(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 140 ? `${plain.slice(0, 139)}…` : plain;
}

/**
 * A reply or a design finished while the user was elsewhere: a Windows notification, and
 * the taskbar button flashes until they come back. Nothing while they're looking.
 */
export async function announceDone(title: string, text: string): Promise<void> {
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  await notify(title, gist(text) || title);
  if (!(await tauri())) return;
  const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
  await getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
}

/**
 * A Windows notification — only when the user isn't looking at the app (hidden in the tray,
 * minimised, or another window in front). When they are, the in-app toasts say it already.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  if (!(await tauri())) return;
  const plugin = await import("@tauri-apps/plugin-notification");
  permission ??= (async () => {
    if (await plugin.isPermissionGranted()) return true;
    return (await plugin.requestPermission()) === "granted";
  })().catch(() => false);
  if (await permission) plugin.sendNotification({ title, body });
}
