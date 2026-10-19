/** The inbox as a board: three columns by where an issue stands. Dropping a card in another
 *  column moves it there on the tracker — through the tracker's own transitions, so a
 *  workflow that forbids the move says so instead of being bypassed. */

import { useState } from "react";
import { motion } from "motion/react";
import { listIssueStatuses, setIssueStatus } from "../../lib/api";
import type { TrackerIssue } from "../../lib/types";
import { listContainer } from "../../lib/motion";
import { notify } from "../../lib/toast";
import { CATEGORY_COLOR, CATEGORY_LABEL, IssueCard, issueId } from "./pieces";
import { t } from "../../i18n";

const COLUMNS = ["todo", "in_progress", "done"] as const;
type Column = (typeof COLUMNS)[number];

export function Board({
  issues,
  selected,
  onOpen,
  onMoved,
}: {
  issues: TrackerIssue[];
  selected: string | null;
  onOpen: (issue: TrackerIssue) => void;
  onMoved: (issue: TrackerIssue, status: string, category: Column) => void;
}) {
  const [over, setOver] = useState<Column | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  async function drop(column: Column, id: string) {
    setOver(null);
    const issue = issues.find((i) => issueId(i) === id);
    if (!issue || (issue.status_category ?? "todo") === column) return;
    setMoving(id);
    try {
      const options = await listIssueStatuses(issue.integration_id, issue.key);
      const target = options.find((o) => o.category === column);
      if (!target) {
        notify({ type: "warning", title: t("{0} ما فيها انتقال لـ «{1}» من حالتها هلّق.", { 0: issue.key, 1: CATEGORY_LABEL[column] }) });
        return;
      }
      const { status } = await setIssueStatus(issue.integration_id, issue.key, target.id);
      onMoved(issue, status, column);
      notify({ type: "success", title: t("{0} صارت «{1}»", { 0: issue.key, 1: status }) });
    } catch (err) {
      notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="grid min-h-0 gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(220px, 1fr))" }}>
      {COLUMNS.map((column) => {
        const items = issues.filter((i) => (i.status_category ?? "todo") === column);
        return (
          <section
            key={column}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(column);
            }}
            onDragLeave={() => setOver((c) => (c === column ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              void drop(column, e.dataTransfer.getData("text/plain"));
            }}
            className="flex min-h-40 flex-col gap-2 rounded-2xl p-2 transition-colors"
            style={{
              background: over === column ? "color-mix(in oklch, var(--color-inverse) 8%, var(--color-surface-2))" : "var(--color-surface-2)",
            }}
          >
            <h2 className="flex items-center gap-2 px-1.5 pt-1 text-xs font-medium">
              <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[column] }} />
              {CATEGORY_LABEL[column]}
              <span style={{ color: "var(--color-ink-muted)" }}>{items.length}</span>
            </h2>
            <motion.div variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
              {items.map((issue) => (
                <div key={issueId(issue)} style={{ opacity: moving === issueId(issue) ? 0.5 : 1 }}>
                  <IssueCard
                    issue={issue}
                    active={selected === issueId(issue)}
                    onOpen={() => onOpen(issue)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", issueId(issue));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  />
                </div>
              ))}
            </motion.div>
          </section>
        );
      })}
    </div>
  );
}
