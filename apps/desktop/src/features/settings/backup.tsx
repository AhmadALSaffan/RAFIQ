/**
 * Settings → General → Backup: everything that is yours in one file, and the way back.
 *
 * Restoring replaces every chat, task and setting, so it never happens on one click: the
 * backup is read first and what it holds is shown — when it was made, how many chats,
 * models, skills — and only then does "replace" do anything. The agent keeps a copy of the
 * data it replaced, and the result says where.
 */

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { downloadBackup, inspectBackup, restoreBackupFile, restoreBackupUpload, saveBackup } from "../../lib/api";
import { canPickNatively, revealPath } from "../../lib/folders";
import { easeOutExpo } from "../../lib/motion";
import type { BackupManifest, RestoreResult } from "../../lib/types";
import { Button } from "../../components/ui";
import { DownloadIcon, UploadIcon } from "../../components/Icons";
import { locale, t } from "../../i18n";

const zipFilter = () => [{ name: t("نسخة احتياطية"), extensions: ["zip"] }];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }} role="alert">
      {text}
    </p>
  );
}

/** A restore waiting for the user's yes: the manifest (when we could read it first) and how to go ahead. */
type Pending = { manifest: BackupManifest | null; name: string; run: () => Promise<RestoreResult> };

function Counts({ manifest }: { manifest: BackupManifest }) {
  const c = manifest.counts;
  const items: [number, string][] = [
    [c.chats, t("محادثات")],
    [c.messages, t("رسائل")],
    [c.tasks, t("مهام")],
    [c.models, t("نماذج")],
    [c.skills, t("مهارات")],
    [c.attachments, t("مرفقات")],
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map(([n, label]) => (
        <span
          key={label}
          className="rounded-md px-2 py-0.5 text-xs tabular-nums"
          style={{ background: "var(--color-surface-2)", color: "var(--color-ink)" }}
        >
          {n} <span style={{ color: "var(--color-ink-muted)" }}>{label}</span>
        </span>
      ))}
    </div>
  );
}

