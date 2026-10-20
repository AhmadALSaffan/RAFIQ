/**
 * Ready-made documents: a research paper, a CV, a work report, an invoice, a slide deck.
 * Pick one, fill in what you know, and the chat starts with the model asking only for
 * what's missing, then writing the file.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { docTemplates, templatePrompt, type DocTemplate } from "../lib/docTemplates";
import { Button } from "./ui";
import { FileGlyph } from "./agent/FileTree";
import { XIcon } from "./Icons";
import { easeOutExpo } from "../lib/motion";
import { t } from "../i18n";

export function TemplatesDialog({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (prompt: string) => void }) {
  const [picked, setPicked] = useState<DocTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setValues({});
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center p-6"
          style={{ background: "color-mix(in oklch, var(--color-bg) 70%, transparent)", backdropFilter: "blur(6px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          role="dialog"
          aria-modal="true"
          aria-label={t("قوالب جاهزة")}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: easeOutExpo }}
            className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl shadow-2xl"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-5">
              <div>
                <h2 className="text-xl font-extrabold">{picked ? picked.title : t("قوالب جاهزة")}</h2>
                <p className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
                  {picked ? t("عبّي اللي بتعرفه — كل شي اختياري، ورفيق بيسألك عن الناقص.") : t("اختار شو بدك تعمل، ورفيق بيكتبه ملف جاهز.")}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label={t("إغلاق")} className="rounded-full p-2 transition-colors hover:bg-[var(--color-surface-2)]">
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {!picked ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {docTemplates().map((tpl) => (
                    <motion.button
                      key={tpl.id}
                      type="button"
                      whileHover={{ y: -2 }}
                      onClick={() => setPicked(tpl)}
                      className="flex items-start gap-3 rounded-2xl p-4 text-start"
                      style={{ background: "var(--color-surface-2)" }}
                    >
                      <span className="mt-0.5 scale-[1.6]">
                        <FileGlyph name={tpl.file} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-bold" style={{ fontFamily: "var(--font-display)" }}>
                          {tpl.title}
                        </span>
                        <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                          {tpl.blurb}
                        </span>
                        <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--color-surface)", color: "var(--color-ink-muted)" }} dir="ltr">
                          {tpl.format}
                        </span>
                      </span>
                    </motion.button>
                  ))}
                </div>
              ) : (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onStart(templatePrompt(picked, values));
                  }}
                >
                  {picked.fields.map((f) => (
                    <label key={f.key} className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">{f.label}</span>
                      {f.long ? (
                        <textarea
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          rows={3}
                          className="input w-full resize-y"
                          dir={values[f.key] ? "auto" : undefined}
                        />
                      ) : (
                        <input
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          className="input w-full"
                          dir={values[f.key] ? "auto" : undefined}
                        />
                      )}
                    </label>
                  ))}
                  <div className="mt-2 flex items-center gap-2">
                    <Button type="submit" variant="accent">
                      {t("ابدأ")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
                      {t("قالب تاني")}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
