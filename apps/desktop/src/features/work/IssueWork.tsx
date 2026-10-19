/** The "work" side of an issue: the code linked to it, the tasks Rafiq ran on it, its
 *  subtasks and links, its files (drop one to attach it), time logging, and the history of
 *  what Rafiq changed on it — with undo. */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { attachToIssue, linkIssues, listIntegrationActions, logIssueWork } from "../../lib/api";
import type { IntegrationAccount, IntegrationAction, TrackerIssueDetail } from "../../lib/types";
import { openExternal } from "../../lib/links";
import { timeAgo } from "../../lib/time";
import { notify } from "../../lib/toast";
import { Button } from "../../components/ui";
import { ClockIcon, FileIcon, GitIcon, PaperclipIcon, PlusIcon, PullRequestIcon, SubtaskIcon, TasksIcon } from "../../components/Icons";
import { FileDropzone, type FileDropzoneUpload } from "../../components/arc/file-dropzone/file-dropzone";
import { ActionList } from "../integrations/ActionLog";
import { t } from "../../i18n";

const LINK_KINDS = [
  { value: "relates", label: t("مرتبطة بـ") },
  { value: "blocks", label: t("بتعيق") },
  { value: "blocked_by", label: t("معاقة بـ") },
  { value: "duplicates", label: t("مكررة من") },
] as const;

function Heading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-4 flex items-center gap-1.5 text-[11px] font-medium first:mt-0" style={{ color: "var(--color-ink-muted)" }}>
      {icon}
      {children}
    </h3>
  );
}

