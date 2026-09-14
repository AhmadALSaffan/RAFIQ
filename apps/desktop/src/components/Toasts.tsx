import { AnimatePresence, motion } from "motion/react";
import { easeOutExpo, snappy } from "../lib/motion";
import { AlertIcon, ShieldIcon, XIcon } from "./Icons";
import { DrawnCheck } from "./ui";

import { t } from "../i18n";
export interface Toast {
  id: string;
  tone: "approval" | "success" | "danger";
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const toneColor: Record<Toast["tone"], string> = {
  approval: "var(--color-pending)",
  success: "var(--color-success)",
  danger: "var(--color-danger)",
};

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="pointer-events-none fixed bottom-5 end-5 flex w-80 flex-col-reverse gap-2"
      style={{ zIndex: "var(--z-index-toast)" as unknown as number }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }}
            transition={{ layout: snappy, duration: 0.35, ease: easeOutExpo }}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${toast.tone === "approval" ? "pending-ring" : ""}`}
            style={{ borderColor: toneColor[toast.tone], background: "var(--color-surface)" }}
            role="status"
          >
            <span className="mt-0.5 shrink-0" style={{ color: toneColor[toast.tone] }}>
              {toast.tone === "approval" ? <ShieldIcon className="h-5 w-5" /> : toast.tone === "success" ? <DrawnCheck className="h-5 w-5" /> : <AlertIcon className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.body && (
                <p className="mt-0.5 truncate text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                  {toast.body}
                </p>
              )}
              {toast.onAction && (
                <button
                  onClick={toast.onAction}
                  className="mt-2 rounded-md px-2.5 py-1 text-xs font-medium"
                  style={{ background: toneColor[toast.tone], color: toast.tone === "approval" ? "var(--color-accent-ink)" : "white" }}
                >
                  {toast.actionLabel ?? t("افتح")}
                </button>
              )}
            </div>
            <button onClick={() => onDismiss(toast.id)} aria-label={t("إغلاق")} className="shrink-0 rounded p-0.5" style={{ color: "var(--color-ink-muted)" }}>
              <XIcon className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
