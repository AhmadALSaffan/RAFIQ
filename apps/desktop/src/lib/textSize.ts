import { useSyncExternalStore } from "react";

import { t } from "../i18n";

/**
 * How big the user wants everything to read. It scales the whole window (text, icons and
 * spacing together) the way a browser's zoom does, because sizes across the app are a mix of
 * rem and fixed pixels; scaling only the root font would leave half of them behind.
 * In the app it's the webview's own zoom; in a plain browser (dev, tests) CSS zoom stands in.
 */
export type TextSize = "small" | "default" | "large" | "larger";

export const TEXT_SIZES: TextSize[] = ["small", "default", "large", "larger"];

export const TEXT_SCALE: Record<TextSize, number> = {
  small: 0.9,
  default: 1,
  large: 1.12,
  larger: 1.25,
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: t("صغير"),
  default: t("عادي"),
  large: t("كبير"),
  larger: t("أكبر"),
};

const KEY = "rafiq-text-size";

function load(): TextSize {
  try {
    const saved = localStorage.getItem(KEY);
    return TEXT_SIZES.includes(saved as TextSize) ? (saved as TextSize) : "default";
  } catch {
    return "default";
  }
}

let current = load();
const listeners = new Set<() => void>();

async function apply(size: TextSize): Promise<void> {
  const scale = TEXT_SCALE[size];
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(scale);
      return;
    }
  } catch {
    // fall through to CSS zoom
  }
  document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
}

export function textSize(): TextSize {
  return current;
}

export function setTextSize(size: TextSize): void {
  if (!TEXT_SIZES.includes(size)) return;
  current = size;
  try {
    localStorage.setItem(KEY, size);
  } catch {
    // still applies for this session
  }
  void apply(size);
  listeners.forEach((fn) => fn());
}

/** One step bigger (+1) or smaller (-1), stopping at the ends. */
export function stepTextSize(dir: 1 | -1): void {
  const i = TEXT_SIZES.indexOf(current);
  setTextSize(TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + dir))]);
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/**
 * Apply the saved size to this window, follow changes made in another window (the quick-ask
 * window shares the storage), and take Ctrl/⌘ with + − 0 like a browser does.
 */
export function installTextSize(): void {
  void apply(current);
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = load();
    void apply(current);
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "=" || e.key === "+") stepTextSize(1);
    else if (e.key === "-" || e.key === "_") stepTextSize(-1);
    else if (e.key === "0") setTextSize("default");
    else return;
    e.preventDefault();
  });
}
