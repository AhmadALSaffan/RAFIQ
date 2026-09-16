/**
 * What a task changed in its folder, when the folder is a git repository: which files, the
 * diff, and whether the changes are in the user's folder — with a way to apply or take
 * them back. Worktree tasks bring their changes home when they finish; ones that didn't
 * finish, or no longer applied cleanly, wait here for the user.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { applyTaskChanges, getTaskChanges, revertTaskChanges } from "../../lib/api";
import type { ChangesState, TaskChanges, TaskStatus } from "../../lib/types";
import { easeOutExpo } from "../../lib/motion";
import { Button } from "../../components/ui";
import { AlertIcon } from "../../components/Icons";
import { t } from "../../i18n";

const STATE: Record<ChangesState, { label: string; color: string }> = {
  running: { label: t("المهمة لسا شغّالة"), color: "var(--color-accent)" },
  applied: { label: t("مطبّقة على مجلدك"), color: "var(--color-success)" },
  pending: { label: t("جاهزة — ما انطبقت لأن المهمة ما كمّلت"), color: "var(--color-pending)" },
  conflict: { label: t("ما انطبقت — نفس الأماكن تغيّرت بمجلدك"), color: "var(--color-danger)" },
  reverted: { label: t("انرجعت"), color: "var(--color-ink-muted)" },
  empty: { label: t("المهمة ما غيّرت شي"), color: "var(--color-ink-muted)" },
  error: { label: t("صار خطأ بـ git"), color: "var(--color-danger)" },
};

const FILE_STATUS: Record<string, string> = { added: "A", deleted: "D", renamed: "R", modified: "M" };

function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => diff.split("\n").slice(0, 4000), [diff]);
  return (
    <pre className="max-h-[28rem] overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-5" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }} dir="ltr">
      {lines.map((line, i) => {
        const color = line.startsWith("+++") || line.startsWith("---")
          ? "var(--color-ink-muted)"
          : line.startsWith("+")
            ? "var(--color-success)"
            : line.startsWith("-")
              ? "var(--color-danger)"
              : line.startsWith("@@")
                ? "var(--color-accent)"
                : line.startsWith("diff ")
                  ? "var(--color-ink)"
                  : "var(--color-ink-muted)";
        const bg = line.startsWith("+") && !line.startsWith("+++")
          ? "color-mix(in oklch, var(--color-success) 8%, transparent)"
          : line.startsWith("-") && !line.startsWith("---")
            ? "color-mix(in oklch, var(--color-danger) 8%, transparent)"
            : undefined;
        return (
          <div key={i} style={{ color, background: bg, fontWeight: line.startsWith("diff ") ? 600 : undefined }}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function ChangesPanel({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const [changes, setChanges] = useState<TaskChanges | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getTaskChanges(taskId)
      .then(setChanges)
      .catch(() => setChanges(null));
  }, [taskId]);

  // Re-read whenever the task moves: a finishing task settles its changes.
  useEffect(load, [load, status]);

  async function act(run: () => Promise<TaskChanges>) {
    setBusy(true);
    setError(null);
    try {
      setChanges(await run());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!changes || (!changes.available && !changes.error)) return null;
  const state = changes.state ? STATE[changes.state] : null;
  const added = changes.files.reduce((n, f) => n + f.additions, 0);
  const removed = changes.files.reduce((n, f) => n + f.deletions, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: easeOutExpo }}
      className="mb-6 overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-2 text-start" aria-expanded={open}>
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }} className="inline-block text-xs" style={{ color: "var(--color-ink-muted)" }}>
            ▸
          </motion.span>
          <span className="text-sm font-medium">{t("التغييرات")}</span>
          {changes.mode === "worktree" && (
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
              {t("نسخة معزولة")}
            </span>
          )}
          {changes.files.length > 0 && (
            <bdi className="text-xs tabular-nums" dir="ltr">
              <span style={{ color: "var(--color-success)" }}>+{added}</span> <span style={{ color: "var(--color-danger)" }}>−{removed}</span>
            </bdi>
          )}
          {state && (
            <span className="flex items-center gap-1.5 text-xs" style={{ color: state.color }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: state.color }} />
              {state.label}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1.5">
          {changes.state === "applied" && (
            <Button variant="ghost" disabled={busy} onClick={() => void act(() => revertTaskChanges(taskId))}>
              {t("رجّع التغييرات")}
            </Button>
          )}
          {(changes.state === "pending" || changes.state === "reverted") && (
            <Button disabled={busy} onClick={() => void act(() => applyTaskChanges(taskId))}>
              {t("طبّق على مجلدي")}
            </Button>
          )}
          {changes.state === "conflict" && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => applyTaskChanges(taskId))}>
                {t("جرّب مرة تانية")}
              </Button>
              <Button disabled={busy} onClick={() => void act(() => applyTaskChanges(taskId, true))} title={t("بيدمج التغييرات وبيحط علامات تعارض بالأماكن اللي ما قدر يدمجها، لتحلّها بإيدك.")}>
                {t("ادمج مع علامات تعارض")}
              </Button>
            </>
          )}
        </div>
      </div>

      {(error || changes.error) && (
        <p className="flex items-center gap-1.5 px-4 pb-3 text-xs" style={{ color: "var(--color-danger)" }}>
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {error || changes.error}
        </p>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: easeOutExpo }}
            className="overflow-hidden border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex flex-col gap-3 p-4">
              {changes.files.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {t("ما في ملفات متغيّرة.")}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5" dir="ltr">
                  {changes.files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2 font-mono text-xs">
                      <span className="w-4 text-center font-semibold" style={{ color: file.status === "added" ? "var(--color-success)" : file.status === "deleted" ? "var(--color-danger)" : "var(--color-accent)" }}>
                        {FILE_STATUS[file.status] ?? "M"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{file.path}</span>
                      {file.binary ? (
                        <span style={{ color: "var(--color-ink-muted)" }}>bin</span>
                      ) : (
                        <span className="tabular-nums">
                          <span style={{ color: "var(--color-success)" }}>+{file.additions}</span> <span style={{ color: "var(--color-danger)" }}>−{file.deletions}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {changes.diff && <DiffView diff={changes.diff} />}
              {changes.truncated && (
                <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  {t("الفرق طويل — انعرض أوله بس.")}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
