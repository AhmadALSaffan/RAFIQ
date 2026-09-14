/**
 * Everything that renders *inside* the conversation: the welcome screen, day dividers,
 * user bubbles, assistant blocks (text, tool steps, permissions, task cards) and the
 * summary marker. No data fetching lives here — it all arrives as props.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getTask } from "../../lib/api";
import type { ChatMessage, ChatPart, LlmModel, TaskStatus } from "../../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../../lib/motion";
import { clockTime, dayLabel, isNewDay } from "../../lib/time";
import { BrandMark } from "../../components/BrandMark";
import { useElementMenu } from "../../components/ContextMenu";
import { Markdown } from "../../components/Markdown";
import { TokenText } from "../../components/TokenText";
import { AttachmentGallery } from "../../components/Attachments";
import { PermissionCard, ThinkingDots, ToolCard } from "../../components/steps";
import { CompressIcon, ModelsIcon, TasksIcon } from "../../components/Icons";
import { Button } from "../../components/ui";
import { Logo } from "../../components/Logo";
import { StatusPill } from "../../components/StatusPill";
import { SILENT_TOOLS, textOf } from "./draft";
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

export function MessageView({ message, model, onOpenTask }: { message: ChatMessage; model?: LlmModel; onOpenTask: (id: string) => void }) {
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
        ])}
      >
        {message.attachments && message.attachments.length > 0 && <AttachmentGallery attachments={message.attachments} align="end" />}
        {message.content && (
          <div className="whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-relaxed" style={{ background: "var(--color-surface-2)" }} dir="auto">
            <TokenText text={message.content} />
          </div>
        )}
        {message.created_at && (
          <span
            className="px-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: "var(--color-ink-muted)" }}
            dir="auto"
          >
            {clockTime(message.created_at)}
          </span>
        )}
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
        {visible.map((part, i) => (
          <motion.div
            key={part.kind === "text" ? `text-${i}` : `${part.kind}-${"id" in part ? part.id : part.task_id}`}
            initial={live ? { opacity: 0, y: 3 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
          >
            {part.kind === "text" ? (
              <div>
                <Markdown text={part.text} />
                {live && i === visible.length - 1 && <span className="stream-caret" aria-hidden />}
              </div>
            ) : part.kind === "tool" ? (
              <ToolCard tool={part.tool} args={part.args} result={part.ok === undefined ? undefined : { ok: part.ok, output: part.output ?? "" }} />
            ) : part.kind === "permission" ? (
              <PermissionCard call={part.call} resolution={part.resolution} onResolve={(r) => onResolve?.(part.id, r)} />
            ) : (
              <TaskCard taskId={part.task_id} title={part.title} onOpen={() => onOpenTask(part.task_id)} fresh={live} />
            )}
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

/** A task the model created from the chat; tracks its live status until it settles. */
function TaskCard({ taskId, title, onOpen, fresh }: { taskId: string; title: string; onOpen: () => void; fresh: boolean }) {
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const t = await getTask(taskId);
      if (!alive) return;
      if (!t) {
        setGone(true);
        return;
      }
      setStatus(t.status);
      if (["queued", "pending", "running"].includes(t.status)) timer = setTimeout(poll, 2500);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [taskId]);

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
          <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {gone ? t("مهمة انحذفت") : t("مهمة جديدة انضافت للدور")}
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
