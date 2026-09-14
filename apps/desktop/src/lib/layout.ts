import { useSyncExternalStore } from "react";

/**
 * How wide the user wants each column. Kept in one tiny store (not React context) because
 * the shell's nav and the chat's own list live in different parts of the tree and both
 * need to read and write it, and it has to survive a reload.
 */
export interface LayoutPrefs {
  /** Side nav width in px. */
  nav: number;
  /** Icons-only nav. */
  navCollapsed: boolean;
  /** Conversation list width in px. */
  list: number;
  /** Hide the conversation list entirely. */
  listHidden: boolean;
  /** How wide the reading column gets. */
  reading: ReadingWidth;
}

export type ReadingWidth = "narrow" | "medium" | "wide" | "full";

export const DEFAULT_LAYOUT: LayoutPrefs = {
  nav: 224,
  navCollapsed: false,
  list: 240,
  listHidden: false,
  reading: "medium",
};

export const NAV_MIN = 168;
export const NAV_MAX = 360;
export const LIST_MIN = 190;
export const LIST_MAX = 460;
/** Collapsed nav shows only the icons. */
export const NAV_COLLAPSED = 60;

export const READING_WIDTHS: Record<ReadingWidth, string> = {
  narrow: "40rem",
  medium: "48rem",
  wide: "60rem",
  full: "100%",
};

export const READING_LABELS: Record<ReadingWidth, string> = {
  narrow: "ضيّق",
  medium: "متوسط",
  wide: "عريض",
  full: "كامل",
};

const KEY = "rafiq-layout";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const saved = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      ...DEFAULT_LAYOUT,
      ...saved,
      nav: clamp(saved.nav ?? DEFAULT_LAYOUT.nav, NAV_MIN, NAV_MAX),
      list: clamp(saved.list ?? DEFAULT_LAYOUT.list, LIST_MIN, LIST_MAX),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

let current = load();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLayout(patch: Partial<LayoutPrefs>): void {
  const next = { ...current, ...patch };
  next.nav = clamp(next.nav, NAV_MIN, NAV_MAX);
  next.list = clamp(next.list, LIST_MIN, LIST_MAX);
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A layout that can't be saved still applies for this session.
  }
  listeners.forEach((fn) => fn());
}

export function resetLayout(): void {
  setLayout(DEFAULT_LAYOUT);
}

export function useLayout(): LayoutPrefs {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
