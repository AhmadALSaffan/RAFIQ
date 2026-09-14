import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { easeOutExpo, pressable } from "../lib/motion";

type ButtonVariant = "primary" | "ghost" | "danger";

const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "var(--color-accent)", color: "var(--color-accent-ink)" },
  ghost: { color: "var(--color-ink-muted)" },
  danger: { border: "1px solid var(--color-danger)", color: "var(--color-danger)" },
};

export function Button({
  variant = "primary",
  className = "",
  style,
  children,
  ...rest
}: HTMLMotionProps<"button"> & { variant?: ButtonVariant }) {
  const disabled = rest.disabled;
  return (
    <motion.button
      {...(disabled ? {} : pressable)}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-[opacity,background-color] disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === "ghost" ? "hover:bg-[var(--color-surface-2)]" : ""
      } ${className}`}
      style={{ ...variantStyle[variant], ...style }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/** Height-animated reveal for inline panels (forms, details). */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { duration: 0.34, ease: easeOutExpo } }}
          exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: "easeIn" } }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({
  icon,
  text,
  action,
}: {
  icon: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.4, ease: easeOutExpo } }}
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center"
      style={{ borderColor: "var(--color-border)" }}
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        style={{ color: "var(--color-ink-muted)" }}
      >
        {icon}
      </motion.div>
      <p className="max-w-sm text-sm" style={{ color: "var(--color-ink-muted)" }}>
        {text}
      </p>
      {action}
    </motion.div>
  );
}

/** Checkmark that draws itself — used when a verification succeeds. */
export function DrawnCheck({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.42, ease: easeOutExpo }}
      />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span style={{ color: "var(--color-ink-muted)" }}>{label}</span>
      {children}
      {hint && (
        <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          key={message}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: [6, -4, 2, 0], transition: { duration: 0.36 } }}
          exit={{ opacity: 0 }}
          className="text-sm"
          style={{ color: "var(--color-danger)" }}
          role="alert"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
