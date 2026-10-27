/**
 * Small pieces of motion used across the app: numbers that roll to their new value, a button
 * that has to be held before it acts, a copy button whose icon turns into a check, and a
 * ring that counts down. Each one rests when the user asks for reduced motion.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useAnimate, useMotionValue, useReducedMotion, useTransform, type AnimationPlaybackControls } from "motion/react";
import { t } from "../i18n";
import { easeOutExpo } from "../lib/motion";
import { CopyIcon } from "./Icons";
import { DrawnCheck } from "./ui";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const roll = { type: "spring", visualDuration: 0.5, bounce: 0.12 } as const;

function Digit({ d }: { d: number }) {
  return (
    <span aria-hidden className="relative inline-block overflow-hidden" style={{ height: "1lh" }}>
      <span className="invisible">0</span>
      <motion.span className="absolute inset-x-0 top-0 flex flex-col items-center" initial={false} animate={{ y: `${-d * 10}%` }} transition={roll}>
        {DIGITS.map((n) => (
          <span key={n} style={{ height: "1lh" }}>
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * A number whose digits roll to the new value, like a counter: only the digits that changed
 * move. Columns are matched from the units up, so a number that gains a digit doesn't shift
 * the ones it had.
 */
export function NumberFlow({ value, format = String, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const text = format(value);
  if (reduce) return <span className={`num ${className ?? ""}`}>{text}</span>;
  const chars = [...text];
  return (
    <span className={`num inline-flex ${className ?? ""}`} dir="ltr" role="img" aria-label={text}>
      {chars.map((c, i) => {
        const place = chars.length - i;
        return /\d/.test(c) ? (
          <Digit key={`d${place}`} d={Number(c)} />
        ) : (
          <span key={`s${place}`} aria-hidden>
            {c}
          </span>
        );
      })}
    </span>
  );
}

/** Pops its content once each time `value` goes up — a count that just grew. */
export function Bump({ value, children }: { value: number; children: React.ReactNode }) {
  const [scope, run] = useAnimate();
  const last = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (value > last.current && !reduce && scope.current) void run(scope.current, { scale: [1, 1.35, 1] }, { duration: 0.4, ease: easeOutExpo });
    last.current = value;
  }, [value, reduce, run, scope]);
  return (
    <span ref={scope} className="inline-flex">
      {children}
    </span>
  );
}

/**
 * A button for something that can't be taken back: it acts only after being held for
 * `duration` ms while a fill sweeps across it in the reading direction. Letting go early
 * drains the fill; a plain click says to hold it. Space and Enter hold it from the keyboard.
 */
export function HoldButton({
  onConfirm,
  children,
  duration = 900,
  className = "",
  style,
  fill = "color-mix(in oklch, var(--color-on-inverse) 28%, transparent)",
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
  fill?: string;
}) {
  const progress = useMotionValue(0);
  const run = useRef<AnimationPlaybackControls | null>(null);
  const pressedAt = useRef(0);
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const done = useRef(false);
  const rtl = document.documentElement.dir === "rtl";

  useEffect(() => () => run.current?.stop(), []);

  function press() {
    if (done.current || run.current) return;
    pressedAt.current = performance.now();
    setHolding(true);
    setHint(false);
    run.current = animate(progress, 1, {
      duration: (duration / 1000) * (1 - progress.get()),
      ease: "linear",
      onComplete: () => {
        done.current = true;
        run.current = null;
        setHolding(false);
        onConfirm();
      },
    });
  }

  function release() {
    if (done.current || !run.current) return;
    run.current.stop();
    run.current = null;
    setHolding(false);
    if (performance.now() - pressedAt.current < 250) setHint(true);
    animate(progress, 0, { duration: 0.3, ease: easeOutExpo });
  }

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 1800);
    return () => window.clearTimeout(id);
  }, [hint]);

  return (
    <motion.button
      type="button"
      onPointerDown={(e) => e.button === 0 && press()}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          press();
        }
      }}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && release()}
      onBlur={release}
      animate={hint ? { x: [0, -4, 4, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.36 }}
      className={`relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-medium ${className}`}
      style={style}
    >
      <motion.span aria-hidden className="pointer-events-none absolute inset-0" style={{ scaleX: progress, transformOrigin: rtl ? "100% 50%" : "0% 50%", background: fill }} />
      <span className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={hint ? "hint" : holding ? "holding" : "rest"}
            className="inline-block"
            initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
          >
            {hint ? t("اضغط مطوّل") : holding ? t("ضلّك ضاغط…") : children}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

/**
 * Copies on click; the copy icon turns into a check that draws itself, and the label (if
 * any) says it was copied, then both go back. `value` can be a function for text that's
 * costly to build.
 */
export function CopyButton({
  value,
  label,
  copiedLabel = t("انتسخ"),
  title,
  className = "",
  style,
  onCopied,
}: {
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const swap = {
    initial: { opacity: 0, scale: 0.6, filter: "blur(2px)" },
    animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
    exit: { opacity: 0, scale: 0.6, filter: "blur(2px)", transition: { duration: 0.12 } },
    transition: { type: "spring", visualDuration: 0.3, bounce: 0.2 },
  } as const;

  return (
    <button
      type="button"
      onClick={() => {
        const text = typeof value === "function" ? value() : value;
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          onCopied?.();
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1400);
        });
      }}
      aria-label={title ?? label ?? t("نسخ")}
      title={title ?? label}
      className={`inline-flex items-center gap-1 ${className}`}
      style={copied ? { ...style, color: "var(--color-success)" } : style}
    >
      <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {copied ? (
            <motion.span key="done" className="inline-flex" {...swap}>
              <DrawnCheck className="h-3.5 w-3.5" />
            </motion.span>
          ) : (
            <motion.span key="copy" className="inline-flex" {...swap}>
              <CopyIcon className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {label && <span role="status">{copied ? copiedLabel : label}</span>}
    </button>
  );
}

/** A thin ring that empties over `seconds` — how long something stays (an undo, a toast). */
export function CountdownRing({ seconds, paused = false, size = 22, className }: { seconds: number; paused?: boolean; size?: number; className?: string }) {
  const left = useMotionValue(1);
  const r = (size - 2) / 2;
  const c = 2 * Math.PI * r;
  const offset = useTransform(left, (v) => c * (1 - v));
  useEffect(() => {
    if (paused || !Number.isFinite(seconds)) return;
    const run = animate(left, 0, { duration: seconds * left.get(), ease: "linear" });
    return () => run.stop();
  }, [left, paused, seconds]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={1.5} />
      <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeDasharray={c} style={{ strokeDashoffset: offset }} />
    </svg>
  );
}
