/* EasyUI (typewriter-button) by Suraj Maurya, MIT — adapted for Rafiq (Arabic text by grapheme, theme tokens, no sound). See THIRD_PARTY_NOTICES.md. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Splits text the way it's read: a letter with its marks is one step, never half a letter. */
function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment) : Array.from(text);
}

/**
 * A button whose label types itself out, with a blinking caret, when it first appears —
 * and again on hover, when it's been idle. Clicking works at any moment.
 */
export function TypewriterButton({
  children,
  onClick,
  icon,
  charMs = 55,
  delayMs = 400,
  tone = "inverse",
  className = "",
}: {
  children: string;
  onClick: () => void;
  icon?: ReactNode;
  charMs?: number;
  delayMs?: number;
  /** "accent" for the one orange action on a screen. */
  tone?: "inverse" | "accent";
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const chars = graphemes(children);
  const [shown, setShown] = useState(reduced ? chars.length : 0);
  const [typing, setTyping] = useState(!reduced);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const type = useCallback(
    (wait: number) => {
      if (reduced) return;
      if (timer.current) clearTimeout(timer.current);
      setTyping(true);
      setShown(0);
      let n = 0;
      const step = () => {
        n += 1;
        setShown(n);
        if (n < chars.length) timer.current = setTimeout(step, charMs);
        else setTyping(false);
      };
      timer.current = setTimeout(step, wait);
    },
    [reduced, chars.length, charMs],
  );

  useEffect(() => {
    type(delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [type, delayMs]);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onHoverStart={() => !typing && type(0)}
      whileHover={{ y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.5 }}
      aria-label={children}
      className={`relative inline-flex min-w-40 items-center justify-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${className}`}
      style={tone === "accent" ? { background: "var(--color-accent)", color: "var(--color-accent-ink)" } : { background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}
    >
      {/* The full label sits invisibly underneath, so the button never changes size. */}
      <span className="invisible flex items-center gap-2" aria-hidden>
        {icon}
        {children}
      </span>
      <span className="absolute inset-0 flex items-center justify-center gap-2" aria-hidden>
        {icon}
        <span>
          {chars.slice(0, shown).join("")}
          {typing && <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }} className="ms-0.5 inline-block h-4 w-[3px] translate-y-0.5 bg-current" />}
        </span>
      </span>
    </motion.button>
  );
}
