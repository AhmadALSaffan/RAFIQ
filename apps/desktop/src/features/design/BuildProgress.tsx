/**
 * The page assembling while the model writes it: a skeleton that gains a block for each
 * part (header, sections, footer) as it arrives, the one being written shimmering and the
 * finished ones settling with a check. Over an empty preview it fills the space; over a
 * page already there it floats in a corner so the old version stays in sight.
 */

import { AnimatePresence, motion } from "motion/react";
import { t } from "../../i18n";
import { DrawnCheck } from "../../components/ui";
import { WorkOrb } from "../../components/Orb";
import type { BuildOutline } from "./buildOutline";

const TAGS: Record<string, string> = {
  header: t("الرأس"),
  nav: t("القائمة"),
  section: t("قسم"),
  footer: t("التذييل"),
  article: t("مقال"),
  aside: t("شريط جانبي"),
};

const rise = { type: "spring", visualDuration: 0.4, bounce: 0.18 } as const;

export function BuildProgress({ outline, floating }: { outline: BuildOutline; floating: boolean }) {
  const parts = outline.current?.parts ?? [];
  const name = outline.current?.name;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.2 } }}
      transition={rise}
      className={
        floating
          ? "pointer-events-none absolute bottom-4 end-4 z-20 flex max-h-[60%] w-72 flex-col gap-2 overflow-hidden rounded-2xl p-3 shadow-xl"
          : "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-8"
      }
      style={floating ? { background: "var(--color-surface)", border: "1px solid var(--color-border)" } : { background: "var(--color-surface-2)" }}
      role="status"
      aria-live="polite"
    >
      <div className={`flex items-center gap-2 text-xs font-semibold ${floating ? "" : "text-sm"}`} style={{ color: "var(--color-ink)" }}>
        <WorkOrb size={16} />
        {name ? t("عم يبني «{0}»", { 0: name }) : outline.current ? t("عم يبني الصفحة") : t("عم يجهّز الشاشة الجاية")}
      </div>

      {outline.finished.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          <AnimatePresence initial={false}>
            {outline.finished.map((doc, i) => (
              <motion.span
                key={`${i}:${doc}`}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={rise}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: "color-mix(in oklch, var(--color-success) 14%, transparent)", color: "var(--color-success)" }}
              >
                <DrawnCheck className="h-3 w-3" />
                <span dir="auto">{doc ?? t("مستند {0}", { 0: i + 1 })}</span>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* The page's outline, block by block — a miniature of what's arriving. */}
      <ol className={`flex min-h-0 flex-col gap-1.5 overflow-hidden ${floating ? "" : "w-full max-w-md"}`}>
        <AnimatePresence initial={false}>
          {parts.map((part, i) => {
            const writing = !part.done && i === parts.length - 1;
            const tall = i > 0 && i < parts.length - 1 ? (floating ? 26 : 44) : floating ? 18 : 28;
            return (
              <motion.li
                key={i}
                layout="position"
                initial={{ opacity: 0, y: 10, scaleY: 0.6 }}
                animate={{ opacity: 1, y: 0, scaleY: 1 }}
                transition={rise}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 ${writing ? "shimmer" : ""}`}
                style={{
                  height: tall,
                  background: part.done ? "var(--color-surface)" : "color-mix(in oklch, var(--color-ink) 6%, transparent)",
                  border: floating ? "1px solid var(--color-border)" : undefined,
                  transformOrigin: "top",
                }}
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" style={{ color: part.done ? "var(--color-success)" : "var(--color-ink-muted)" }}>
                  {part.done ? <DrawnCheck className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />}
                </span>
                <span className="min-w-0 truncate text-[11px]" style={{ color: part.done ? "var(--color-ink)" : "var(--color-ink-muted)" }} dir="auto">
                  {TAGS[part.label] ?? part.label}
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {!parts.length && outline.current && (
          <li className="shimmer h-7 rounded-lg" style={{ background: "color-mix(in oklch, var(--color-ink) 6%, transparent)" }} />
        )}
      </ol>
    </motion.div>
  );
}
