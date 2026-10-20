/* EasyUI (skeleton) by Suraj Maurya, MIT — adapted for Rafiq (theme tokens, RTL sweep, language). See THIRD_PARTY_NOTICES.md. */
import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { t } from "../../i18n";

/** A quiet block with a slow light sweep — the shape of what's loading. Size it with className. */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const reduced = useReducedMotion() ?? false;
  // The sweep reads the way the page does: right to left in Arabic.
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  return (
    <div aria-hidden className={`relative overflow-hidden rounded-md ${className}`} style={{ background: "var(--color-surface-2)", ...style }}>
      {!reduced && (
        <motion.span
          className="absolute inset-0"
          style={{ background: "linear-gradient(90deg, transparent, var(--skeleton-sweep), transparent)" }}
          initial={{ x: rtl ? "100%" : "-100%" }}
          animate={{ x: rtl ? "-100%" : "100%" }}
          transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.2 }}
        />
      )}
    </div>
  );
}

const WIDTHS = ["100%", "94%", "98%", "88%"];

/** Lines of text that haven't arrived yet; the last one shorter, like a paragraph. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={`space-y-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: i === lines - 1 && lines > 1 ? "62%" : WIDTHS[i % WIDTHS.length] }} />
      ))}
    </div>
  );
}

/** Rows of a list (chats, tasks): a line of text and a short one at the far end. */
export function SkeletonRows({ rows = 4, height = 44, className = "" }: { rows?: number; height?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3" style={{ height }}>
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: WIDTHS[i % WIDTHS.length] }} />
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Swaps a skeleton for the real content, which eases in (fade, rise, un-blur). Keep the
 * skeleton about the size of the content so nothing jumps.
 */
export function SkeletonReveal({ loading, skeleton, children, className }: { loading: boolean; skeleton: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div key="skeleton" role="status" aria-busy="true" aria-label={t("عم يحمّل…")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
