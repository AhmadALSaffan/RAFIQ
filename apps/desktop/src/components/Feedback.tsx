/**
 * Two pieces of feedback the app reuses wherever something takes time or finishes well:
 * a progress line while work is in flight, and a one-shot sweep when it lands.
 *
 * Both are deliberately honest — the bar never claims a percentage it doesn't know, and
 * the sweep only plays on a real state change, not on every render.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOutExpo } from "../lib/motion";
import { CheckCircleIcon } from "./Icons";

/** A thin bar pinned to the top of its container while `active` is true. */
export function ActionProgress({ active, className = "absolute inset-x-0 top-0" }: { active: boolean; className?: string }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) {
      setValue((v) => (v > 0 ? 100 : 0));
      const reset = setTimeout(() => setValue(0), 260);
      return () => clearTimeout(reset);
    }
    setValue(14);
    // Creeps toward 88% and slows down — enough to say "still working", never a lie.
    const tick = setInterval(() => setValue((v) => (v >= 88 ? v : v + Math.max(1, (88 - v) / 10))), 110);
    return () => clearInterval(tick);
  }, [active]);

  return (
    <AnimatePresence>
      {value > 0 && (
        <motion.div
          className={`${className} h-0.5 overflow-hidden`}
          style={{ zIndex: 20 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="h-full"
            style={{ background: "var(--color-accent)" }}
            animate={{ width: `${value}%` }}
            transition={{ duration: value === 100 ? 0.16 : 0.28, ease: "easeOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A green wash and a check, for the moment something is actually done. */
export function CompletionSweep({
  show,
  onDone,
  tone = "success",
}: {
  show: boolean;
  onDone: () => void;
  tone?: "success" | "danger";
}) {
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(onDone, 1100);
    return () => clearTimeout(timer);
  }, [show, onDone]);

  const color = tone === "danger" ? "var(--color-danger)" : "var(--color-success)";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 15 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          <motion.span
            className="absolute inset-0"
            style={{ background: `color-mix(in oklch, ${color} 14%, transparent)` }}
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            transition={{ duration: 0.45, ease: easeOutExpo }}
          />
          <motion.span
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.12 }}
            className="relative flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: color, color: "var(--color-bg)" }}
          >
            <CheckCircleIcon className="h-8 w-8" />
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
