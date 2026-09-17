/**
 * What a task changed in its folder, when the folder is a git repository: which files, the
 * diff, and whether the changes are in the user's folder — with a way to apply or take
 * them back. Worktree tasks bring their changes home when they finish; ones that didn't
 * finish, or no longer applied cleanly, wait here for the user.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { applyTaskChanges, commitTaskChanges, describeTaskChanges, getTaskChanges, revertTaskChanges } from "../../lib/api";
import type { ChangesState, CommitDescription, TaskChanges, TaskStatus } from "../../lib/types";
import { easeOutExpo } from "../../lib/motion";
import { Button } from "../../components/ui";
import { AlertIcon, CopyIcon, GitIcon, SpinnerIcon } from "../../components/Icons";
import { DiffView } from "../../components/DiffView";
import { fieldDir } from "../../lib/bidi";
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

export function ChangesPanel({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const [changes, setChanges] = useState<TaskChanges | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commit, setCommit] = useState<{ open: boolean; message: string; pr: CommitDescription | null; busy: "describe" | "commit" | null; done: string | null; copied: boolean }>({
    open: false,
    message: "",
    pr: null,
    busy: null,
    done: null,
    copied: false,
  });

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

  async function suggest() {
    setCommit((c) => ({ ...c, busy: "describe" }));
    setError(null);
    try {
      const pr = await describeTaskChanges(taskId);
      setCommit((c) => ({ ...c, pr, message: pr.commit_message || c.message, busy: null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCommit((c) => ({ ...c, busy: null }));
    }
  }

  async function doCommit() {
    if (!commit.message.trim()) return;
    setCommit((c) => ({ ...c, busy: "commit" }));
    setError(null);
    try {
      const out = await commitTaskChanges(taskId, commit.message.trim());
      setCommit((c) => ({ ...c, busy: null, done: out.sha, open: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCommit((c) => ({ ...c, busy: null }));
    }
  }

  function copyPr() {
    if (!commit.pr) return;
    void navigator.clipboard.writeText(`${commit.pr.pr_title}\n\n${commit.pr.pr_body}`);
    setCommit((c) => ({ ...c, copied: true }));
    setTimeout(() => setCommit((c) => ({ ...c, copied: false })), 1400);
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
          {changes.state === "applied" && !commit.done && (
            <Button variant="ghost" disabled={busy} onClick={() => void act(() => revertTaskChanges(taskId))}>
              {t("رجّع التغييرات")}
            </Button>
          )}
          {changes.state === "applied" && changes.files.length > 0 && !commit.done && (
            <Button disabled={busy} onClick={() => setCommit((c) => ({ ...c, open: !c.open }))} title={t("commit على فرعك الحالي بملفات هالمهمة بس")}>
              <GitIcon className="h-3.5 w-3.5" />
              {t("اعمل commit")}
            </Button>
          )}
          {commit.done && (
            <span className="flex items-center gap-1.5 font-mono text-xs" style={{ color: "var(--color-success)" }} dir="ltr">
              <GitIcon className="h-3.5 w-3.5" />
              {commit.done.slice(0, 7)}
            </span>
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

      <AnimatePresence initial={false}>
        {commit.open && !commit.done && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: easeOutExpo }}
            className="overflow-hidden border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">{t("رسالة الـ commit")}</p>
                <Button variant="ghost" className="px-2 py-1 text-xs" disabled={commit.busy !== null} onClick={() => void suggest()}>
                  {commit.busy === "describe" ? <SpinnerIcon className="h-3.5 w-3.5" /> : null}
                  {t("خلّي النموذج يقترح رسالة ووصف PR")}
                </Button>
              </div>
              <textarea
                value={commit.message}
                onChange={(e) => setCommit((c) => ({ ...c, message: e.target.value }))}
                rows={3}
                className="input resize-none font-mono text-xs"
                placeholder="Add …"
                dir={fieldDir(commit.message)}
              />
              {commit.pr && (
                <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium" dir="auto">
                      {commit.pr.pr_title}
                    </p>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={copyPr}>
                      <CopyIcon className="h-3.5 w-3.5" />
                      {commit.copied ? t("انتسخ") : t("انسخ وصف PR")}
                    </Button>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                    {commit.pr.pr_body}
                  </pre>
                </div>
              )}
              <div className="flex gap-2">
                <Button disabled={commit.busy !== null || !commit.message.trim()} onClick={() => void doCommit()}>
                  {commit.busy === "commit" ? <SpinnerIcon className="h-3.5 w-3.5" /> : <GitIcon className="h-3.5 w-3.5" />}
                  {t("Commit {0} ملف", { 0: changes.files.length })}
                </Button>
                <Button variant="ghost" onClick={() => setCommit((c) => ({ ...c, open: false }))}>
                  {t("إلغاء")}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
