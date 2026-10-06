/**
 * The pieces of Rafiq's visual language (docs/REDESIGN.md): blocks on a canvas, bracketed
 * labels, big numbers, segmented "LED" progress, chips, and the wireframe mark. Pages are
 * built from these instead of one-off borders and cards.
 */

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { easeOutExpo } from "../lib/motion";

type BlockTone = "default" | "alt" | "inverse";

const TONE: Record<BlockTone, CSSProperties> = {
  default: { background: "var(--color-surface)", color: "var(--color-ink)" },
  alt: { background: "var(--color-surface-2)", color: "var(--color-ink)" },
  // One per screen: the strongest piece of information.
  inverse: { background: "var(--color-inverse)", color: "var(--color-on-inverse)" },
};

/** A block on the canvas. The gap between blocks separates them; no border, no shadow. */
export function Block({
  tone = "default",
  className = "",
  style,
  children,
  as: As = "div",
  ...rest
}: {
  tone?: BlockTone;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  as?: "div" | "section" | "article" | "li";
} & Omit<React.HTMLAttributes<HTMLElement>, "style" | "className" | "children">) {
  return (
    <As className={`relative overflow-hidden rounded-2xl p-4 ${className}`} style={{ ...TONE[tone], ...style }} {...rest}>
      {children}
    </As>
  );
}

/** `( label )` — a block's small heading. Not for page titles. */
export function BracketLabel({ children, className = "", tone = "muted" }: { children: ReactNode; className?: string; tone?: "muted" | "inverse" }) {
  return (
    <p
      className={`text-[11px] leading-none ${className}`}
      style={{ color: tone === "inverse" ? "color-mix(in oklch, var(--color-on-inverse) 60%, transparent)" : "var(--color-ink-muted)" }}
    >
      <span aria-hidden>( </span>
      {children}
      <span aria-hidden> )</span>
    </p>
  );
}

/** A big number with an optional unit; counts up once when it first appears. */
export function BigNumber({
  value,
  unit,
  decimals = 0,
  size = 44,
  prefix = "",
  className = "",
}: {
  value: number;
  unit?: string;
  decimals?: number;
  size?: number;
  prefix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const count = useMotionValue(reduce ? value : 0);
  const shown = useTransform(count, (v) => `${prefix}${v.toFixed(decimals)}`);
  useEffect(() => {
    if (reduce) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, { duration: 0.9, ease: easeOutExpo });
    return () => controls.stop();
  }, [value, reduce, count]);
  return (
    <span className={`num inline-flex items-start font-bold leading-none ${className}`} style={{ fontSize: size }} dir="ltr">
      <motion.span>{shown}</motion.span>
      {unit && <span style={{ fontSize: Math.max(12, Math.round(size * 0.36)), marginInlineStart: 2 }}>{unit}</span>}
    </span>
  );
}

/** Progress in segments, like a hardware meter. `value` is 0..1. */
export function LedBar({
  value,
  segments = 12,
  className = "",
  tone = "ink",
  label,
}: {
  value: number;
  segments?: number;
  className?: string;
  /** "ink" for neutral progress, "accent" for something running now. */
  tone?: "ink" | "accent" | "inverse";
  label?: string;
}) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  const on = tone === "accent" ? "var(--color-accent)" : tone === "inverse" ? "var(--color-on-inverse)" : "var(--color-ink)";
  const off = tone === "inverse" ? "color-mix(in oklch, var(--color-on-inverse) 18%, transparent)" : "var(--color-border)";
  return (
    <div className={`flex gap-[3px] ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      {Array.from({ length: segments }, (_, i) => (
        <motion.span
          key={i}
          className="h-[5px] flex-1 rounded-[2px]"
          initial={false}
          animate={{ backgroundColor: i < lit ? on : off }}
          transition={{ duration: 0.25, delay: i < lit ? i * 0.02 : 0 }}
        />
      ))}
    </div>
  );
}

/** A small rounded option: model, mode, filter. */
export function Chip({
  children,
  active = false,
  onClick,
  className = "",
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? active : undefined}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${onClick ? "hover:bg-[var(--color-surface-2)]" : ""} ${className}`}
      style={{
        borderColor: active ? "var(--color-ink)" : "var(--color-border)",
        color: active ? "var(--color-ink)" : "var(--color-ink-muted)",
        background: active ? "var(--color-surface-2)" : "transparent",
      }}
    >
      {children}
    </Tag>
  );
}

/** The wireframe mark: a globe of thin lines. Decorative, geometric, never a picture. */
export function Wireframe({ size = 120, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.8}
      className={className}
      style={style}
      aria-hidden
    >
      <circle cx="60" cy="60" r="52" />
      <ellipse cx="60" cy="60" rx="52" ry="17" />
      <ellipse cx="60" cy="60" rx="52" ry="35" />
      <ellipse cx="60" cy="60" rx="17" ry="52" />
      <ellipse cx="60" cy="60" rx="35" ry="52" />
      <line x1="8" y1="60" x2="112" y2="60" />
      <line x1="60" y1="8" x2="60" y2="112" />
    </svg>
  );
}

/** A page title in the display face, with an optional quieter second line. */
export function PageTitle({ children, sub, className = "" }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h1 className="text-[28px] font-extrabold leading-[1.25]">{children}</h1>
      {sub && (
        <p className="mt-1 max-w-[62ch] text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
