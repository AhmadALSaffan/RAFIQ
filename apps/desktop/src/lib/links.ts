/**
 * External links. The app's webview must never navigate away from the app, and Tauri
 * doesn't open `target="_blank"` links on its own — so every http(s) link is routed to
 * the user's default browser through the `open_external` Rust command.
 */

function isWebLink(href: string | null): href is string {
  return Boolean(href && /^https?:\/\//i.test(href));
}

/** Opens a web page in the default browser (Tauri) or a new tab (plain `vite dev`). */
export async function openExternal(url: string): Promise<void> {
  if (!isWebLink(url)) return;
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    await invoke("open_external", { url }).catch(() => undefined);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * One document-level listener instead of a wrapper on every <a>: links inside chat
 * markdown, tracker issues and docs all go out the same door, including ones added later.
 */
export function installExternalLinkHandler(): () => void {
  function onClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.("a");
    const href = anchor?.getAttribute("href") ?? null;
    if (!isWebLink(href)) return;
    event.preventDefault();
    void openExternal(href);
  }
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
