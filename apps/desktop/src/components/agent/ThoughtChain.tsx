/**
 * The model's reasoning as a chain of steps: each paragraph of thought is a step with a
 * dot on a line — done, or the one it's on now — titled by its first words and folding
 * open to the whole thought. While the model thinks the chain follows the newest step in
 * a window of fixed height, so the conversation doesn't slide down with every thought;
 * once the answer starts it folds into one line. (After the "Thought Chain" component on
 * 21st.dev, written for Rafiq.)
 */

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";

/** True where the thinking should stay folded until asked for (design and motion sessions). */
export const FoldThoughts = createContext(false);

const MAX_STEPS = 40;

/** Paragraphs of thought; a very long single paragraph is cut at sentence ends. */
export function thoughtSteps(text: string): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= 600) {
      out.push(p);
      continue;
    }
    let chunk = "";
    for (const sentence of p.split(/(?<=[.!?؟。])\s+/)) {
      if (chunk && chunk.length + sentence.length > 420) {
        out.push(chunk.trim());
        chunk = "";
      }
      chunk += `${sentence} `;
    }
    if (chunk.trim()) out.push(chunk.trim());
  }
  // Short paragraphs ("Palette:", "Fonts:") join the ones around them, so a long think reads
  // as a handful of steps, not a thousand.
  const merged: string[] = [];
  for (const step of out) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last.length < 280 || step.length < 80) && last.length + step.length < 700) merged[merged.length - 1] = `${last}\n${step}`;
    else merged.push(step);
  }
  // A very long think (a whole motion scene worked out) still reads as at most 40 steps.
  if (merged.length <= MAX_STEPS) return merged;
  const per = Math.ceil(merged.length / MAX_STEPS);
  return Array.from({ length: Math.ceil(merged.length / per) }, (_, i) => merged.slice(i * per, (i + 1) * per).join("\n"));
}

function titleOf(step: string): string {
  const first = step.replace(/^[#*\-\s]+/, "").split(/(?<=[.!?؟:])\s|\n/)[0];
  return first.length > 90 ? `${first.slice(0, 88)}…` : first;
}

function Step({ text, index, last, live }: { text: string; index: number; last: boolean; live: boolean }) {
  const [open, setOpen] = useState(false);
  const active = live && last;
  const title = titleOf(text);
  const more = text.length > title.length + 2;
  return (
    <motion.li initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: easeOutExpo }} className="relative ps-6">
      {/* the line down to the next step */}
      {!last && <span aria-hidden className="absolute bottom-[-6px] top-5 w-px start-[7px]" style={{ background: "var(--color-border)" }} />}
      <span aria-hidden className="absolute top-1 grid h-[15px] w-[15px] place-items-center rounded-full start-0" style={{ background: active ? "color-mix(in oklch, var(--color-accent) 22%, transparent)" : "var(--color-surface-2)" }}>
        {active ? (
          <motion.span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--color-accent)" }} animate={{ scale: [1, 1.5, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 1.1, repeat: Infinity }} />
        ) : (
          <svg viewBox="0 0 12 12" className="h-[9px] w-[9px]" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.2 5 8.5 9.5 3.5" />
          </svg>
        )}
      </span>
      <button type="button" disabled={!more || active} onClick={() => setOpen((o) => !o)} className="w-full text-start disabled:cursor-default" aria-expanded={more ? open || active : undefined}>
        <span className="block text-xs leading-relaxed" style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }} dir="auto">
          <span className="num me-1.5 opacity-50">{index + 1}</span>
          {title}
          {more && !active && <span className="ms-1 opacity-50">{open ? "▴" : "▾"}</span>}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {(open || active) && more && (
          <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="mt-1 overflow-hidden whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir="auto">
            {text.slice(title.length).trim() || text}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function ThoughtChain({ text, live }: { text: string; live: boolean }) {
  const steps = useMemo(() => thoughtSteps(text), [text]);
  const folded = useContext(FoldThoughts);
  const [open, setOpen] = useState(false);
  // Folded sessions show only the line, with an arrow to open it — even while it thinks.
  const expanded = folded ? open : live || open;
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && live && follow.current) el.scrollTop = el.scrollHeight;
  }, [text, live]);
  if (!steps.length) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={live && !folded}
        className="flex items-center gap-1.5 rounded-md text-xs disabled:cursor-default"
        style={{ color: "var(--color-ink-muted)" }}
        aria-expanded={expanded}
        aria-label={expanded ? t("خبّي التفكير") : t("اعرض التفكير")}
      >
        {live ? (
          <span className="shimmer-text">{t("عم يفكّر… الخطوة {0}", { 0: steps.length })}</span>
        ) : (
          <span>{t("فكّر بـ {0} خطوات", { 0: steps.length })}</span>
        )}
        {(!live || folded) && (
          <motion.svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </motion.svg>
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: easeOutExpo }} className="overflow-hidden">
            <div
              ref={box}
              onScroll={(e) => {
                const el = e.currentTarget;
                follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
              }}
              className={`mt-1.5 overflow-y-auto rounded-xl px-3.5 py-3 ${live ? "h-40" : "max-h-72"}`}
              style={{ background: "var(--color-surface)", maskImage: live ? "linear-gradient(to bottom, transparent, black 1.5rem)" : undefined }}
            >
              <ol className="flex flex-col gap-3">
                {steps.map((s, i) => (
                  <Step key={i} text={s} index={i} last={i === steps.length - 1} live={live} />
                ))}
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