export function IssueWork({
  detail,
  account,
  onReload,
  onAddSubtask,
}: {
  detail: TrackerIssueDetail;
  account?: IntegrationAccount;
  onReload: () => Promise<unknown>;
  onAddSubtask?: () => void;
}) {
  const can = (c: string) => !!account?.capabilities.includes(c as never) && !account.settings.read_only;
  const [minutes, setMinutes] = useState("");
  const [other, setOther] = useState("");
  const [kind, setKind] = useState<(typeof LINK_KINDS)[number]["value"]>("relates");

  // Each dropped or pasted file goes straight to the tracker; the row shows its progress.
  const upload: FileDropzoneUpload = async (item, { onProgress }) => {
    if (!item.file) return;
    onProgress(15);
    await attachToIssue(detail.integration_id, detail.key, item.file);
    onProgress(100);
    void onReload();
  };

  return (
    <div className="flex flex-col">
      {detail.dev.length > 0 && (
        <>
          <Heading icon={<PullRequestIcon className="h-3.5 w-3.5" />}>{t("الكود المرتبط")}</Heading>
          <ul className="flex flex-col gap-1">
            {detail.dev.map((d) => (
              <li key={d.url}>
                <button onClick={() => void openExternal(d.url)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs hover:bg-[var(--color-surface-2)]" style={{ background: "var(--color-bg)" }}>
                  {d.kind === "pull_request" ? <PullRequestIcon className="h-3.5 w-3.5 shrink-0" /> : <GitIcon className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate" dir="auto">{d.title}</span>
                  {d.state && <span className="shrink-0 rounded-full px-1.5 text-[10px]" style={{ background: "var(--color-surface-2)" }}>{d.state}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {detail.tasks.length > 0 && (
        <>
          <Heading icon={<TasksIcon className="h-3.5 w-3.5" />}>{t("تاسكات رفيق عليها")}</Heading>
          <ul className="flex flex-col gap-1">
            {detail.tasks.map((task) => (
              <li key={task.id}>
                <Link to={`/tasks/${task.id}`} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-[var(--color-surface-2)]" style={{ background: "var(--color-bg)" }}>
                  <span className="min-w-0 flex-1 truncate" dir="auto">{task.title}</span>
                  <span style={{ color: "var(--color-ink-muted)" }}>{task.status} · {timeAgo(task.created_at)}</span>
                </Link>
                {(task.branch || task.pr_url) && (
                  <p className="mt-0.5 flex items-center gap-2 px-2.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                    {task.branch && <span className="font-mono" dir="ltr">{task.branch}</span>}
                    {task.pr_url && (
                      <button className="underline underline-offset-2" onClick={() => void openExternal(task.pr_url!)}>
                        {t("طلب الدمج")}
                      </button>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <Heading icon={<SubtaskIcon className="h-3.5 w-3.5" />}>{t("المهام الفرعية والروابط")}</Heading>
      {detail.subtasks.length === 0 && detail.links.length === 0 && (
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{t("ما في.")}</p>
      )}
      <ul className="flex flex-col gap-1 text-xs">
        {detail.subtasks.map((s) => (
          <li key={s} className="rounded-lg px-2.5 py-1.5 font-mono" style={{ background: "var(--color-bg)" }} dir="auto">{s}</li>
        ))}
        {detail.links.map((l) => (
          <li key={`${l.kind}-${l.key}`} className="flex gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--color-bg)" }}>
            <span style={{ color: "var(--color-ink-muted)" }}>{l.kind}</span>
            <span className="font-mono" dir="ltr">{l.key}</span>
            {l.title && <span className="truncate" dir="auto">{l.title}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onAddSubtask && can("create") && (
          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={onAddSubtask}>
            <PlusIcon className="h-3.5 w-3.5" />
            {t("مهمة فرعية")}
          </Button>
        )}
        {can("link") && (
          <form
            className="flex items-center gap-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!other.trim()) return;
              try {
                await linkIssues(detail.integration_id, detail.key, other.trim(), kind);
                setOther("");
                notify({ type: "success", title: t("انربطت") });
                await onReload();
              } catch (err) {
                notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
              }
            }}
          >
            <select className="input py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("نوع الربط")}>
              {LINK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input className="input w-28 py-1 font-mono text-xs" dir="ltr" placeholder="APP-12" value={other} onChange={(e) => setOther(e.target.value)} />
            <Button type="submit" variant="ghost" className="px-2 py-1 text-xs" disabled={!other.trim()}>{t("اربط")}</Button>
          </form>
        )}
      </div>

      <Heading icon={<PaperclipIcon className="h-3.5 w-3.5" />}>{t("الملفات")}</Heading>
      <ul className="flex flex-col gap-1">
        {detail.attachments.map((a) => (
          <li key={a.url || a.name}>
            <button onClick={() => a.url && void openExternal(a.url)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs hover:bg-[var(--color-surface-2)]" style={{ background: "var(--color-bg)" }}>
              <FileIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate" dir="auto">{a.name}</span>
              {a.size ? <span style={{ color: "var(--color-ink-muted)" }}>{Math.max(1, Math.round(a.size / 1024))} KB</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {can("attach") && (
        <div className="mt-2">
          <FileDropzone
            maxFiles={10}
            maxSize={25 * 1024 * 1024}
            label={t("أرفق ملفات")}
            description={t("اسحب ملف لهون، أو اضغط لتختار، أو الصق لقطة شاشة (Ctrl+V)")}
            onUpload={upload}
            acceptPaste
          />
        </div>
      )}

      {can("worklog") && (
        <>
          <Heading icon={<ClockIcon className="h-3.5 w-3.5" />}>{t("الوقت")}</Heading>
          <form
            className="flex items-center gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              const value = Number(minutes);
              if (!value) return;
              try {
                await logIssueWork(detail.integration_id, detail.key, value);
                setMinutes("");
                notify({ type: "success", title: t("انسجّل {0} دقيقة", { 0: value }) });
              } catch (err) {
                notify({ type: "error", title: err instanceof Error ? err.message : t("ما زبط") });
              }
            }}
          >
            <input className="input w-20 py-1 text-xs" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} dir="ltr" aria-label={t("دقايق")} />
            <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>{t("دقيقة")}</span>
            <Button type="submit" variant="ghost" className="px-2 py-1 text-xs" disabled={!Number(minutes)}>{t("سجّل")}</Button>
          </form>
        </>
      )}
    </div>
  );
}

export function IssueHistory({ integrationId, issueKey }: { integrationId: string; issueKey: string }) {
  const [actions, setActions] = useState<IntegrationAction[] | null>(null);
  const load = () => listIntegrationActions({ integrationId, key: issueKey, limit: 50 }).then(setActions).catch(() => setActions([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId, issueKey]);
  if (actions === null) return <div className="shimmer h-14 rounded-lg" />;
  return <ActionList actions={actions} onUndone={() => void load()} />;
}
