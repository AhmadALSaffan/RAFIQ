import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { onRequestCount } from "../lib/api";

/**
 * The thin line across the top of the window while anything is loading. It creeps toward
 * 90% instead of pretending to know the real progress, then snaps to 100% and fades —
 * the honest version of a progress bar for requests with no length.
 */
export function TopProgress() {
  const [active, setActive] = useState(0);
  const [value, setValue] = useState(0);

  useEffect(() => onRequestCount(setActive), []);

  useEffect(() => {
    if (!active) {
      if (value > 0) {
        setValue(100);
        const done = setTimeout(() => setValue(0), 280);
        return () => clearTimeout(done);
      }
      return;
    }
    if (value === 0) setValue(12);
    const tick = setInterval(() => {
      // Slows down as it approaches the end, so it never looks stuck at one spot.
      setValue((v) => (v >= 90 ? v : v + Math.max(0.6, (90 - v) / 12)));
    }, 120);
    return () => clearInterval(tick);
  }, [active, value]);

  return (
    <AnimatePresence>
      {value > 0 && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 top-0"
          style={{ zIndex: "var(--z-index-toast)" as unknown as number, height: 2 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="h-full"
            style={{
              background: "linear-gradient(90deg, transparent, var(--color-accent))",
              boxShadow: "0 0 8px color-mix(in oklch, var(--color-accent) 60%, transparent)",
            }}
            animate={{ width: `${value}%` }}
            transition={{ duration: value === 100 ? 0.18 : 0.3, ease: "easeOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
