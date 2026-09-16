/**
 * Everything that renders *inside* the conversation: the welcome screen, day dividers,
 * user bubbles, assistant blocks (text, tool steps, permissions, task cards) and the
 * summary marker. No data fetching lives here — it all arrives as props.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatMessage, ChatPart, LlmModel, TaskStatus } from "../../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../../lib/motion";
import { clockTime, dayLabel, isNewDay } from "../../lib/time";
import { BrandMark } from "../../components/BrandMark";
import { useElementMenu } from "../../components/ContextMenu";
import { Markdown } from "../../components/Markdown";
import { TokenText } from "../../components/TokenText";
import { AttachmentGallery } from "../../components/Attachments";
import { PermissionCard, ThinkingDots, ToolCard } from "../../components/steps";
import { CompressIcon, ForkIcon, ModelsIcon, TasksIcon } from "../../components/Icons";
import { Button } from "../../components/ui";
import { Logo } from "../../components/Logo";
import { StatusPill } from "../../components/StatusPill";
import { SILENT_TOOLS, textOf } from "./draft";
import { isGone, useTaskSummaries } from "./taskStatus";
import { SUGGESTIONS } from "./constants";

import { t } from "../../i18n";
/** First screen of an empty chat: what رفيق can do, in one glance. */
export function Welcome({ hasModels, onPick, onModels }: { hasModels: boolean; onPick: (text: string) => void; onModels: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeOutExpo }}
      className="flex flex-col items-center py-10 text-center"
    >
      <motion.div
        initial={{ scale: 0.7, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: easeOutExpo }}
      >
        <Logo className="h-16 w-16" />
      </motion.div>
      <h2 className="mt-5 text-2xl font-semibold">{t("أهلاً، شو ببالك اليوم؟")}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
        {hasModels
          ? t("اسألني أي شي، ابعتلي صور أو ملفات، حدد مجلد من فوق لأعدّل ملفاته، أو ابعت خطة وأنا بحوّلها لمهام.")
          : t("أضف نموذج شغّال أولاً عشان نقدر نحكي.")}
      </p>

      {hasModels ? (
        <motion.div variants={listContainer} initial="hidden" animate="show" className="mt-6 flex w-full flex-col gap-2">
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s.text}
              variants={listItem}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onPick(s.text)}
              className="rounded-xl border px-4 py-3 text-start transition-colors hover:border-[var(--color-accent)]"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <span className="block text-sm" dir="auto">
                {s.text}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {s.hint}
              </span>
            </motion.button>
          ))}
        </motion.div>
      ) : (
        <Button className="mt-6" onClick={onModels}>
          <ModelsIcon className="h-4 w-4" />
          {t("روح للنماذج")}
        </Button>
      )}
    </motion.div>
  );
}

export function startsNewDay(previous: ChatMessage | undefined, message: ChatMessage): boolean {
  return isNewDay(previous?.created_at, message.created_at);
}

/** Quiet date marker between days of a long-running conversation. */
export function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
      <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        {dayLabel(iso)}
      </span>
      <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
    </div>
  );
}

export function MessageView({
  message,
  model,
  onOpenTask,
  onEdit,
  onFork,
}: {
  message: ChatMessage;
  model?: LlmModel;
  onOpenTask: (id: string) => void;
  /** Rewind to before this question and put it back in the box (off while a reply runs). */
  onEdit?: (message: ChatMessage) => void;
  /** Copy the chat up to here into a new one. */
  onFork?: (message: ChatMessage) => void;
}) {
  const menu = useElementMenu();
  if (message.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: easeOutExpo }}
        className="group flex max-w-[85%] flex-col items-end gap-2 self-end"
        onContextMenu={menu(() => [
          { id: "copy", label: t("انسخ الرسالة"), onSelect: () => void navigator.clipboard.writeText(message.content) },
          ...(onEdit ? [{ id: "edit", label: t("عدّل وابعت من جديد"), onSelect: () => onEdit(message) }] : []),
          ...(onFork ? [{ id: "fork", label: t("افرع محادثة من هون"), onSelect: () => onFork(message) }] : []),
        ])}
      >
        {message.attachments && message.attachments.length > 0 && <AttachmentGallery attachments={message.attachments} align="end" />}
        {message.content && (
          <div className="whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-relaxed" style={{ background: "var(--color-surface-2)" }} dir="auto">
            <TokenText text={message.content} />
          </div>
        )}
        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onEdit && message.content && (
            <button
              onClick={() => onEdit(message)}
              title={t("عدّل السؤال وابعته من جديد — اللي بعده بينمسح")}
              className="rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("عدّل")}
            </button>
          )}
          {onFork && (
            <button
              onClick={() => onFork(message)}
              title={t("انسخ المحادثة لهون بمحادثة جديدة، وخلّي هاي متل ما هي")}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <ForkIcon className="h-3 w-3" />
              {t("فرّع")}
            </button>
          )}
          {message.created_at && (
            <span className="px-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="auto">
              {clockTime(message.created_at)}
            </span>
          )}
        </div>
      </motion.div>
    );
  }
  const parts: ChatPart[] = message.parts?.length ? message.parts : message.content ? [{ kind: "text", text: message.content }] : [];
  return <AssistantBlock parts={parts} reasoning={message.reasoning ?? ""} model={model} onOpenTask={onOpenTask} />;
}

