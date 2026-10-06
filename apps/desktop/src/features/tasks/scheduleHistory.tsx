/**
 * A schedule's history: every time it ran — on time or started by hand — and how it went,
 * including the times it couldn't start at all.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { scheduleRuns } from "../../lib/api";
import type { ScheduleRun, ScheduleRunStatus } from "../../lib/types";
import { listContainer, listItem } from "../../lib/motion";
import { clockTime, dayLabel } from "../../lib/time";
import { t } from "../../i18n";

const TONE: Record<string, string> = {
  completed: "var(--color-success)",
  failed: "var(--color-danger)",
  not_started: "var(--color-danger)",
  running: "var(--color-ink)",
  queued: "var(--color-ink-muted)",
  pending: "var(--color-ink-muted)",
  planned: "var(--color-pending)",
  cancelled: "var(--color-ink-muted)",
  deleted: "var(--color-border)",
};

export function runTone(status: ScheduleRunStatus): string {
  return TONE[status] ?? "var(--color-ink-muted)";
}

export function runLabel(status: ScheduleRunStatus): string {
  switch (status) {
    case "completed":
      return t("نجحت");
    case "failed":
      return t("فشلت");
    case "not_started":
      return t("ما بلّشت");
    case "running":
      return t("عم تشتغل");
    case "cancelled":
      return t("انلغت");
    case "deleted":
      return t("المهمة انحذفت");
    default:
      return t("بالدور");
  }
}

/** "42 ث", "3 د 05 ث", "1 س 12 د" — short, and exact enough to compare runs. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t("{0} ث", { 0: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("{0} د {1} ث", { 0: m, 1: String(s % 60).padStart(2, "0") });
  return t("{0} س {1} د", { 0: Math.floor(m / 60), 1: String(m % 60).padStart(2, "0") });
}

/** How many of the given runs succeeded, out of those that finished one way or another. */
export function successRate(statuses: ScheduleRunStatus[]): { ok: number; done: number } {
  const done = statuses.filter((s) => s === "completed" || s === "failed" || s === "not_started");
  return { ok: done.filter((s) => s === "completed").length, done: done.length };
}

/** The latest outcomes as a row of dots, newest first. */
export function RecentRuns({ statuses }: { statuses: ScheduleRunStatus[] }) {
  if (!statuses.length) return null;
  return (
    <span className="flex items-center gap-1" aria-label={t("آخر التشغيلات")}>
      {statuses.map((status, i) => (
        <span
          key={i}
          title={runLabel(status)}
          className="h-2 w-2 rounded-full"
          style={{ background: runTone(status), opacity: status === "deleted" ? 0.6 : 1 }}
        />
      ))}
    </span>
  );
}

export function ScheduleHistory({ scheduleId }: { scheduleId: string }) {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    scheduleRuns(scheduleId)
      .then(setRuns)
      .catch((err) => {
        setRuns([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [scheduleId]);

  if (runs === null) return <div className="shimmer mt-3 h-16 rounded-lg" />;
  if (error) {
    return (
      <p className="mt-3 text-xs" style={{ color: "var(--color-danger)" }} role="alert">
        {error}
      </p>
    );
  }
  if (!runs.length) {
    return (
      <p className="mt-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("ما اشتغلت لسا. أول تشغيل بيطلع هون، مع نتيجته.")}
      </p>
    );
  }

  const { ok, done } = successRate(runs.map((r) => r.status));
  const cost = runs.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        {t("{0} تشغيل · {1} من {2} نجحت", { 0: runs.length, 1: ok, 2: done })}
        {cost >= 0.0001 && ` · $${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`}
      </p>
      <motion.ol variants={listContainer} initial="hidden" animate="show" className="flex flex-col">
        {runs.map((run) => {
          const duration = formatDuration(run.duration_seconds);
          const note = run.error ?? run.summary;
          const clickable = Boolean(run.task_id) && run.status !== "deleted";
          return (
            <motion.li key={run.id} variants={listItem}>
              <button
                onClick={() => clickable && navigate(`/tasks/${run.task_id}`)}
                disabled={!clickable}
                className="relative flex w-full gap-3 rounded-lg py-2 pe-2 ps-5 text-start transition-colors enabled:hover:bg-[var(--color-surface-2)]"
              >
                {/* The timeline: a dot per run on a thin line. */}
                <span className="absolute inset-y-0 start-[9px] w-px" style={{ background: "var(--color-border)" }} aria-hidden />
                <span
                  className="absolute start-1 top-3 h-2.5 w-2.5 rounded-full ring-2"
                  style={{ background: runTone(run.status), ["--tw-ring-color" as string]: "var(--color-surface)" }}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="font-medium" style={{ color: runTone(run.status) === "var(--color-border)" ? "var(--color-ink-muted)" : runTone(run.status) }}>
                      {runLabel(run.status)}
                    </span>
                    <span style={{ color: "var(--color-ink-muted)" }}>
                      {dayLabel(run.started_at)} {clockTime(run.started_at)}
                    </span>
                    {run.trigger === "manual" && (
                      <span className="rounded px-1.5 py-px text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                        {t("يدوي")}
                      </span>
                    )}
                    {duration && (
                      <span className="tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                        {duration}
                      </span>
                    )}
                    {run.cost_usd >= 0.0001 && (
                      <span className="tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                        ${run.cost_usd < 0.01 ? run.cost_usd.toFixed(4) : run.cost_usd.toFixed(2)}
                      </span>
                    )}
                  </span>
                  {note && (
                    <span
                      className="line-clamp-2 text-xs leading-relaxed"
                      style={{ color: run.error ? "var(--color-danger)" : "var(--color-ink-muted)" }}
                      dir="auto"
                    >
                      {note}
                    </span>
                  )}
                </span>
              </button>
            </motion.li>
          );
        })}
      </motion.ol>
    </div>
  );
}
