/**
 * How full the model's window is, as a ring beside the model picker: it fills as the chat
 * grows, turns amber past 70% and red past 90% — pulsing once when it crosses — and a click
 * folds the old turns into a summary to make room.
 */

import { useEffect, useRef } from "react";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { t } from "../../i18n";
import { easeOutExpo } from "../../lib/motion";

const SIZE = 18;
const R = (SIZE - 3) / 2;
const C = 2 * Math.PI * R;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export function ContextRing({ used, window, onSummarize, busy = false }: { used: number; window: number; onSummarize?: () => void; busy?: boolean }) {
  const share = Math.min(1, used / window);
  const level = share >= 0.9 ? 2 : share >= 0.7 ? 1 : 0;
  const color = level === 2 ? "var(--color-danger)" : level === 1 ? "var(--color-pending)" : "var(--color-ink-muted)";
  const [scope, run] = useAnimate();
  const reduce = useReducedMotion();
  const last = useRef(level);
  useEffect(() => {
    if (level > last.current && !reduce && scope.current) void run(scope.current, { scale: [1, 1.5, 1] }, { duration: 0.55, ease: easeOutExpo });
    last.current = level;
  }, [level, reduce, run, scope]);

  const percent = Math.round(share * 100);
  const title =
    t("الكونتكست: {0} من {1} توكن ({2}%)", { 0: tokens(used), 1: tokens(window), 2: percent }) +
    (onSummarize ? "\n" + t("اضغط لتلخّص الرسائل القديمة وتفضّي مكان") : "");
  return (
    <button
      type="button"
      ref={scope}
      onClick={onSummarize}
      disabled={!onSummarize || busy}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors enabled:hover:bg-[var(--color-surface-2)]"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden style={{ transform: "rotate(-90deg)" }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-border)" strokeWidth={2.5} />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={C}
          initial={false}
          animate={{ strokeDashoffset: C * (1 - Math.max(0.03, share)), stroke: color }}
          transition={{ duration: 0.7, ease: easeOutExpo }}
        />
      </svg>
    </button>
  );
}
