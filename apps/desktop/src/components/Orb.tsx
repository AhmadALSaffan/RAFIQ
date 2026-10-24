import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { t } from "../i18n";

/** Rafiq at work: a small glowing orb in the accent (styles in index.css, `.orb`). */
export function Orb({ size = 28, label = t("رفيق عم يشتغل…"), className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <span className={`orb ${className}`} style={{ width: size, height: size }} role="status" aria-label={label} title={label}>
      <span className="orb-glow" aria-hidden />
      <span className="orb-core" aria-hidden />
      <span className="orb-swirl" aria-hidden />
      <span className="orb-swirl-2" aria-hidden />
      <span className="orb-shine" aria-hidden />
      <span className="orb-rim" aria-hidden />
    </span>
  );
}

// Where the next working orb flies in from (the send button that was just pressed).
let launch: { x: number; y: number; at: number } | null = null;

/** The page's own scale (the text-size setting zooms the whole page): rectangles come back
 *  scaled by it, positions inside the page don't, so a rectangle is divided by it. */
const pageZoom = () => Number.parseFloat(document.documentElement.style.zoom) || 1;

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const z = pageZoom();
  return { x: (r.left + r.width / 2) / z, y: (r.top + r.height / 2) / z };
}

/** The send button was pressed: the next working orb rises out of it. */
export function launchOrb(from: Element | null): void {
  if (!from) return;
  launch = { ...centre(from), at: Date.now() };
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The orb on the "working…" line. Right after a send it flies there from the button, on
 *  an arc, and lands in its place; otherwise it's simply there. */
export function WorkOrb({ size = 16 }: { size?: number }) {
  const spot = useRef<HTMLSpanElement>(null);
  const [flight, setFlight] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } | null } | null>(null);

  useLayoutEffect(() => {
    const from = launch;
    launch = null;
    if (!from || Date.now() - from.at > 4000 || reduced() || !spot.current) return;
    // hidden until it lands; measured once the chat has scrolled to the new line
    setFlight({ from, to: null });
    const timer = window.setTimeout(() => {
      if (spot.current) setFlight({ from, to: centre(spot.current) });
      else setFlight(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);

  const big = size * 2.4;
  return (
    <>
      <span ref={spot} className="inline-flex shrink-0" style={{ opacity: flight ? 0 : 1, transition: "opacity 0.15s" }}>
        <Orb size={size} />
      </span>
      {flight?.to &&
        createPortal(
          <motion.span
            className="pointer-events-none fixed left-0 top-0 z-[100]"
            style={{ width: big, height: big, marginLeft: -big / 2, marginTop: -big / 2 }}
            initial={{ x: flight.from.x, y: flight.from.y, scale: 0.4, opacity: 0 }}
            animate={{
              // up out of the button, then over to the line, settling to the line's size
              x: [flight.from.x, flight.from.x + (flight.to.x - flight.from.x) * 0.35, flight.to.x],
              y: [flight.from.y, Math.min(flight.from.y, flight.to.y) - 60, flight.to.y],
              scale: [0.4, 1, size / big],
              opacity: [0, 1, 1],
            }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], times: [0, 0.45, 1] }}
            onAnimationComplete={() => setFlight(null)}
            aria-hidden
          >
            <Orb size={big} />
          </motion.span>,
          document.body,
        )}
    </>
  );
}
