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
  in_progress: "var(--color-ink)",
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
        borderColor: active ? "var(--color-inverse)" : "var(--color-border)",
        color: active ? "var(--color-on-inverse)" : "var(--color-ink-muted)",
        background: active ? "var(--color-inverse)" : "transparent",
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
  checked = false,
  selecting = false,
  onToggle,
}: {
  issue: TrackerIssue;
  active: boolean;
  onOpen: () => void;
  checked?: boolean;
  /** Something is already ticked: every row shows its box, not just the hovered one. */
  selecting?: boolean;
  onToggle?: () => void;
}) {
  const overdue = isOverdue(issue);
  const done = issue.status_category === "done";

  return (
    <motion.li variants={listItem} layout="position" className="group relative">
      {onToggle && (
        <button
          role="checkbox"
          aria-checked={checked}
          aria-label={t("حدّد {0}", { 0: issue.key })}
          onClick={onToggle}
          className={`absolute start-2 top-3.5 z-10 flex h-4 w-4 items-center justify-center rounded border transition-opacity ${
            selecting || checked ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100"
          }`}
          style={{
            borderColor: checked ? "var(--color-inverse)" : "var(--color-border-strong, var(--color-ink-muted))",
            background: checked ? "var(--color-inverse)" : "var(--color-surface)",
            color: "var(--color-on-inverse)",
          }}
        >
          {checked && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
              <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      )}
      <motion.button
        onClick={onOpen}
        whileTap={{ scale: 0.995 }}
        transition={snappy}
        className={`relative flex w-full items-start gap-3 py-3 pe-4 text-start transition-colors hover:bg-[var(--color-surface-2)] ${onToggle ? "ps-8" : "ps-4"}`}
        style={{
          background: checked ? "color-mix(in oklch, var(--color-inverse) 8%, transparent)" : active ? "var(--color-surface-2)" : "transparent",
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
            {issue.kind === "pull_request" && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)" }}>
                PR
              </span>
            )}
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

/** A card on the board: the same facts as a row, stacked. Drag it to another column. */
export function IssueCard({
  issue,
  active,
  onOpen,
  onDragStart,
}: {
  issue: TrackerIssue;
  active: boolean;
  onOpen: () => void;
  onDragStart: (event: React.DragEvent) => void;
}) {
  const overdue = isOverdue(issue);
  return (
    <motion.div layout="position" variants={listItem}>
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={onDragStart}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        className="cursor-grab rounded-xl px-3 py-2.5 text-start shadow-sm transition-colors active:cursor-grabbing"
        style={{ background: active ? "var(--color-surface-2)" : "var(--color-surface)", outline: active ? "1.5px solid var(--color-ink)" : undefined }}
      >
        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          <BrandMark provider={issue.provider} className="h-3 w-3" />
          <span className="font-mono" dir="ltr">{issue.key}</span>
          {issue.priority && <span>· {issue.priority}</span>}
        </span>
        <span className="mt-1 line-clamp-3 block text-sm" dir="auto">
          {issue.title}
        </span>
        {(issue.due_date || issue.assignee) && (
          <span className="mt-1.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {issue.due_date && (
              <span className="flex items-center gap-1" style={{ color: overdue ? "var(--color-danger)" : undefined }}>
                <ClockIcon className="h-3 w-3" />
                {dateLabel(issue.due_date)}
              </span>
            )}
            {issue.assignee && <span className="truncate">{issue.assignee}</span>}
          </span>
        )}
      </div>
    </motion.div>
  );
}
