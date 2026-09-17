import { useEffect, useSyncExternalStore } from "react";
import { listWorkspaces } from "./api";
import type { Workspace } from "./types";

/**
 * The workspace the app is filtered to right now (null = everything), plus a cached list
 * of all workspaces. One tiny store, like the layout prefs: the shell's switcher and the
 * chat/tasks/designs pages all read it, and the choice survives a reload.
 */

const KEY = "rafiq-workspace";

interface State {
  currentId: string | null;
  all: Workspace[];
  loaded: boolean;
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let state: State = { currentId: readSaved(), all: [], loaded: false };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  emit();
}

export function setCurrentWorkspace(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode — the choice just won't survive a reload.
  }
  set({ currentId: id });
}

let loading: Promise<void> | null = null;

/** Fetches the list once (or again after a change); a stale saved id is dropped. */
export function refreshWorkspaces(): Promise<void> {
  loading ??= listWorkspaces()
    .then((all) => {
      const currentId = all.some((w) => w.id === state.currentId) ? state.currentId : null;
      if (currentId !== state.currentId) setCurrentWorkspace(currentId);
      set({ all, loaded: true });
    })
    .catch(() => set({ loaded: true }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useWorkspaces(): State & { current: Workspace | null } {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!snapshot.loaded) void refreshWorkspaces();
  }, [snapshot.loaded]);
  return { ...snapshot, current: snapshot.all.find((w) => w.id === snapshot.currentId) ?? null };
}

/** Just the active workspace's id — what list calls and create calls pass along. */
export function useCurrentWorkspaceId(): string | null {
  return useWorkspaces().currentId;
}

export const WORKSPACE_COLORS = ["#e68835", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444", "#f59e0b", "#14b8a6", "#ec4899"];
