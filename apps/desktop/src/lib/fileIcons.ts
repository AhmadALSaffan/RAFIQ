/**
 * The icon the user's own OS shows for a file type (Explorer's icon), fetched
 * once per extension from the Rust side and cached for the life of the window.
 * Outside Tauri — the Vite dev preview — every lookup resolves to null and the
 * caller draws its own generic icon instead.
 */

const cache = new Map<string, Promise<string | null>>();

/** ".ts" for "src/lib/api.ts". Extensionless names get their own bucket. */
function extensionOf(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

async function fetchIcon(extension: string): Promise<string | null> {
  try {
    const { isTauri, invoke } = await import("@tauri-apps/api/core");
    if (!isTauri()) return null;
    // SHGetFileInfoW only needs a plausible name, not a file that exists.
    const icon = await invoke<string | null>("system_file_icon", { name: `rafiq${extension}` });
    return icon ?? null;
  } catch {
    return null;
  }
}

/** Data URL of the OS icon for this path's file type, or null if unavailable. */
export function systemFileIcon(path: string): Promise<string | null> {
  const extension = extensionOf(path);
  let pending = cache.get(extension);
  if (!pending) {
    pending = fetchIcon(extension);
    cache.set(extension, pending);
  }
  return pending;
}
