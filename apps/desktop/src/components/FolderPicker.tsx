import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { canPickNatively, folderName, pickFolder, recentFolders, rememberFolder } from "../lib/folders";
import { easeOutExpo, listContainer, listItem } from "../lib/motion";
import { FolderIcon, XIcon } from "./Icons";
import { Button } from "./ui";

function useNativePicker() {
  const [native, setNative] = useState(false);
  useEffect(() => {
    canPickNatively().then(setNative);
  }, []);
  return native;
}

export function FolderPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const native = useNativePicker();
  const recents = recentFolders().filter((p) => p !== value);

  async function browse() {
    const picked = await pickFolder(value || undefined);
    if (picked) onChange(picked);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
        مجلد العمل
      </span>

      <motion.div
        layout
        transition={{ duration: 0.25, ease: easeOutExpo }}
        className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
        style={{ borderColor: value ? "var(--color-accent)" : "var(--color-border)", background: "var(--color-bg)" }}
      >
        <motion.span
          key={value || "none"}
          initial={{ scale: 0.7, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: easeOutExpo }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={{
            background: value ? "color-mix(in oklch, var(--color-accent) 16%, transparent)" : "var(--color-surface-2)",
            color: value ? "var(--color-accent)" : "var(--color-ink-muted)",
          }}
        >
          <FolderIcon className="h-5 w-5" />
        </motion.span>

        <div className="min-w-0 flex-1">
          {native ? (
            <>
              <p className="truncate text-sm font-medium">{value ? folderName(value) : "مجلد المستخدم (الافتراضي)"}</p>
              <p className="truncate font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                {value || "~"}
              </p>
            </>
          ) : (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="C:\Users\...\Projects\my-app"
              className="w-full bg-transparent font-mono text-sm outline-none"
              style={{ color: "var(--color-ink)" }}
              dir="ltr"
            />
          )}
        </div>

        {native && (
          <Button type="button" variant="ghost" className="shrink-0 border" style={{ borderColor: "var(--color-border)" }} onClick={browse}>
            {value ? "تغيير" : "اختيار مجلد"}
          </Button>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 text-xs underline-offset-2 hover:underline"
            style={{ color: "var(--color-ink-muted)" }}
          >
            مسح
          </button>
        )}
      </motion.div>

      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
        رفيق ما بيقدر يقرأ أو يكتب ملفات برّا هالمجلد، والأوامر بتنفّذ جوّاه.
      </p>

      {recents.length > 0 && (
        <motion.div variants={listContainer} initial="hidden" animate="show" className="flex flex-wrap gap-1.5">
          {recents.map((p) => (
            <motion.button
              type="button"
              key={p}
              variants={listItem}
              whileTap={{ scale: 0.95 }}
              onClick={() => onChange(p)}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
              title={p}
            >
              <FolderIcon className="h-3 w-3" />
              {folderName(p)}
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/** Compact folder control for a chat header: shows the current folder, opens a small menu. */
export function FolderChip({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (path: string | null) => Promise<void> | void;
}) {
  const native = useNativePicker();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const recents = recentFolders().filter((p) => p !== value);

  useEffect(() => {
    if (!open) return;
    setDraft(value ?? "");
    setError(null);
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, value]);

  async function apply(path: string | null) {
    setBusy(true);
    setError(null);
    try {
      await onChange(path);
      if (path) rememberFolder(path);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ما قدرت أحدد المجلد");
    } finally {
      setBusy(false);
    }
  }

  async function browse() {
    const picked = await pickFolder(value ?? undefined);
    if (picked) await apply(picked);
  }

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{
          borderColor: value ? "color-mix(in oklch, var(--color-accent) 55%, transparent)" : "var(--color-border)",
          background: value ? "color-mix(in oklch, var(--color-accent) 10%, transparent)" : "transparent",
          color: value ? "var(--color-ink)" : "var(--color-ink-muted)",
        }}
        title={value ?? "حدد مجلد عشان رفيق يقدر يعدّل ملفاته من المحادثة"}
        aria-expanded={open}
      >
        <FolderIcon className="h-3.5 w-3.5" style={{ color: value ? "var(--color-accent)" : undefined }} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value ?? "none"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="max-w-44 truncate"
          >
            {value ? folderName(value) : "بدون مجلد"}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
            className="absolute end-0 top-full mt-2 w-80 origin-top rounded-xl border p-3 shadow-lg"
            style={{ zIndex: "var(--z-index-dropdown)" as unknown as number, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              لما تحدد مجلد، رفيق بيقدر يقرأ ويعدّل ملفاته ويشغّل أوامر جوّاه من هالمحادثة — والكتابة والأوامر بتاخد إذنك.
            </p>

            {value && (
              <p className="mt-2 truncate rounded-md px-2 py-1.5 font-mono text-xs" style={{ background: "var(--color-bg)" }} dir="ltr" title={value}>
                {value}
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {native ? (
                <Button onClick={browse} disabled={busy}>
                  <FolderIcon className="h-4 w-4" />
                  {value ? "تغيير المجلد" : "اختيار مجلد"}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="C:\Users\...\my-project"
                    className="input min-w-0 flex-1 font-mono text-xs"
                    dir="ltr"
                    onKeyDown={(e) => e.key === "Enter" && draft.trim() && apply(draft.trim())}
                  />
                  <Button onClick={() => apply(draft.trim())} disabled={busy || !draft.trim()} className="px-3">
                    حفظ
                  </Button>
                </div>
              )}

              {recents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recents.map((p) => (
                    <button
                      key={p}
                      onClick={() => apply(p)}
                      className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
                      title={p}
                    >
                      <FolderIcon className="h-3 w-3" />
                      {folderName(p)}
                    </button>
                  ))}
                </div>
              )}

              {value && (
                <button
                  onClick={() => apply(null)}
                  className="flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ color: "var(--color-danger)" }}
                >
                  <XIcon className="h-3.5 w-3.5" />
                  إزالة المجلد
                </button>
              )}

              {error && (
                <p className="text-xs" style={{ color: "var(--color-danger)" }}>
                  {error}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