export function AssistantBlock({
  parts,
  reasoning,
  live = false,
  model,
  onResolve,
  onOpenTask,
}: {
  parts: ChatPart[];
  reasoning: string;
  live?: boolean;
  model?: LlmModel;
  onResolve?: (id: string, resolution: "approved" | "denied") => void;
  onOpenTask: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const menu = useElementMenu();
  // Reading a skill is housekeeping, not something the user asked for — keep it off screen,
  // and let the ordinary "thinking" state cover the wait.
  const visible = parts.filter((p) => !(p.kind === "tool" && SILENT_TOOLS.has(p.tool)));
  const text = textOf(visible);
  const last = visible[visible.length - 1];
  const waiting = visible.some((p) => p.kind === "permission" && p.resolution === "pending");
  const toolRunning = last?.kind === "tool" && last.ok === undefined;
  const thinking = live && !waiting && !toolRunning && last?.kind !== "text";

  return (
    <motion.div
      initial={live ? { opacity: 0, y: 3 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: easeOutExpo }}
      className="group flex gap-3"
      onContextMenu={menu(() => [
        { id: "copy-reply", label: t("انسخ الرد"), disabled: !text, onSelect: () => void navigator.clipboard.writeText(text) },
      ])}
    >
      <motion.div
        className="mt-1 shrink-0"
        animate={live ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={live ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        {/* The model that wrote the reply gets the byline, not the app. */}
        {model ? (
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: "var(--color-surface-2)" }}
            title={model.name}
          >
            <BrandMark provider={model.provider} className="h-4 w-4" />
          </span>
        ) : (
          <Logo className="h-7 w-7" />
        )}
      </motion.div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {reasoning && <Reasoning text={reasoning} live={live && !text} />}
        {groupTasks(visible).map((item) => (
          <motion.div
            key={item.key}
            initial={live ? { opacity: 0, y: 3 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
          >
            {item.kind === "tasks" ? (
              item.tasks.length === 1 ? (
                <TaskCard taskId={item.tasks[0].task_id} title={item.tasks[0].title} onOpen={() => onOpenTask(item.tasks[0].task_id)} fresh={live} />
              ) : (
                <TaskGroup tasks={item.tasks} onOpen={onOpenTask} fresh={live} />
              )
            ) : item.part.kind === "text" ? (
              <div>
                <Markdown text={item.part.text} />
                {live && item.last && <span className="stream-caret" aria-hidden />}
              </div>
            ) : item.part.kind === "tool" ? (
              <ToolCard
                tool={item.part.tool}
                args={item.part.args}
                result={item.part.ok === undefined ? undefined : { ok: item.part.ok, output: item.part.output ?? "" }}
              />
            ) : item.part.kind === "permission" ? (
              <PermissionCard call={item.part.call} resolution={item.part.resolution} onResolve={(r) => onResolve?.(permissionId(item.part), r)} />
            ) : null}
          </motion.div>
        ))}
        {thinking && <ThinkingDots label={visible.length ? t("عم يكمّل…") : t("عم يفكّر…")} />}
        {!live && text && (
          <button
            onClick={() =>
              navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              })
            }
            className="-mt-1 self-start rounded-md px-2 py-1 text-xs opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] focus-visible:opacity-100 group-hover:opacity-100"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {copied ? t("انتسخ ✓") : t("نسخ الرد")}
          </button>
        )}
      </div>
    </motion.div>
  );
}

type TaskRef = { task_id: string; title: string };
type Item =
  | { kind: "tasks"; key: string; tasks: TaskRef[] }
  | { kind: "part"; key: string; part: Exclude<ChatPart, { kind: "task" }>; last: boolean };

/** Tasks created one after another read as one batch, so they're drawn as one card. */
function groupTasks(parts: ChatPart[]): Item[] {
  const items: Item[] = [];
  parts.forEach((part, i) => {
    if (part.kind === "task") {
      const prev = items[items.length - 1];
      if (prev?.kind === "tasks") prev.tasks.push(part);
      else items.push({ kind: "tasks", key: `tasks-${part.task_id}`, tasks: [part] });
      return;
    }
    const key = part.kind === "text" ? `text-${i}` : `${part.kind}-${part.id}`;
    items.push({ kind: "part", key, part, last: i === parts.length - 1 });
  });
  return items;
}

function permissionId(part: ChatPart): string {
  return part.kind === "permission" ? part.id : "";
}

/** A task the model created from the chat; tracks its live status until it settles. */
function TaskCard({ taskId, title, onOpen, fresh }: { taskId: string; title: string; onOpen: () => void; fresh: boolean }) {
  const summary = useTaskSummaries([taskId]).get(taskId);
  const gone = isGone(taskId);
  const status: TaskStatus | null = summary?.status ?? null;

  return (
    <motion.button
      onClick={gone ? undefined : onOpen}
      disabled={gone}
      initial={fresh ? { scale: 0.94, opacity: 0 } : false}
      animate={{ scale: 1, opacity: gone ? 0.55 : 1 }}
      whileHover={gone ? undefined : { y: -2 }}
      whileTap={gone ? undefined : { scale: 0.98 }}
      transition={snappy}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start ${fresh ? "flash-accent" : ""}`}
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--color-surface-2)", color: "var(--color-accent)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
        >
          <TasksIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs" style={{ color: summary?.needs_approval ? "var(--color-accent)" : "var(--color-ink-muted)" }}>
            {gone ? t("مهمة انحذفت") : summary?.needs_approval ? t("بتستنى موافقتك — افتحها") : t("مهمة من المحادثة")}
          </span>
          <span className="block truncate text-sm font-medium">
            <TokenText text={title} />
          </span>
        </span>
      </span>
      {status && !gone && <StatusPill status={status} />}
    </motion.button>
  );
}

/** A batch of tasks: how far along it is at a glance, and each task one click away. */
function TaskGroup({ tasks, onOpen, fresh }: { tasks: TaskRef[]; onOpen: (id: string) => void; fresh: boolean }) {
  const known = useTaskSummaries(tasks.map((task) => task.task_id));
  const count = (status: TaskStatus) => tasks.filter((task) => known.get(task.task_id)?.status === status).length;
  const done = count("completed");
  const failed = count("failed") + count("cancelled");
  const running = count("running");
  const waiting = tasks.length - done - failed - running;
  const approvals = tasks.filter((task) => known.get(task.task_id)?.needs_approval).length;
  const settled = done + failed;

  return (
    <motion.div
      initial={fresh ? { scale: 0.97, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={snappy}
      className={`overflow-hidden rounded-xl border ${fresh ? "flash-accent" : ""}`}
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--color-surface-2)", color: "var(--color-accent)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
        >
          <TasksIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {/* Arabic counts: 2–10 take the plural, 11 and up the singular. */}
            {tasks.length <= 10 ? t("{0} مهام", { 0: tasks.length }) : t("{0} من المهام", { 0: tasks.length })}
          </span>
          <span className="flex flex-wrap gap-x-2 text-xs tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
            {running > 0 && <span style={{ color: "var(--color-accent)" }}>{t("{0} شغّالة", { 0: running })}</span>}
            {waiting > 0 && <span>{t("{0} بالانتظار", { 0: waiting })}</span>}
            {done > 0 && <span style={{ color: "var(--color-success)" }}>{t("{0} خلصت", { 0: done })}</span>}
            {failed > 0 && <span style={{ color: "var(--color-danger)" }}>{t("{0} وقفت", { 0: failed })}</span>}
            {approvals > 0 && <span style={{ color: "var(--color-accent)" }}>{t("{0} بتستنى موافقتك", { 0: approvals })}</span>}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
          {settled}/{tasks.length}
        </span>
      </div>
      <div className="mx-4 mb-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: failed && !done ? "var(--color-danger)" : "var(--color-accent)" }}
          initial={false}
          animate={{ width: `${(settled / tasks.length) * 100}%` }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        />
      </div>
      <ul className="max-h-72 overflow-y-auto border-t py-1" style={{ borderColor: "var(--color-border)" }}>
        {tasks.map((task) => {
          const summary = known.get(task.task_id);
          const gone = isGone(task.task_id);
          return (
            <li key={task.task_id}>
              <button
                onClick={gone ? undefined : () => onOpen(task.task_id)}
                disabled={gone}
                className="flex w-full items-center gap-3 px-4 py-1.5 text-start transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  <TokenText text={task.title} />
                </span>
                {summary?.needs_approval && (
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--color-accent)" }}>
                    {t("بتستنى موافقتك")}
                  </span>
                )}
                {gone ? (
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                    {t("انحذفت")}
                  </span>
                ) : (
                  summary && <StatusPill status={summary.status} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = live || open;
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {live ? <ThinkingDots label={t("عم يفكّر…")} /> : <span>{expanded ? t("إخفاء التفكير ▴") : t("عرض التفكير ▾")}</span>}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: easeOutExpo }}
            className="overflow-hidden"
          >
            <p
              className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed"
              style={{ background: "var(--color-surface)", color: "var(--color-ink-muted)" }}
              dir="auto"
            >
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Marks where the older turns were folded into a summary, and shows what was kept. */
export function SummaryDivider({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOutExpo }}>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
        >
          <CompressIcon className="h-3.5 w-3.5" />
          {t("اللي فوق انطوى بملخص —")} {open ? t("إخفاء") : t("اعرضه")}
        </button>
        <span className="h-px flex-1" style={{ background: "var(--color-border)" }} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: easeOutExpo }}
            className="mt-3 overflow-hidden whitespace-pre-wrap rounded-lg border px-4 py-3 text-xs leading-relaxed"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink-muted)" }}
          >
            {summary}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
