/**
 * Everything one issue knows, and everything you can do to it, in one panel.
 *
 * Two ideas drive the layout: the facts are scannable (a labelled grid, not a paragraph),
 * and every action reports itself (a progress bar while it runs, a result you can see).
 * The status control is the real one — it lists the states the tracker actually allows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  commentOnIssue,
  completeIssue,
  getIssue,
  listIssueStatuses,
  setIssueStatus,
} from "../../lib/api";
import type { StatusOption, TrackerIssue, TrackerIssueDetail } from "../../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { fieldDir } from "../../lib/bidi";
import { BrandMark } from "../../components/BrandMark";
import { Markdown } from "../../components/Markdown";
import {
  AlertIcon,
  ChatIcon,
  ClockIcon,
  CopyIcon,
  LinkIcon,
  SpinnerIcon,
  TasksIcon,
  XIcon,
} from "../../components/Icons";
import { Button, DrawnCheck } from "../../components/ui";
import { ActionProgress, CompletionSweep } from "../../components/Feedback";
import { CATEGORY_COLOR, CATEGORY_LABEL, dateLabel, isOverdue, StatusChip } from "./pieces";

import { t } from "../../i18n";
type Busy = "comment" | "status" | "complete" | "task" | null;
type Tab = "details" | "comments";

export function IssuePanel({
  summary,
  onClose,
  onChanged,
  onDiscuss,
  onRunTask,
}: {
  summary: TrackerIssue;
  onClose: () => void;
  onChanged: (issue: TrackerIssue) => void;
  onDiscuss: (issue: TrackerIssue) => void;
  onRunTask: (issue: TrackerIssue) => Promise<void>;
}) {
  const [detail, setDetail] = useState<TrackerIssueDetail | null>(null);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [tab, setTab] = useState<Tab>("details");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [done, setDone] = useState(false); // drives the one-shot completion animation
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issue = detail ?? summary;
  const key = `${summary.integration_id}::${summary.key}`;

  const reload = useCallback(async () => {
    const fresh = await getIssue(summary.integration_id, summary.key);
    setDetail(fresh);
    onChanged(fresh);
    return fresh;
  }, [summary.integration_id, summary.key, onChanged]);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setStatuses([]);
    setTab("details");
    setNote(null);
    setError(null);
    setDone(false);

    getIssue(summary.integration_id, summary.key)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : t("ما قدرت أجيب التفاصيل")));
    // The status list is a second call: it's useful, but the panel shouldn't wait for it.
    listIssueStatuses(summary.integration_id, summary.key)
      .then((list) => alive && setStatuses(list))
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [summary.integration_id, summary.key]);

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 5000);
  }

  async function run(kind: Exclude<Busy, null>, work: () => Promise<string | void>) {
    setBusy(kind);
    setError(null);
    try {
      const message = await work();
      if (message) flash(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أكمّل العملية"));
    } finally {
      setBusy(null);
    }
  }

  const postComment = () =>
    run("comment", async () => {
      const body = comment.trim();
      if (!body) return;
      await commentOnIssue(issue.integration_id, issue.key, body);
      setComment("");
      await reload();
      setTab("comments");
      return t("انكتب التعليق");
    });

  const changeStatus = (option: StatusOption) =>
    run("status", async () => {
      const result = await setIssueStatus(issue.integration_id, issue.key, option.id, comment.trim() || undefined);
      setComment("");
      await reload();
      if (option.category === "done") setDone(true);
      return t("صارت «{0}»", { 0: result.status });
    });

  const markDone = () =>
    run("complete", async () => {
      const result = await completeIssue(issue.integration_id, issue.key, comment.trim() || undefined);
      setComment("");
      await reload();
      setDone(true);
      return t("صارت «{0}»", { 0: result.status });
    });

  const isDone = issue.status_category === "done";
  const comments = detail?.comments ?? [];

  return (
    <motion.aside
      key={key}
      initial={{ x: -32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -32, opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.26, ease: easeOutExpo }}
      className="relative flex w-[440px] shrink-0 flex-col border-s"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <ActionProgress active={busy !== null} />
      <CompletionSweep show={done} onDone={() => setDone(false)} />

      <header className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <BrandMark provider={issue.provider} className="h-4 w-4 shrink-0" />
        <button
          onClick={() => void navigator.clipboard.writeText(issue.key).then(() => flash(t("انتسخ المفتاح")))}
          title={t("انسخ المفتاح")}
          className="group flex min-w-0 items-center gap-1 font-mono text-xs"
          dir="ltr"
          style={{ color: "var(--color-ink-muted)" }}
        >
          <span className="truncate">{issue.key}</span>
          <CopyIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
        <StatusChip issue={issue} />
        <span className="flex-1" />
        <button
          onClick={onClose}
          aria-label={t("إغلاق")}
          className="rounded-md p-1 transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ color: "var(--color-ink-muted)" }}
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4">
          <h2 className="text-base font-semibold leading-relaxed" dir="auto" style={{ textWrap: "balance" }}>
            {issue.title}
          </h2>

          {issue.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          <StatusControl
            issue={issue}
            options={statuses}
            busy={busy === "status"}
            onPick={changeStatus}
          />

          <Facts issue={issue} />
        </div>

        <div className="sticky top-0 z-10 mt-5 flex gap-1 border-b px-5 pt-1 backdrop-blur" style={{ borderColor: "var(--color-border)", background: "color-mix(in oklch, var(--color-surface) 88%, transparent)" }}>
          <TabButton active={tab === "details"} onClick={() => setTab("details")}>
            {t("التفاصيل")}
          </TabButton>
          <TabButton active={tab === "comments"} onClick={() => setTab("comments")} count={comments.length}>
            {t("التعليقات")}
          </TabButton>
        </div>

        <div className="px-5 py-4">
          {tab === "details" ? (
            detail === null && !error ? (
              <div className="flex flex-col gap-2">
                <div className="shimmer h-4 w-3/4 rounded" />
                <div className="shimmer h-4 w-full rounded" />
                <div className="shimmer h-4 w-2/3 rounded" />
              </div>
            ) : issue.description ? (
              <Markdown text={issue.description} />
            ) : (
              <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("ما في وصف لهالمهمة.")}
              </p>
            )
          ) : (
            <Comments detail={detail} />
          )}
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder={isDone ? t("اكتب تعليق…") : t("اكتب تعليق — أو خليه مع «علّمها مكتملة»")}
          className="input resize-none text-sm"
          dir={fieldDir(comment)}
        />

        <AnimatePresence mode="wait">
          {note && (
            <motion.p
              key={note}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-xs"
              style={{ color: "var(--color-success)" }}
            >
              <DrawnCheck className="h-3.5 w-3.5" />
              {note}
            </motion.p>
          )}
          {error && (
            <motion.p
              key={error}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-1.5 text-xs"
              style={{ color: "var(--color-danger)" }}
            >
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap gap-1.5">
          <Button className="px-3 py-1.5 text-xs" disabled={busy !== null || !comment.trim()} onClick={postComment}>
            {busy === "comment" ? <SpinnerIcon className="h-3.5 w-3.5" /> : <ChatIcon className="h-3.5 w-3.5" />}
            {t("علّق")}
          </Button>

          <CompleteButton done={isDone} busy={busy === "complete"} disabled={busy !== null} onClick={markDone} />

          <SmallButton onClick={() => onDiscuss(issue)} icon={<ChatIcon className="h-3.5 w-3.5" />}>
            {t("ناقشها")}
          </SmallButton>

          <SmallButton
            disabled={busy !== null}
            onClick={() => run("task", async () => {
              await onRunTask(issue);
              return t("انفتحت مهمة عليها");
            })}
            icon={busy === "task" ? <SpinnerIcon className="h-3.5 w-3.5" /> : <TasksIcon className="h-3.5 w-3.5" />}
          >
            {t("نفّذها")}
          </SmallButton>

          <SmallButton
            onClick={() => void navigator.clipboard.writeText(issue.url).then(() => flash(t("انتسخ الرابط")))}
            icon={<CopyIcon className="h-3.5 w-3.5" />}
          >
            {t("انسخ الرابط")}
          </SmallButton>

          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {t("افتحها")}
          </a>
        </div>
      </footer>
    </motion.aside>
  );
}

/** The real status control: whatever the tracker says this issue can become. */
function StatusControl({
  issue,
  options,
  busy,
  onPick,
}: {
  issue: TrackerIssue;
  options: StatusOption[];
  busy: boolean;
  onPick: (option: StatusOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={ref} className="relative mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: CATEGORY_COLOR[issue.status_category ?? "todo"] }}
          />
          <span className="min-w-0">
            <span className="block text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("الحالة")}
            </span>
            <span className="block truncate text-sm">{issue.status}</span>
          </span>
        </span>
        {busy ? (
          <SpinnerIcon className="h-4 w-4" style={{ color: "var(--color-ink-muted)" }} />
        ) : (
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} style={{ color: "var(--color-ink-muted)" }}>
            ▾
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: easeOutExpo }}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border p-1 shadow-lg"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            {options.map((option) => (
              <li key={option.id}>
                <button
                  onClick={() => {
                    setOpen(false);
                    onPick(option);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: CATEGORY_COLOR[option.category ?? "todo"] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {option.category && (
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                      {CATEGORY_LABEL[option.category]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The labelled grid of everything the tracker knows. */
function Facts({ issue }: { issue: TrackerIssue }) {
  const overdue = isOverdue(issue);
  const rows: { label: string; value: React.ReactNode }[] = [];

  const add = (label: string, value: React.ReactNode) => value && rows.push({ label, value });

  add(t("النوع"), issue.issue_type);
  add(
    t("الأولوية"),
    issue.priority && (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: priorityColor(issue.priority) }} />
        {issue.priority}
      </span>
    ),
  );
  add(t("المشروع"), issue.project);
  add(t("مسندة لـ"), issue.assignee && <Person name={issue.assignee} />);
  add(t("منشئها"), issue.reporter && <Person name={issue.reporter} />);
  add(
    t("الاستحقاق"),
    issue.due_date && (
      <span className="inline-flex items-center gap-1.5" style={{ color: overdue ? "var(--color-danger)" : undefined }}>
        <ClockIcon className="h-3 w-3" />
        {dateLabel(issue.due_date)}
        {overdue && <span className="text-[10px]">{t("متأخرة")}</span>}
      </span>
    ),
  );
  add(t("التقدير"), issue.estimate);
  add(t("المهمة الأم"), issue.parent);
  add(t("الإصدار"), issue.milestone);
  add(t("أُنشئت"), issue.created_at && <span title={dateLabel(issue.created_at) ?? ""}>{timeAgo(issue.created_at)}</span>);
  add(t("آخر تحديث"), issue.updated_at && <span title={dateLabel(issue.updated_at) ?? ""}>{timeAgo(issue.updated_at)}</span>);
  add(t("الحساب"), issue.integration_name);

  return (
    <dl className="mt-4 grid grid-cols-2 gap-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="min-w-0 rounded-lg px-3 py-2"
          style={{ background: "var(--color-bg)" }}
        >
          <dt className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {row.label}
          </dt>
          <dd className="mt-0.5 truncate text-xs" dir="auto">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function priorityColor(priority: string): string {
  const p = priority.toLowerCase();
  if (/(highest|urgent|blocker|critical|عاجل)/.test(p)) return "var(--color-danger)";
  if (/(high|عالي)/.test(p)) return "var(--color-accent)";
  if (/(low|lowest|منخفض)/.test(p)) return "var(--color-ink-muted)";
  return "var(--color-accent)";
}

/** Initials keep the grid readable when a tracker has no avatars. */
function Person({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium"
        style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}
      >
        {initials}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function Comments({ detail }: { detail: TrackerIssueDetail | null }) {
  if (!detail) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <div key={i} className="shimmer h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  if (detail.comments_error) {
    return (
      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("ما قدرت أجيب التعليقات:")} {detail.comments_error}
      </p>
    );
  }
  if (detail.comments.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("ما في تعليقات بعد — اكتب أول وحدة من تحت.")}
      </p>
    );
  }
  return (
    <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-3">
      {detail.comments.map((c, i) => (
        <motion.li key={i} variants={listItem} className="rounded-lg px-3 py-2" style={{ background: "var(--color-bg)" }}>
          <p className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            <Person name={c.author} />
            {c.created_at && <span className="shrink-0">{timeAgo(c.created_at)}</span>}
          </p>
          <div className="mt-1 text-sm">
            <Markdown text={c.body} />
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="relative px-2.5 pb-2 pt-1 text-xs" style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }}>
      <span className="flex items-center gap-1.5">
        {children}
        {count !== undefined && count > 0 && (
          <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={{ background: "var(--color-surface-2)" }}>
            {count}
          </span>
        )}
      </span>
      {active && (
        <motion.span
          layoutId="issue-tab"
          className="absolute inset-x-1 bottom-0 h-0.5 rounded-full"
          style={{ background: "var(--color-accent)" }}
          transition={snappy}
        />
      )}
    </button>
  );
}

/** The completion button: idle → spinner → a check that stays. */
function CompleteButton({
  done,
  busy,
  disabled,
  onClick,
}: {
  done: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={done ? undefined : { scale: 0.96 }}
      onClick={onClick}
      disabled={disabled || done}
      className="inline-flex items-center gap-1.5 overflow-hidden rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed"
      style={{
        borderColor: done ? "var(--color-success)" : "var(--color-border)",
        color: "var(--color-success)",
        background: done ? "color-mix(in oklch, var(--color-success) 12%, transparent)" : "transparent",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.span key="busy" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <SpinnerIcon className="h-3.5 w-3.5" />
          </motion.span>
        ) : (
          <motion.span key="idle" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <DrawnCheck className="h-3.5 w-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
      {done ? t("مكتملة") : t("علّمها مكتملة")}
    </motion.button>
  );
}

function SmallButton({
  onClick,
  icon,
  disabled = false,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
      style={{ borderColor: "var(--color-border)" }}
    >
      {icon}
      {children}
    </motion.button>
  );
}
