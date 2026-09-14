/** Shared vocabulary for the tasks pages: status colours, filter names, and durations. */

import type { TaskStatus } from "../../lib/types";
import { parseUtc } from "../../lib/time";

import { t } from "../../i18n";
export const STATUS_COLOR: Record<TaskStatus, string> = {
  queued: "var(--color-ink-muted)",
  pending: "var(--color-ink-muted)",
  running: "var(--color-accent)",
  completed: "var(--color-success)",
  failed: "var(--color-danger)",
  cancelled: "var(--color-ink-muted)",
};

const FILTER_LABEL: Record<string, string> = {
  all: t("الكل"),
  active: t("شغّالة"),
  queued: t("بالدور"),
  completed: t("خلصت"),
  failed: t("وقفت"),
};

export function statusFilterLabel(filter: string): string {
  return FILTER_LABEL[filter] ?? filter;
}

/** A run's length in words a person reads at a glance — never a bare millisecond count. */
export function formatDuration(fromIso: string, toIso: string): string | null {
  const from = parseUtc(fromIso).getTime();
  const to = parseUtc(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return t("{0} ثانية", { 0: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? t("{0} د و{1} ث", { 0: minutes, 1: rest }) : t("{0} دقيقة", { 0: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t("{0} س و{1} د", { 0: hours, 1: rest }) : t("{0} ساعة", { 0: hours });
}
