/** How much of a daily limit is spent: a thin bar that warms up as it fills. */

import { motion } from "motion/react";
import { easeOutExpo } from "../lib/motion";
import { t } from "../i18n";

export type BudgetTone = "none" | "ok" | "near" | "over";

/** How full a budget is, and how worried to look. No limit (0/null) is "none". */
export function budgetState(spent: number, limit: number | null | undefined): { ratio: number; tone: BudgetTone } {
  if (!limit || limit <= 0) return { ratio: 0, tone: "none" };
  const ratio = Math.max(0, spent / limit);
  return { ratio, tone: ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok" };
}

const TONE: Record<BudgetTone, string> = {
  none: "var(--color-ink-muted)",
  ok: "var(--color-success)",
  near: "var(--color-pending)",
  over: "var(--color-danger)",
};

export function money(value: number): string {
  if (!value) return "$0";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function BudgetMeter({ spent, limit, className = "" }: { spent: number; limit: number | null | undefined; className?: string }) {
  const { ratio, tone } = budgetState(spent, limit);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-[11px] tabular-nums" style={{ color: tone === "over" ? TONE.over : "var(--color-ink-muted)" }}>
        {tone === "none"
          ? t("اليوم {0} · بلا حد", { 0: money(spent) })
          : tone === "over"
            ? t("وصل الحد: {0} من {1}", { 0: money(spent), 1: money(limit ?? 0) })
            : t("اليوم {0} من {1}", { 0: money(spent), 1: money(limit ?? 0) })}
      </span>
      {tone !== "none" && (
        <span className="h-1 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }} aria-hidden>
          <motion.span
            className="block h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, ratio * 100)}%` }}
            transition={{ duration: 0.5, ease: easeOutExpo }}
            style={{ background: TONE[tone] }}
          />
        </span>
      )}
    </div>
  );
}
