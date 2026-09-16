/** The small building blocks every settings section uses, so they all look and move alike. */

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { snappy } from "../../lib/motion";

export function Card({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: danger ? "var(--color-danger)" : "var(--color-border)", background: "var(--color-surface)" }}
    >
      {children}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
      {children}
    </p>
  );
}

export function Switch({ checked, onChange, label, tone = "accent" }: { checked: boolean; onChange: (v: boolean) => void; label: string; tone?: "accent" | "danger" }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
      style={{
        background: checked ? `var(--color-${tone})` : "var(--color-surface-2)",
        justifyContent: checked ? "flex-end" : "flex-start",
      }}
    >
      <motion.span layout transition={snappy} className="h-5 w-5 rounded-full bg-white shadow-sm" />
    </button>
  );
}

export function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-start"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {hint}
        </span>
      </span>
      <span
        className="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
        style={{ background: checked ? "var(--color-accent)" : "var(--color-surface-2)", justifyContent: checked ? "flex-end" : "flex-start" }}
      >
        <motion.span layout transition={snappy} className="h-5 w-5 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

/** One choice out of a short list — saved the moment it changes. */
export function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <Hint>{hint}</Hint>
        </div>
        <select
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label={label}
          className="input max-w-52 shrink-0 py-1.5 text-sm"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}

/**
 * A number on a slider. Dragging only moves the number; letting go saves it, so a sweep
 * across the slider is one save, not fifty.
 */
export function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  lowLabel,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  lowLabel?: string;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <Hint>{hint}</Hint>
        </div>
        <motion.span
          key={draft}
          initial={{ y: -4, opacity: 0.4 }}
          animate={{ y: 0, opacity: 1 }}
          transition={snappy}
          className="shrink-0 text-2xl font-semibold tabular-nums"
          style={{ color: "var(--color-accent)" }}
        >
          {draft}
        </motion.span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label={label}
        className="mt-3 w-full accent-[var(--color-accent)]"
      />
      <div className="mt-1 flex justify-between text-[11px] tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
        <span>{lowLabel ?? min}</span>
        <span>{max}</span>
      </div>
    </Card>
  );
}
