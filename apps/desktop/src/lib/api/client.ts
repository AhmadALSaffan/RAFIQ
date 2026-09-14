import { locale } from "../../i18n";
/**
 * The one place that talks to the local backend.
 *
 * Everything else in `lib/api/` builds on `request()`; nothing outside this folder should
 * call `fetch` against the agent. Two extras live here because they're cross-cutting: the
 * in-flight counter that drives the top progress bar, and the boot wait the splash uses.
 */

import { getApiConfig } from "../config";

// ── In-flight tracking ────────────────────────────────────────────────────────
// The top progress bar reads this: one counter, bumped around every call, so the UI
// can show that something is happening instead of an empty screen.

let inFlight = 0;

const watchers = new Set<(count: number) => void>();

function announce(): void {
  watchers.forEach((fn) => fn(inFlight));
}

export function onRequestCount(fn: (count: number) => void): () => void {
  watchers.add(fn);
  fn(inFlight);
  return () => watchers.delete(fn);
}

/** Wraps any promise so it counts towards the progress bar (streams, uploads…). */
export async function tracked<T>(work: Promise<T>): Promise<T> {
  inFlight += 1;
  announce();
  try {
    return await work;
  } finally {
    inFlight -= 1;
    announce();
  }
}

/** Polls the backend until it answers — it takes a moment to boot in the packaged app. */
export async function waitForBackend(signal?: AbortSignal): Promise<void> {
  const { baseUrl } = await getApiConfig();
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const res = await fetch(`${baseUrl}/health`, { cache: "no-store", signal });
      if (res.ok) return;
    } catch {
      // Not listening yet — the sidecar is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(120 + attempt * 60, 600)));
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, token } = await getApiConfig();
  inFlight += 1;
  announce();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        // The agent answers errors and notices in the UI's language.
        "Accept-Language": locale(),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail ?? `${res.status} ${res.statusText}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    inFlight -= 1;
    announce();
  }
}
