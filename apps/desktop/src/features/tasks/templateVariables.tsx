/**
 * The blanks of a task that came from a template: `{{folder}}`, `{{branch}}`, anything the
 * template asks for. Each one is filled before the task can start; well-known ones start
 * out filled (the task's folder, its git branch, today's date) and follow those until the
 * user types over them.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { gitInfo } from "../../lib/api";
import { defaultFor, localDate } from "../../lib/variables";
import { easeOutExpo } from "../../lib/motion";
import { fieldDir } from "../../lib/bidi";
import { t } from "../../i18n";

export function TemplateVariables({
  names,
  folder,
  values,
  onChange,
}: {
  names: string[];
  folder: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  // The blanks the user typed into keep what they typed; the rest follow the defaults.
  const [typed, setTyped] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!folder.trim()) return setBranch(null);
    let alive = true;
    gitInfo(folder.trim())
      .then((info) => alive && setBranch(info.branch))
      .catch(() => alive && setBranch(null));
    return () => {
      alive = false;
    };
  }, [folder]);

  useEffect(() => {
    const ctx = { folder: folder.trim(), branch, today: localDate() };
    const next = { ...values };
    let changed = false;
    for (const name of names) {
      if (typed.has(name)) continue;
      const value = defaultFor(name, ctx);
      if ((next[name] ?? "") !== value) {
        next[name] = value;
        changed = true;
      }
    }
    if (changed) onChange(next);
    // `values` is what this effect writes; reading it here must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("\n"), folder, branch, typed]);

  return (
    <AnimatePresence initial={false}>
      {names.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: easeOutExpo }}
          className="overflow-hidden"
        >
          <div
            className="flex flex-col gap-3 rounded-lg border p-4"
            style={{ borderColor: "color-mix(in oklch, var(--color-accent) 35%, var(--color-border))", background: "color-mix(in oklch, var(--color-accent) 5%, var(--color-bg))" }}
          >
            <div>
              <p className="text-sm font-medium">{t("عبّي الأجزاء اللي بتتغير")}</p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("القالب فيه فراغات — بينحطوا مكانها بالمهمة قبل ما تبلّش.")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {names.map((name) => {
                const value = values[name] ?? "";
                return (
                  <label key={name} className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5 font-mono text-xs" style={{ color: "var(--color-accent)" }} dir="auto">
                      {`{{${name}}}`}
                      {!value.trim() && (
                        <span className="font-sans text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                          {t("مطلوب")}
                        </span>
                      )}
                    </span>
                    <input
                      value={value}
                      onChange={(e) => {
                        setTyped((prev) => new Set(prev).add(name));
                        onChange({ ...values, [name]: e.target.value });
                      }}
                      className="input text-sm"
                      dir={fieldDir(value)}
                      aria-label={name}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
