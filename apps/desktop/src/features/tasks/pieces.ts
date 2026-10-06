/** Shared vocabulary for the tasks pages: status colours, filter names, and durations. */

import type { TaskEvent, TaskStatus } from "../../lib/types";
import { parseUtc } from "../../lib/time";

import { t } from "../../i18n";
export const STATUS_COLOR: Record<TaskStatus, string> = {
  queued: "var(--color-ink-muted)",
  pending: "var(--color-ink-muted)",
  running: "var(--color-ink)",
  planned: "var(--color-pending)",
  completed: "var(--color-success)",
  failed: "var(--color-danger)",
  cancelled: "var(--color-ink-muted)",
};

const FILTER_LABEL: Record<string, string> = {
  all: t("الكل"),
  active: t("شغّالة"),
  queued: t("بالدور"),
  planned: t("خطط بانتظارك"),
  completed: t("خلصت"),
  failed: t("وقفت"),
};

export function statusFilterLabel(filter: string): string {
  return FILTER_LABEL[filter] ?? filter;
}

/** A task that stopped (failed, or was cancelled) can pick up again where it left off. */
export function canResume(status: TaskStatus): boolean {
  return status === "failed" || status === "cancelled";
}

/** How many tool steps got done since the last time the task was resumed — the work a new
 *  run would otherwise repeat. */
export function finishedSteps(events: TaskEvent[]): number {
  let done = 0;
  for (const e of events) {
    if (e.type === "resumed") done = 0;
    else if (e.type === "tool_result" && e.ok) done++;
  }
  return done;
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
