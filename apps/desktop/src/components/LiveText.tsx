/**
 * Text that shows work in progress: a shimmer that sweeps across a label the way the eye
 * reads it, a swap that blurs the old words out and the new ones in (the box resizing
 * smoothly between them), and an eight-ray spinner. All of them rest when the user asks
 * for reduced motion.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/** A label with a light sweeping across it, in the reading direction. */
export function ShimmerText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`shimmer-text ${className ?? ""}`} dir="auto">
      {children}
    </span>
  );
}

const SWAP = { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };

/**
 * One line of text that changes in place: the old words rise and blur away, the new ones
 * rise in sharp, and the line's width follows. `id` decides when it's a new state (the
 * text itself by default).
 */
export function TextSwap({ text, id, children, className }: { text: string; id?: string; children?: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const key = id ?? text;
  // From the text itself: dir="auto" can't see into a child that sets its own direction.
  const dir = /[֐-ࣿ]/.test(text) ? "rtl" : "ltr";
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    // Rounded up: a box a fraction of a pixel narrower than its text truncates it.
    const fit = () => setWidth(Math.ceil(el.getBoundingClientRect().width) + 1);
    fit();
    // The width changes again when the web font arrives (or the text size changes): follow it.
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [key, text]);
  return (
    <motion.span
      className={`relative inline-flex min-w-0 align-bottom ${className ?? ""}`}
      animate={width === null ? undefined : { width }}
      transition={reduce ? { duration: 0 } : SWAP}
      // Clipped top and bottom only (the rise in and out); sideways the words always show whole.
      style={{ maxWidth: "100%", overflowY: "clip", overflowX: "visible" }}
    >
      {/* the next state, laid out invisibly so the box knows how wide to become */}
      <span ref={measure} className="invisible absolute whitespace-nowrap" aria-hidden dir={dir}>
        {children ?? text}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={key}
          className="block whitespace-nowrap"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: "70%", filter: "blur(6px)" }}
          animate={{ opacity: 1, y: "0%", filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: "-70%", filter: "blur(6px)" }}
          transition={SWAP}
          dir={dir}
        >
          {children ?? text}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
