/**
 * One task, start to finish: the request, every step the agent took, and full control
 * over it — stop it, run it again, open its folder, or delete it.
 *
 * Live updates arrive over the task WebSocket, so the page reads as it happens; when the
 * run lands while the user is watching, the completion sweep plays once.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { approveTaskPlan, cancelTask, createTask, deleteTask, getTask, listModels, rejectTaskPlan, resolvePermission, subscribeTask } from "../../lib/api";
import type { LlmModel, TaskDetail, TaskEvent, ToolCall } from "../../lib/types";
import { folderName, revealPath } from "../../lib/folders";
import { easeOutExpo } from "../../lib/motion";
import { clockTime } from "../../lib/time";
import { StatusPill } from "../../components/StatusPill";
import { BrandMark } from "../../components/BrandMark";
import { ActionProgress, CompletionSweep } from "../../components/Feedback";
import { usePageMenu } from "../../components/ContextMenu";
import {
  AlertIcon,
  ChatIcon,
  ClockIcon,
  CopyIcon,
  ListIcon,
  FolderIcon,
  RefreshIcon,
  SpinnerIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
} from "../../components/Icons";
import { Button, DrawnCheck } from "../../components/ui";
import { Markdown } from "../../components/Markdown";
import { PermissionCard, ThinkingDots, ToolCard } from "../../components/steps";
import { AttachmentGallery } from "../../components/Attachments";
import { formatDuration } from "./pieces";
import { fieldDir } from "../../lib/bidi";
import { ChangesPanel } from "./ChangesPanel";

import { t } from "../../i18n";
type Block =
  | { kind: "message"; key: string; text: string }
  | { kind: "tool"; key: string; call?: ToolCall; tool: string; result?: { ok: boolean; output: string } }
  | { kind: "permission"; key: string; event: Extract<TaskEvent, { type: "permission_request" }> }
  | { kind: "plan"; key: string; text: string }
  | { kind: "note"; key: string; text: string }
  | { kind: "error"; key: string; message: string };

/** Pairs each tool_call with the tool_result that follows it so they read as one step. */
function toBlocks(events: TaskEvent[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === "message") blocks.push({ kind: "message", key: e.id, text: e.text });
    else if (e.type === "tool_call") {
      const next = events[i + 1];
      if (next?.type === "tool_result" && next.tool === e.call.tool) {
        blocks.push({ kind: "tool", key: e.id, call: e.call, tool: e.call.tool, result: { ok: next.ok, output: next.output } });
        i++;
      } else {
        blocks.push({ kind: "tool", key: e.id, call: e.call, tool: e.call.tool });
      }
    } else if (e.type === "tool_result") {
      blocks.push({ kind: "tool", key: e.id, tool: e.tool, result: { ok: e.ok, output: e.output } });
    } else if (e.type === "permission_request") blocks.push({ kind: "permission", key: e.id, event: e });
    else if (e.type === "plan") blocks.push({ kind: "plan", key: e.id, text: e.text });
    else if (e.type === "plan_approved") blocks.push({ kind: "note", key: e.id, text: t("وافقت على الخطة — بلّش التنفيذ.") });
    else if (e.type === "error") blocks.push({ kind: "error", key: e.id, message: e.message });
  }
  return blocks;
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [sweep, setSweep] = useState<"success" | "danger" | null>(null);
  const [copied, setCopied] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastStatus = useRef<string | null>(null);

  useEffect(() => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    lastStatus.current = null;
    getTask(id).then((t) => {
      if (!cancelled) setTask(t ?? null);
    });
    // The WS snapshot only carries status+events, so it is merged onto the fetched task
    // rather than replacing it — and dropped entirely if it beats the fetch, because a
    // half-populated task (no prompt, no timestamps) would render as a broken page.
    const unsubscribe = subscribeTask(id, (t) => setTask((prev) => (prev ? { ...prev, ...t } : prev)));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  const status = task?.status ?? null;

  // Play the sweep only on a real transition seen on this screen — never on first paint.
  useEffect(() => {
    if (!status) return;
    const previous = lastStatus.current;
    lastStatus.current = status;
    if (!previous || previous === status) return;
    if (status === "completed") setSweep("success");
    else if (status === "failed" || status === "cancelled") setSweep("danger");
    // The socket only sends status+events, so fields like updated_at go stale the moment
    // the run ends — fetch once more so the finished time (and the duration) are real.
    if (id && status !== "running" && status !== "pending" && status !== "queued") {
      getTask(id).then((fresh) => fresh && setTask((prev) => (prev ? { ...prev, ...fresh } : fresh)));
    }
  }, [status, id]);

  useEffect(() => {
    if (status !== "running" && status !== "pending") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [status]);

  const blocks = useMemo(() => (task ? toBlocks(task.events) : []), [task]);
  const running = status === "running" || status === "pending";
  const isActive = running || status === "queued";
  const waitingOnUser = blocks.some((b) => b.kind === "permission" && b.event.resolution === "pending");
  const lastBlock = blocks[blocks.length - 1];
  const toolInFlight = lastBlock?.kind === "tool" && !lastBlock.result;

  const toolsUsed = useMemo(() => {
    const names = new Set(blocks.filter((b) => b.kind === "tool").map((b) => (b as { tool: string }).tool));
    return names.size;
  }, [blocks]);

  useEffect(() => {
    // Follow new steps only while the reader is already at the end — scrolling up to read an
    // earlier step must not be yanked back down (nor fought by a smooth scroll) on every event.
    const end = bottomRef.current;
    if (isActive && end && end.getBoundingClientRect().top - window.innerHeight < 240) {
      end.scrollIntoView({ block: "end" });
    }
  }, [blocks.length, isActive]);

  const copyPrompt = useCallback(() => {
    if (!task) return;
    void navigator.clipboard.writeText(task.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [task]);

  const rerun = useCallback(async () => {
    if (!task || rerunning) return;
    setRerunning(true);
    try {
      const fresh = await createTask({
        title: task.title,
        prompt: task.prompt,
        modelId: task.model_id,
        workingDir: task.working_dir ?? undefined,
        attachmentIds: (task.attachments ?? []).map((a) => a.id),
        mode: task.mode ?? "auto",
        workspaceId: task.workspace_id ?? null,
      });
      navigate(`/tasks/${fresh.id}`);
    } finally {
      setRerunning(false);
    }
  }, [task, rerunning, navigate]);

  usePageMenu(() => [
    { id: "back", label: t("رجوع للمهام"), onSelect: () => navigate("/tasks") },
    { id: "copy-prompt", label: t("انسخ الطلب"), onSelect: copyPrompt, disabled: !task },
    { id: "rerun", label: t("شغّلها من جديد"), onSelect: () => void rerun(), disabled: !task },
    {
      id: "folder",
      label: t("افتح المجلد"),
      onSelect: () => task?.working_dir && void revealPath(task.working_dir),
      disabled: !task?.working_dir,
    },
  ]);

  if (!task) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <BackLink onClick={() => navigate("/tasks")} />
        <div className="mt-6 flex flex-col gap-3">
          <div className="shimmer h-7 w-2/3 rounded-md" />
          <div className="shimmer h-16 rounded-lg" />
          <div className="shimmer h-24 rounded-lg" />
        </div>
      </div>
    );
  }

  const model = models.find((m) => m.id === task.model_id);
  // While it runs the row's updated_at stands still, so count against the ticking clock.
  const duration = running
    ? formatDuration(task.created_at, new Date(now).toISOString())
    : formatDuration(task.created_at, task.updated_at);

  function handleResolve(eventId: string, resolution: "approved" | "denied") {
    if (!id) return;
    // Optimistic: the banner settles immediately; the WS event_updated confirms it.
    setTask((prev) =>
      prev
        ? {
            ...prev,
            events: prev.events.map((e) => (e.id === eventId && e.type === "permission_request" ? { ...e, resolution } : e)),
          }
        : prev,
    );
    resolvePermission(id, eventId, resolution);
  }

  return (
    <div className="relative mx-auto max-w-3xl px-8 py-10">
      <CompletionSweep show={sweep !== null} tone={sweep ?? "success"} onDone={() => setSweep(null)} />

      <BackLink onClick={() => navigate("/tasks")} />

      <header className="relative mb-4 mt-4 overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
        <ActionProgress active={running} />
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold" style={{ textWrap: "balance" }} dir="auto">
              {task.title}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" style={{ color: "var(--color-ink-muted)" }}>
              <span className="flex items-center gap-1.5">
                {model && <BrandMark provider={model.provider} className="h-3.5 w-3.5" />}
                {model?.name ?? task.model_id}
              </span>
              {task.working_dir && (
                <motion.button
                  whileHover={{ y: -1 }}
                  onClick={() => void revealPath(task.working_dir!)}
                  className="flex items-center gap-1 underline-offset-2 hover:underline"
                  title={t("افتح {0}", { 0: task.working_dir })}
                >
                  <FolderIcon className="h-4 w-4" />
                  {folderName(task.working_dir)}
                </motion.button>
              )}
              {task.origin?.chat_id && (
                <motion.button
                  whileHover={{ y: -1 }}
                  onClick={() => navigate(`/chat/${task.origin!.chat_id}`)}
                  className="flex items-center gap-1 underline-offset-2 hover:underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  <ChatIcon className="h-4 w-4" />
                  {t("انعملت من محادثة")}
                </motion.button>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusPill status={task.status} />
            <AnimatePresence>
              {isActive && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => id && void cancelTask(id)}>
                    <StopIcon className="h-3.5 w-3.5" />
                    {t("إيقاف")}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <DeleteTaskButton
              running={isActive}
              onConfirm={async () => {
                if (!id) return;
                await deleteTask(id);
                navigate("/tasks", { replace: true });
              }}
            />
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2 text-xs"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink-muted)" }}
        >
          <Stat icon={<TerminalIcon className="h-3.5 w-3.5" />} value={blocks.length} text={(n) => t("{0} خطوة", { 0: n })} />
          <Stat icon={<RefreshIcon className="h-3.5 w-3.5" />} value={toolsUsed} text={(n) => t("{0} أداة", { 0: n })} />
          {duration && (
            <span className="flex items-center gap-1.5">
              <ClockIcon className="h-3.5 w-3.5" />
              {running ? t("شغّالة من") : t("استغرقت")} {duration}
            </span>
          )}
          <span className="ms-auto flex items-center gap-1.5" title={task.created_at}>
            {t("بلّشت")} {clockTime(task.created_at)}
          </span>
        </div>
      </header>

      <div
        className="mb-6 flex flex-col gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir="auto">
          {task.prompt}
        </p>
        {task.attachments && task.attachments.length > 0 && <AttachmentGallery attachments={task.attachments} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={copyPrompt}>
            {copied ? <DrawnCheck className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            {copied ? t("انتسخ") : t("انسخ الطلب")}
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void rerun()} disabled={rerunning}>
            {rerunning ? <SpinnerIcon className="h-3.5 w-3.5" /> : <RefreshIcon className="h-3.5 w-3.5" />}
            {t("شغّلها من جديد")}
          </Button>
          {task.working_dir && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void revealPath(task.working_dir!)}>
              <FolderIcon className="h-3.5 w-3.5" />
              {t("افتح المجلد")}
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {task.status === "queued" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}
            transition={{ duration: 0.35, ease: easeOutExpo }}
            className="mb-6 flex items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          >
            <motion.span
              animate={{ rotate: [0, 180, 180, 360] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", times: [0, 0.4, 0.6, 1] }}
              className="inline-flex"
            >
              <ClockIcon className="h-5 w-5" />
            </motion.span>
            {t("بالانتظار — رح تبلّش لحالها أول ما تخلص المهام اللي بتعدّل نفس الملفات أو اللي لازم تخلص قبلها.")}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {task.status === "planned" && (
          <PlanApproval
            key="plan"
            plan={task.plan ?? ""}
            onApprove={async (plan) => {
              const updated = await approveTaskPlan(task.id, plan);
              setTask((prev) => (prev ? { ...prev, ...updated, events: prev.events } : prev));
            }}
            onReject={async () => {
              const updated = await rejectTaskPlan(task.id);
              setTask((prev) => (prev ? { ...prev, ...updated, events: prev.events } : prev));
            }}
          />
        )}
      </AnimatePresence>

      <ChangesPanel taskId={task.id} status={task.status} />

      <ol className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {blocks.map((block) => (
            <motion.li
              key={block.key}
              layout="position"
              initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.36, ease: easeOutExpo }}
            >
              <BlockView block={block} onResolve={handleResolve} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>

      <AnimatePresence>
        {running && !waitingOnUser && !toolInFlight && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: easeOutExpo }}
            className="mt-4"
          >
            <ThinkingDots />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {task.status === "completed" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: easeOutExpo }}
            className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium"
            style={{
              borderColor: "color-mix(in oklch, var(--color-success) 40%, transparent)",
              background: "color-mix(in oklch, var(--color-success) 8%, transparent)",
              color: "var(--color-success)",
            }}
          >
            <DrawnCheck className="h-5 w-5" />
            {t("خلصت المهمة")}{duration ? t(" بـ{0}", { 0: duration }) : ""}
            {task.working_dir && (
              <Button variant="ghost" className="ms-auto px-2 py-1 text-xs" onClick={() => void revealPath(task.working_dir!)}>
                <FolderIcon className="h-3.5 w-3.5" />
                {t("شوف الملفات")}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={bottomRef} />
    </div>
  );
}

/** A count with its noun, phrased by the dictionary so plurals read right in every language. */
function Stat({ icon, value, text }: { icon: React.ReactNode; value: number; text: (n: number) => string }) {
  return (
    <span className="flex items-center gap-1.5">
      {icon}
      <motion.span key={value} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="tabular-nums">
        {text(value)}
      </motion.span>
    </span>
  );
}

function DeleteTaskButton({ running, onConfirm }: { running: boolean; onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {confirming ? (
        <motion.div
          key="confirm"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.16 }}
          className="flex items-center gap-1"
        >
          <Button
            variant="danger"
            className="px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
            }}
          >
            {busy ? <SpinnerIcon className="h-3.5 w-3.5" /> : <TrashIcon className="h-3.5 w-3.5" />}
            {running ? t("أوقف واحذف") : t("تأكيد الحذف")}
          </Button>
          <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => setConfirming(false)}>
            {t("لا")}
          </Button>
        </motion.div>
      ) : (
        <motion.button
          key="trash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setConfirming(true)}
          aria-label={t("حذف المهمة")}
          title={t("حذف المهمة")}
          className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ color: "var(--color-ink-muted)" }}
        >
          <TrashIcon className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** Plan mode: the model's plan, editable, waiting for a yes before anything runs. */
function PlanApproval({ plan, onApprove, onReject }: { plan: string; onApprove: (plan: string) => Promise<void>; onReject: () => Promise<void> }) {
  const [text, setText] = useState(plan);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function run(kind: "approve" | "reject") {
    setBusy(kind);
    try {
      if (kind === "approve") await onApprove(text.trim() || plan);
      else await onReject();
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: easeOutExpo }}
      className="pending-ring mb-6 rounded-xl border-2 px-4 py-4"
      style={{ borderColor: "var(--color-pending)", background: "var(--color-surface)" }}
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <ListIcon className="h-4 w-4" style={{ color: "var(--color-pending)" }} />
        {t("الخطة جاهزة — راجعها قبل ما ينفّذ")}
        <button onClick={() => setEditing((v) => !v)} className="ms-auto text-xs underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }}>
          {editing ? t("عرض") : t("عدّل الخطة")}
        </button>
      </div>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="input resize-y font-mono text-xs leading-5" dir={fieldDir(text)} />
      ) : (
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
          <Markdown text={text} />
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void run("approve")} disabled={busy !== null}>
          {busy === "approve" ? <SpinnerIcon className="h-4 w-4" /> : <DrawnCheck className="h-4 w-4" />}
          {t("وافق ونفّذ")}
        </Button>
        <Button variant="danger" onClick={() => void run("reject")} disabled={busy !== null}>
          {t("ارفض")}
        </Button>
        <p className="ms-auto self-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("لسا ما تغيّر شي بمجلدك.")}
        </p>
      </div>
    </motion.section>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <motion.button whileHover={{ x: 3 }} onClick={onClick} className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
      {t("→ رجوع للمهام")}
    </motion.button>
  );
}

function BlockView({
  block,
  onResolve,
}: {
  block: Block;
  onResolve: (eventId: string, resolution: "approved" | "denied") => void;
}) {
  if (block.kind === "message") return <Markdown text={block.text} />;
  if (block.kind === "plan") {
    return (
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-ink-muted)" }}>
          <ListIcon className="h-3.5 w-3.5" />
          {t("الخطة")}
        </p>
        <Markdown text={block.text} />
      </div>
    );
  }
  if (block.kind === "note") {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-success)" }}>
        <DrawnCheck className="h-3.5 w-3.5" />
        {block.text}
      </p>
    );
  }
  if (block.kind === "tool") return <ToolCard tool={block.tool} args={block.call?.args} result={block.result} />;
  if (block.kind === "permission") {
    return (
      <PermissionCard
        call={block.event.call}
        resolution={block.event.resolution}
        onResolve={(resolution) => onResolve(block.event.id, resolution)}
      />
    );
  }
  return (
    <div
      className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
      style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{block.message}</span>
    </div>
  );
}
