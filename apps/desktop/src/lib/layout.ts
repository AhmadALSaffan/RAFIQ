import { useSyncExternalStore } from "react";

import { t } from "../i18n";
/**
 * How wide the user wants the chat's columns. Kept in one tiny store (not React context)
 * because the chat page and the settings page both read and write it, and it has to survive
 * a reload. (The page nav is a fixed rail now — see Shell's RAIL.)
 */
export interface LayoutPrefs {
  /** Conversation list width in px. */
  list: number;
  /** Hide the conversation list entirely. */
  listHidden: boolean;
  /** How wide the reading column gets. */
  reading: ReadingWidth;
  /** Width of the side panel with the model's files and commands. */
  activity: number;
}

export type ReadingWidth = "narrow" | "medium" | "wide" | "full";

export const DEFAULT_LAYOUT: LayoutPrefs = {
  list: 240,
  listHidden: false,
  reading: "medium",
  activity: 440,
};

export const LIST_MIN = 190;
export const LIST_MAX = 460;
export const ACTIVITY_MIN = 300;
export const ACTIVITY_MAX = 900;

export const READING_WIDTHS: Record<ReadingWidth, string> = {
  narrow: "40rem",
  medium: "48rem",
  wide: "60rem",
  full: "100%",
};

export const READING_LABELS: Record<ReadingWidth, string> = {
  narrow: t("ضيّق"),
  medium: t("متوسط"),
  wide: t("عريض"),
  full: t("كامل"),
};

const KEY = "rafiq-layout";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LAYOUT;
    // Older saves carry the retired nav width; only the known keys are kept.
    const saved = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      list: clamp(saved.list ?? DEFAULT_LAYOUT.list, LIST_MIN, LIST_MAX),
      listHidden: saved.listHidden ?? DEFAULT_LAYOUT.listHidden,
      reading: saved.reading ?? DEFAULT_LAYOUT.reading,
      activity: clamp(saved.activity ?? DEFAULT_LAYOUT.activity, ACTIVITY_MIN, ACTIVITY_MAX),
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
  next.list = clamp(next.list, LIST_MIN, LIST_MAX);
  next.activity = clamp(next.activity, ACTIVITY_MIN, ACTIVITY_MAX);
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
