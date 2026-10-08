/**
 * Tabs along the top of the window, like a browser: every chat, task or design the user
 * opens stays one click away until they close it. Kept in localStorage so they come back
 * after a restart.
 */

import { useSyncExternalStore } from "react";

export type TabKind = "chat" | "task" | "design" | "motion";

export interface AppTab {
  path: string;
  kind: TabKind;
  id: string;
}

const KEY = "rafiq.tabs";
const MAX = 12;

/** The tab a route belongs to, if it's one that opens in a tab. */
export function tabFor(pathname: string): AppTab | null {
  const m = /^\/(chat|tasks|designs|motion)\/([^/?#]+)/.exec(pathname);
  if (!m) return null;
  const kind: TabKind = m[1] === "chat" ? "chat" : m[1] === "tasks" ? "task" : m[1] === "motion" ? "motion" : "design";
  return { path: `/${m[1]}/${m[2]}`, kind, id: decodeURIComponent(m[2]) };
}

/** `tabs` with `tab` added at the end (or left where it is), capped to the newest MAX. */
export function withTab(tabs: AppTab[], tab: AppTab): AppTab[] {
  if (tabs.some((t) => t.path === tab.path)) return tabs;
  return [...tabs, tab].slice(-MAX);
}

/** Where to go after closing the tab at `path` while it's the one on screen. */
export function neighbourAfterClose(tabs: AppTab[], path: string): string {
  const i = tabs.findIndex((t) => t.path === path);
  const rest = tabs.filter((t) => t.path !== path);
  if (!rest.length) return "/";
  return rest[Math.min(Math.max(i, 0), rest.length - 1)].path;
}

function read(): AppTab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((t): t is AppTab => Boolean(t && typeof t.path === "string" && tabFor(t.path))) : [];
  } catch {
    return [];
  }
}

let tabs: AppTab[] = read();
const listeners = new Set<() => void>();

function set(next: AppTab[]) {
  tabs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: the tabs just won't survive a restart.
  }
  listeners.forEach((l) => l());
}

export function openTab(tab: AppTab): void {
  const next = withTab(tabs, tab);
  if (next !== tabs) set(next);
}

export function closeTab(path: string): void {
  set(tabs.filter((t) => t.path !== path));
}

/** Drops tabs whose chat/task/design no longer exists. */
export function pruneTabs(exists: (tab: AppTab) => boolean): void {
  const next = tabs.filter(exists);
  if (next.length !== tabs.length) set(next);
}

export function useTabs(): AppTab[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tabs,
  );
}