export function BackupSection() {
  const [busy, setBusy] = useState<"save" | "read" | "restore" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Shown under the card it came from, so a failed save isn't read as a failed restore.
  const [error, setError] = useState<{ where: "save" | "restore"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function save() {
    setError(null);
    setSaved(null);
    const name = `rafiq-backup-${today()}.zip`;
    try {
      if (await canPickNatively()) {
        const { save: pick } = await import("@tauri-apps/plugin-dialog");
        const path = await pick({ defaultPath: name, filters: zipFilter() });
        if (!path) return;
        setBusy("save");
        setSaved((await saveBackup(path)).path);
      } else {
        setBusy("save");
        const url = URL.createObjectURL(await downloadBackup());
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
        setSaved(name);
      }
    } catch (e) {
      setError({ where: "save", text: message(e) });
    } finally {
      setBusy(null);
    }
  }

  async function pickRestore() {
    setError(null);
    setRestored(null);
    if (!(await canPickNatively())) {
      fileInput.current?.click();
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, directory: false, filters: zipFilter() });
    if (typeof path !== "string") return;
    setBusy("read");
    try {
      // Read before asking: the user decides with what's in the file in front of them.
      const manifest = await inspectBackup(path);
      setPending({ manifest, name: path, run: () => restoreBackupFile(path) });
    } catch (e) {
      setError({ where: "restore", text: message(e) });
    } finally {
      setBusy(null);
    }
  }

  function uploaded(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setPending({ manifest: null, name: file.name, run: () => restoreBackupUpload(file) });
  }

  async function confirm() {
    if (!pending) return;
    setBusy("restore");
    setError(null);
    try {
      setRestored(await pending.run());
      setPending(null);
    } catch (e) {
      setError({ where: "restore", text: message(e) });
    } finally {
      setBusy(null);
    }
  }

  const card = { borderColor: "var(--color-border)", background: "var(--color-surface)" };
  const muted = { color: "var(--color-ink-muted)" };

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium">{t("نسخة احتياطية")}</h2>
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border px-4 py-3" style={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("احفظ كل شي بملف واحد")}</p>
              <p className="mt-0.5 text-xs leading-relaxed" style={muted}>
                {t("المحادثات والمهام والإعدادات والنماذج والذاكرة والمهارات اللي نزّلتها والمرفقات. المفاتيح وكلمات السر ما بتنحط فيه أبداً.")}
              </p>
            </div>
            <Button onClick={save} disabled={busy !== null}>
              <DownloadIcon className="h-4 w-4" />
              {busy === "save" ? t("عم يحفظ…") : t("احفظ نسخة")}
            </Button>
          </div>
          {error?.where === "save" && <ErrorLine text={error.text} />}
          {saved && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-xs" style={muted} title={saved}>
                {t("انحفظت:")}{" "}
                <span className="font-mono" dir="ltr">
                  {saved}
                </span>
              </p>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void revealPath(saved)}>
                {t("افتح المجلد")}
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-lg border px-4 py-3" style={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("استرجع من نسخة")}</p>
              <p className="mt-0.5 text-xs leading-relaxed" style={muted}>
                {t("بيستبدل كل بياناتك الحالية بالي بالنسخة — وقبلها رفيق بيحفظ نسخة من الحالية، فما في شي بيضيع.")}
              </p>
            </div>
            <Button variant="ghost" onClick={() => void pickRestore()} disabled={busy !== null}>
              <UploadIcon className="h-4 w-4" />
              {busy === "read" ? t("عم يقرأ…") : t("اختار ملف")}
            </Button>
            <input ref={fileInput} type="file" accept=".zip" hidden onChange={(e) => uploaded(e.target.files?.[0])} />
          </div>

          <AnimatePresence initial={false}>
            {pending && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: easeOutExpo }}
                className="overflow-hidden"
              >
                <div
                  className="mt-3 rounded-lg border px-3 py-3"
                  style={{ borderColor: "var(--color-danger)", background: "color-mix(in oklch, var(--color-danger) 6%, transparent)" }}
                >
                  <p className="text-sm font-medium">{t("استبدل بياناتك بهالنسخة؟")}</p>
                  <p className="mt-0.5 truncate text-xs" style={muted} title={pending.name} dir="ltr">
                    {pending.name}
                  </p>
                  {pending.manifest ? (
                    <>
                      <p className="mt-2 text-xs" style={muted}>
                        {t("انعملت {0} · رفيق {1}", { 0: when(pending.manifest.created_at), 1: pending.manifest.version })}
                      </p>
                      <Counts manifest={pending.manifest} />
                    </>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="danger" onClick={() => void confirm()} disabled={busy !== null}>
                      {busy === "restore" ? t("عم يسترجع…") : t("استبدل بياناتي")}
                    </Button>
                    <Button variant="ghost" onClick={() => setPending(null)} disabled={busy === "restore"}>
                      {t("إلغاء")}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {restored && (
              <motion.div
                key="done"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: easeOutExpo }}
                className="overflow-hidden"
              >
                <div
                  className="mt-3 rounded-lg border px-3 py-3"
                  style={{ borderColor: "var(--color-accent)", background: "color-mix(in oklch, var(--color-accent) 8%, transparent)" }}
                >
                  <p className="text-sm font-medium">{t("رجعت بياناتك.")}</p>
                  <Counts manifest={restored.manifest} />
                  {restored.missing_secrets > 0 && (
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-ink)" }}>
                      {t("{0} من النماذج والحسابات بدها مفتاحها من جديد — النسخة ما بتحمل مفاتيح. افتحها من صفحة النماذج أو الحسابات.", {
                        0: String(restored.missing_secrets),
                      })}
                    </p>
                  )}
                  <p className="mt-2 truncate text-[11px]" style={muted} title={restored.safety_copy}>
                    {t("البيانات اللي كانت قبل انحفظت هون:")}{" "}
                    <span className="font-mono" dir="ltr">
                      {restored.safety_copy}
                    </span>
                  </p>
                  <div className="mt-3">
                    <Button onClick={() => window.location.reload()}>{t("أعد تحميل التطبيق")}</Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error?.where === "restore" && <ErrorLine text={error.text} />}
        </div>
      </div>
    </section>
  );
}
