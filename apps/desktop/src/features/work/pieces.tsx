/** Small shared bits of the inbox: status vocabulary, date helpers, chips, and the row. */

import { motion } from "motion/react";
import type { TrackerIssue } from "../../lib/types";
import { listItem, snappy } from "../../lib/motion";
import { parseUtc, timeAgo } from "../../lib/time";
import { BrandMark } from "../../components/BrandMark";
import { ChatIcon, ClockIcon } from "../../components/Icons";

import { intlLocale, t } from "../../i18n";
export const CATEGORY_LABEL: Record<string, string> = {
  todo: t("لسا ما بلّشت"),
  in_progress: t("شغّال عليها"),
  done: t("مكتملة"),
};

export const CATEGORY_COLOR: Record<string, string> = {
  todo: "var(--color-ink-muted)",
  in_progress: "var(--color-accent)",
  done: "var(--color-success)",
};

export function issueId(issue: TrackerIssue): string {
  return `${issue.integration_id}::${issue.key}`;
}

export function dateLabel(value: string | null): string | null {
  if (!value) return null;
  const date = parseUtc(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(intlLocale(), { year: "numeric", month: "short", day: "numeric" });
}

/** Past due and not finished — the one thing worth colouring red in a list. */
export function isOverdue(issue: TrackerIssue): boolean {
  if (!issue.due_date || issue.status_category === "done") return false;
  return parseUtc(issue.due_date).getTime() < Date.now();
}

export function StatusChip({ issue }: { issue: TrackerIssue }) {
  const category = issue.status_category ?? "todo";
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
      style={{
        borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
        color,
        background: `color-mix(in oklch, ${color} 10%, transparent)`,
      }}
      title={CATEGORY_LABEL[category]}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {issue.status}
    </span>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs transition-colors"
      style={{
        borderColor: active ? "var(--color-accent)" : "var(--color-border)",
        color: active ? "var(--color-ink)" : "var(--color-ink-muted)",
        background: active ? "color-mix(in oklch, var(--color-accent) 12%, transparent)" : "transparent",
      }}
    >
      <span className="relative flex items-center gap-1">{children}</span>
    </button>
  );
}

/** One line in the inbox: what it is, where it stands, and what's urgent about it. */
export function IssueRow({
  issue,
  active,
  onOpen,
}: {
  issue: TrackerIssue;
  active: boolean;
  onOpen: () => void;
}) {
  const overdue = isOverdue(issue);
  const done = issue.status_category === "done";

  return (
    <motion.li variants={listItem} layout="position">
      <motion.button
        onClick={onOpen}
        whileTap={{ scale: 0.995 }}
        transition={snappy}
        className="relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-start transition-colors hover:bg-[var(--color-surface-2)]"
        style={{
          borderColor: active ? "var(--color-accent)" : "var(--color-border)",
          background: active ? "color-mix(in oklch, var(--color-accent) 8%, transparent)" : "var(--color-surface)",
          opacity: done ? 0.7 : 1,
        }}
      >
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: CATEGORY_COLOR[issue.status_category ?? "todo"] }}
          title={CATEGORY_LABEL[issue.status_category ?? "todo"]}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <BrandMark provider={issue.provider} className="h-3.5 w-3.5 shrink-0" />
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium"
              dir="auto"
              style={{ textDecoration: done ? "line-through" : undefined }}
            >
              {issue.title}
            </span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <span className="font-mono" dir="ltr">
              {issue.key}
            </span>
            {issue.project && <span>· {issue.project}</span>}
            {issue.priority && <span>· {issue.priority}</span>}
            {issue.labels.slice(0, 2).map((label) => (
              <span key={label} className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)" }}>
                {label}
              </span>
            ))}
            {issue.due_date && (
              <span className="flex items-center gap-1" style={{ color: overdue ? "var(--color-danger)" : undefined }}>
                <ClockIcon className="h-3 w-3" />
                {dateLabel(issue.due_date)}
              </span>
            )}
            {issue.comment_count ? (
              <span className="flex items-center gap-1">
                <ChatIcon className="h-3 w-3" />
                {issue.comment_count}
              </span>
            ) : null}
            {issue.updated_at && <span>· {timeAgo(issue.updated_at)}</span>}
          </span>
        </span>
        <StatusChip issue={issue} />
      </motion.button>
    </motion.li>
  );
}
