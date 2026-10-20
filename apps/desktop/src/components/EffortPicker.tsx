/**
 * How hard the model thinks before it answers — a dropdown that lives inside the model
 * menus (Home and the chat composer). "Auto" leaves it to the model; the others ask a
 * thinking model for less or more reasoning (models that don't think ignore it).
 */

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDownIcon } from "./Icons";
import { t } from "../i18n";
import type { ReplySettings } from "../lib/types";

export type Effort = ReplySettings["reasoning_effort"];

export function effortOptions(): { id: Effort; label: string; hint: string }[] {
  return [
    { id: null, label: t("تلقائي"), hint: t("الموديل بيقرّر") },
    { id: "low", label: t("خفيف"), hint: t("أسرع وأرخص") },
    { id: "medium", label: t("متوسط"), hint: t("توازن") },
    { id: "high", label: t("عالي"), hint: t("بيفكّر أكتر قبل ما يرد") },
  ];
}

export function effortLabel(effort: Effort): string {
  return effortOptions().find((o) => o.id === effort)?.label ?? t("تلقائي");
}

/** A row that opens its own small list of levels. `tone` follows the menu it sits in. */
export function EffortPicker({ value, onChange }: { value: Effort; onChange: (effort: Effort) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[color-mix(in_oklch,currentColor_8%,transparent)]"
      >
        <span className="min-w-0">
          <span className="block text-sm">{t("مستوى التفكير")}</span>
          <span className="block text-xs opacity-60">{effortLabel(value)}</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex opacity-70">
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            role="listbox"
            aria-label={t("مستوى التفكير")}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-1.5 mb-1 overflow-hidden rounded-xl border"
            style={{ borderColor: "color-mix(in oklch, currentColor 14%, transparent)" }}
          >
            {effortOptions().map((o, i) => {
              const on = o.id === value;
              return (
                <motion.li key={o.id ?? "auto"} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.15 }}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-[color-mix(in_oklch,currentColor_8%,transparent)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{o.label}</span>
                      <span className="block text-[11px] opacity-60">{o.hint}</span>
                    </span>
                    {on && (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12.5 10 17 19 7.5" />
                      </svg>
                    )}
                  </button>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
