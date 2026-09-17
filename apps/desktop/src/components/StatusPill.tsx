import { AnimatePresence, motion } from "motion/react";
import type { TaskStatus } from "../lib/types";
import { statusLabel } from "../lib/api";
import { easeOutExpo } from "../lib/motion";
import { ClockIcon, ShieldIcon, SpinnerIcon, XCircleIcon } from "./Icons";
import { DrawnCheck } from "./ui";

const color: Record<TaskStatus, string> = {
  queued: "var(--color-ink-muted)",
  pending: "var(--color-ink-muted)",
  running: "var(--color-accent)",
  planned: "var(--color-pending)",
  completed: "var(--color-success)",
  failed: "var(--color-danger)",
  cancelled: "var(--color-ink-muted)",
};

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "running") return <SpinnerIcon className="h-3.5 w-3.5" />;
  if (status === "completed") return <DrawnCheck className="h-3.5 w-3.5" />;
  if (status === "pending" || status === "queued") return <ClockIcon className="h-3.5 w-3.5" />;
  if (status === "planned") return <ShieldIcon className="h-3.5 w-3.5" />;
  return <XCircleIcon className="h-3.5 w-3.5" />;
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <motion.span
      layout
      className="inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-[color,background-color,border-color] duration-300"
      style={{
        color: color[status],
        borderColor: status === "running" ? "color-mix(in oklch, var(--color-accent) 45%, transparent)" : "var(--color-border)",
        background: status === "running" ? "color-mix(in oklch, var(--color-accent) 8%, transparent)" : "transparent",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          className="flex items-center gap-1.5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: easeOutExpo }}
        >
          <StatusIcon status={status} />
          {statusLabel(status)}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
