/**
 * The frame every list page shares — same header, same refresh control, same status
 * stripe on each row — so moving between pages feels like one app, not seven.
 */

import { motion } from "motion/react";
import { easeOutExpo } from "../lib/motion";
import { RefreshIcon } from "./Icons";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: easeOutExpo }}
      className="mb-6 flex items-start justify-between gap-4"
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-1 max-w-xl text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

/** Icon button that spins for as long as a refresh is actually in flight. */
export function RefreshButton({
  spinning,
  onClick,
  label = "تحديث",
}: {
  spinning: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={spinning}
      aria-label={label}
      title={label}
      className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-default"
      style={{ color: "var(--color-ink-muted)" }}
    >
      <motion.span
        className="block"
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { duration: 0.9, repeat: Infinity, ease: "linear" } : { duration: 0 }}
      >
        <RefreshIcon className="h-4 w-4" />
      </motion.span>
    </motion.button>
  );
}

/** The coloured edge on a row that says its state before you read a word. */
export function StatusStripe({ color }: { color: string }) {
  return (
    <span
      className="absolute inset-y-0 start-0 w-0.5 transition-colors duration-300"
      style={{ background: color }}
      aria-hidden
    />
  );
}
