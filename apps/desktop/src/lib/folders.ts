import { t } from "../i18n";
const RECENT_KEY = "rafiq-recent-folders";
const MAX_RECENT = 5;

export async function canPickNatively(): Promise<boolean> {
  const { isTauri } = await import("@tauri-apps/api/core");
  return isTauri();
}

/** Opens the OS folder picker (Tauri only). Resolves null if cancelled or unavailable. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!(await canPickNatively())) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, defaultPath, title: t("اختار مجلد العمل") });
  return typeof picked === "string" ? picked : null;
}

export function recentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberFolder(path: string): void {
  try {
    const next = [path, ...recentFolders().filter((p) => p !== path)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — recents are a convenience only
  }
}

export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Opens a folder (or a file's folder) in the system file manager. Tauri only. */
export async function revealPath(path: string): Promise<boolean> {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (!isTauri()) return false;
  try {
    await invoke("reveal_path", { path });
    return true;
  } catch {
    return false;
  }
}
