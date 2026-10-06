import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { easeOutExpo, pressable } from "../lib/motion";
import { Illustration, type Scene } from "./Illustration";

/**
 * primary — solid ink, the everyday "do it" button.
 * accent  — orange; only the one action a screen is for (send, start, export).
 * soft    — a quiet filled button; ghost — text only; danger — outlined red.
 */
type ButtonVariant = "primary" | "accent" | "soft" | "ghost" | "danger";

const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "var(--color-inverse)", color: "var(--color-on-inverse)" },
  accent: { background: "var(--color-accent)", color: "var(--color-accent-ink)" },
  soft: { background: "var(--color-surface-2)", color: "var(--color-ink)" },
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
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 py-2 text-sm font-medium transition-[opacity,background-color,filter] disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === "ghost" ? "hover:bg-[var(--color-surface-2)]" : variant === "soft" ? "hover:bg-[var(--color-border)]" : "enabled:hover:brightness-110"
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

/** A quiet block that says what goes here and how to fill it. */
export function EmptyState({
  icon,
  scene,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  /** A hand-drawn figure instead of the icon. */
  scene?: Scene;
  title?: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOutExpo } }}
      className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl px-6 py-14 text-center"
      style={{ background: "var(--color-surface-2)" }}
    >
      {scene ? (
        <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
          <Illustration scene={scene} size={150} />
        </motion.div>
      ) : (
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          className="flex h-14 w-14 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6"
          style={{ background: "var(--color-surface)", color: "var(--color-ink)" }}
        >
          {icon}
        </motion.div>
      )}
      {title && (
        <p className="text-base font-bold" style={{ fontFamily: "var(--font-display)" }}>
          {title}
        </p>
      )}
      <p className="max-w-sm text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
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
