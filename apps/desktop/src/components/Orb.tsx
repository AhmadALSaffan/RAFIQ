import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, PresenceContext } from "motion/react";
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

type Point = { x: number; y: number };
type Flight = { from: Point; to: Point | null; path: Point[]; scale: number[]; opacity: number[] };

const STEPS = 24;
/** How much bigger the orb is in flight than on its line. */
const GROW = 2.4;

/** The way from the button to the line: straight up out of the button, across the chat a
 *  little below the line, then up into its place (one cubic curve whose handles sit on that
 *  middle height), sampled into keyframes. */
function plan(from: Point, to: Point, landing: number): Flight {
  const mid = to.y + (from.y - to.y) * 0.3;
  const c1 = { x: from.x, y: mid };
  const c2 = { x: to.x, y: mid };
  const path: Point[] = [];
  const scale: number[] = [];
  const opacity: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    // eased along the way (the keyframes themselves play linearly, so it never stalls)
    const k = i / STEPS;
    const t = k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    path.push({ x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y });
    // grows as it leaves the button, shrinks to the line's size on the last stretch
    scale.push(t < 0.3 ? 0.4 + (t / 0.3) * 0.6 : t < 0.75 ? 1 : 1 - ((t - 0.75) / 0.25) * (1 - landing));
    opacity.push(Math.min(1, t / 0.12));
  }
  return { from, to, path, scale, opacity };
}

/** The orb on the "working…" line. Right after a send it flies there from the button
 *  (see `plan`) and lands in its place; otherwise it's simply there. */
export function WorkOrb({ size = 16 }: { size?: number }) {
  const big = size * GROW;
  const spot = useRef<HTMLSpanElement>(null);
  const [flight, setFlight] = useState<Flight | null>(null);

  useLayoutEffect(() => {
    const from = launch;
    if (!from || Date.now() - from.at > 4000 || reduced() || !spot.current) return;
    // hidden until it lands; measured once the chat has scrolled to the new line. The launch
    // is spent only when the flight starts, so an effect run twice (StrictMode) still flies.
    setFlight({ from, to: null, path: [], scale: [], opacity: [] });
    const timer = window.setTimeout(() => {
      launch = null;
      setFlight(spot.current ? plan(from, centre(spot.current), 1 / GROW) : null);
    }, 60);
    return () => {
      window.clearTimeout(timer);
      setFlight(null);
    };
  }, []);

  return (
    <>
      <span ref={spot} className="inline-flex shrink-0" style={{ opacity: flight ? 0 : 1, transition: "opacity 0.15s" }}>
        <Orb size={size} />
      </span>
      {flight?.to &&
        createPortal(
          // Out of any AnimatePresence around the orb (the status icon's): one with
          // initial={false} lands it at once, never fires the completion, and leaves it
          // hanging over the reply.
          <PresenceContext.Provider value={null}>
            <motion.span
              className="pointer-events-none fixed left-0 top-0 z-[100]"
              style={{ width: big, height: big, marginLeft: -big / 2, marginTop: -big / 2 }}
              initial={{ x: flight.path[0].x, y: flight.path[0].y, scale: 0.4, opacity: 0 }}
              animate={{ x: flight.path.map((p) => p.x), y: flight.path.map((p) => p.y), scale: flight.scale, opacity: flight.opacity }}
              transition={{ duration: 0.85, ease: "linear" }}
              onAnimationComplete={() => setFlight(null)}
              aria-hidden
            >
              <Orb size={big} />
            </motion.span>
          </PresenceContext.Provider>,
          document.body,
        )}
    </>
  );
}
