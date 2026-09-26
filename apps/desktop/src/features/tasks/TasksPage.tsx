/**
 * The tasks: what Rafiq is working on (often several at once), what's waiting, and what it
 * finished.
 *
 * Same treatment as the inbox — filters and search on top, one row per task, and each row
 * is a small status report: running ones carry a live line, and anything blocked on
 * permission says so loudly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useCurrentWorkspaceId } from "../../lib/workspace";
import { AnimatePresence, motion } from "motion/react";
import { createTask, deleteTask, getTask, listModels, listTasks } from "../../lib/api";
import type { LlmModel, TaskStatus, TaskSummary } from "../../lib/types";
import { listContainer, listItem, snappy } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { folderName } from "../../lib/folders";
import { fieldDir } from "../../lib/bidi";
import { BrandMark } from "../../components/BrandMark";
import { useElementMenu, usePageMenu } from "../../components/ContextMenu";
import {
  ChatIcon,
  FolderIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  TasksIcon,
  TrashIcon,
  XIcon,
} from "../../components/Icons";
import { StatusPill } from "../../components/StatusPill";
import { PageHeader, RefreshButton, StatusStripe } from "../../components/Page";
import { Button, EmptyState, Reveal } from "../../components/ui";
import { NewTaskForm } from "./NewTaskForm";
import { SchedulesPanel, TemplatesPanel, type TemplateSeed } from "./automation";
import { STATUS_COLOR, statusFilterLabel } from "./pieces";

import { t } from "../../i18n";
type Filter = "all" | "active" | "planned" | "queued" | "completed" | "failed";
type View = "tasks" | "schedules" | "templates";

/** Tasks, the ones that start on a schedule, and saved templates — one page, three views. */
function ViewTabs({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const tabs: { id: View; label: string }[] = [
    { id: "tasks", label: t("المهام") },
    { id: "schedules", label: t("المجدولة") },
    { id: "templates", label: t("القوالب") },
  ];
  return (
    <div className="mb-5 flex gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className="relative flex-1 rounded-lg px-3 py-1.5 text-sm"
          style={{ color: value === tab.id ? "var(--color-ink)" : "var(--color-ink-muted)" }}
        >
          {value === tab.id && (
            <motion.span
              layoutId="tasks-view"
              className="absolute inset-0 rounded-lg"
              style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--color-border)" }}
              transition={snappy}
            />
          )}
          <span className="relative">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

const FILTERS: Filter[] = ["all", "active", "planned", "queued", "completed", "failed"];

function matchesFilter(task: TaskSummary, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return task.status === "running" || task.status === "pending";
  if (filter === "planned") return task.status === "planned";
  if (filter === "queued") return task.status === "queued";
  if (filter === "completed") return task.status === "completed";
  return task.status === "failed" || task.status === "cancelled";
}

export function TasksPage() {
  const navigate = useNavigate();
  // `?new=1` (from Ctrl+K) opens the new-task form; the flag then leaves the URL.
  const [params, setParams] = useSearchParams();
  const askedNew = params.get("new") === "1";
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (!askedNew) return;
    setComposing(true);
    setParams((p) => {
      p.delete("new");
      return p;
    }, { replace: true });
  }, [askedNew, setParams]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const { search: query } = useLocation();
  const [view, setView] = useState<View>(() => {
    const wanted = new URLSearchParams(query).get("view");
    return wanted === "schedules" || wanted === "templates" ? wanted : "tasks";
  });
  const workspaceId = useCurrentWorkspaceId();
  const [seed, setSeed] = useState<TemplateSeed | null>(null);
  const [cursor, setCursor] = useState(-1);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const searchRef = useRef<HTMLInputElement>(null);
  const menu = useElementMenu();

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      setTasks(await listTasks(workspaceId));
    } catch {
      // The poller tries again in a few seconds — no need to shout at the user.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId]);

  usePageMenu(() => [
    { id: "new-task", label: t("مهمة جديدة"), onSelect: () => setComposing(true), disabled: models.length === 0 },
    { id: "refresh", label: t("حدّث القائمة"), onSelect: () => void refresh(true) },
    { id: "search", label: t("دوّر بالمهام"), onSelect: () => searchRef.current?.focus() },
    { id: "chat", label: t("روح للمحادثات"), onSelect: () => navigate("/chat") },
  ]);

  useEffect(() => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]));
    void refresh();
    // Statuses move on their own: queued tasks start, chat-created tasks show up.
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const usable = models.filter((m) => m.verify_ok !== false);
  const modelOf = (id: string) => models.find((m) => m.id === id);

  const counts = useMemo(
    () =>
      Object.fromEntries(FILTERS.map((f) => [f, tasks.filter((t) => matchesFilter(t, f)).length])) as Record<
        Filter,
        number
      >,
    [tasks],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        matchesFilter(t, filter) &&
        (!q || [t.title, t.working_dir].some((v) => String(v ?? "").toLowerCase().includes(q))),
    );
  }, [tasks, filter, search]);

  async function removeTask(id: string) {
    setConfirming(null);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await deleteTask(id).catch(() => undefined);
  }

  /** Runs the same request again — the usual answer to a task that failed or drifted. */
  async function rerun(task: TaskSummary) {
    const full = await getTask(task.id);
    if (!full) return;
    const fresh = await createTask({
      title: full.title,
      prompt: full.prompt,
      modelId: full.model_id,
      workingDir: full.working_dir ?? undefined,
      attachmentIds: (full.attachments ?? []).map((a) => a.id),
    });
    navigate(`/tasks/${fresh.id}`);
  }

  // ↑/↓ walk the list and Enter opens — the list gets long after a few days of work.
  // Bound to the window so it works without clicking the page first; typing in the search
  // box keeps its own arrows, and Escape there hands focus back to the list.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (typing && event.key !== "Escape") return;
      if (visible.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCursor((c) => {
          const next = c < 0 ? (step > 0 ? 0 : visible.length - 1) : c + step;
          return Math.max(0, Math.min(visible.length - 1, next));
        });
      } else if (event.key === "Enter" && cursorRef.current >= 0) {
        event.preventDefault();
        navigate(`/tasks/${visible[cursorRef.current].id}`);
      } else if (event.key === "Escape") {
        if (typing) target?.blur();
        setCursor(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, navigate]);

  // Keep the keyboard cursor on screen as it walks past the fold.
  useEffect(() => {
    if (cursor < 0) return;
    document.querySelector(`[data-task-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title={t("المهام")}
        description={t("المهام بتشتغل بالتوازي، إلا اللي بتعدّل نفس الملفات فبتاخد دورها. فيك تضيف كتير مهام، أو تبعت خطة بالمحادثة ورفيق بيقسمها لمهام.")}
        actions={
          <>
            <RefreshButton spinning={refreshing} onClick={() => void refresh(true)} />
            {!composing && (
              <Button
                onClick={() => setComposing(true)}
                disabled={usable.length === 0}
                title={usable.length === 0 ? t("أضف نموذج شغّال أولاً") : undefined}
              >
                <PlusIcon className="h-4 w-4" />
                {t("مهمة جديدة")}
              </Button>
            )}
          </>
        }
      />

      <ViewTabs value={view} onChange={setView} />

      {view === "schedules" && <SchedulesPanel models={models} />}
      {view === "templates" && (
        <TemplatesPanel
          models={models}
          onUse={(seed) => {
            setSeed(seed);
            setView("tasks");
            setComposing(true);
          }}
        />
      )}

      {view === "tasks" && (<>
      <Reveal open={composing}>
        <NewTaskForm
          key={seed ? `${seed.title}-${seed.prompt.length}` : "blank"}
          models={models}
          initial={seed}
          onCancel={() => {
            setComposing(false);
            setSeed(null);
          }}
          onCreated={(task) => {
            setComposing(false);
            setSeed(null);
            navigate(`/tasks/${task.id}`);
          }}
        />
      </Reveal>

      {tasks.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setCursor(-1);
              }}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors"
              style={{
                borderColor: filter === f ? "var(--color-accent)" : "var(--color-border)",
                background: filter === f ? "color-mix(in oklch, var(--color-accent) 12%, transparent)" : "transparent",
                color: filter === f ? "var(--color-ink)" : "var(--color-ink-muted)",
              }}
            >
              {statusFilterLabel(f)}
              <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}

          <div
            className="flex min-w-40 flex-1 items-center gap-2 rounded-lg border px-3"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <SearchIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setCursor(-1);
              }}
              placeholder={t("دوّر بمهامك…")}
              className="w-full bg-transparent py-1.5 text-xs outline-none"
              style={{ color: "var(--color-ink)" }}
              dir={fieldDir(search)}
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label={t("مسح")} style={{ color: "var(--color-ink-muted)" }}>
                <XIcon className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-[62px] rounded-lg border" style={{ borderColor: "var(--color-border)" }} />
          ))}
        </div>
      ) : tasks.length === 0 && !composing ? (
        <EmptyState
          icon={<TasksIcon className="h-8 w-8" />}
          text={
            usable.length === 0
              ? t("أضف نموذج شغّال من صفحة النماذج، وبعدين ابدأ أول مهمة.")
              : t("ما في مهام لسا. ابدأ أول مهمة واختار المجلد اللي بدك رفيق يشتغل فيه.")
          }
          action={
            usable.length === 0 ? (
              <Button onClick={() => navigate("/models")}>{t("روح للنماذج")}</Button>
            ) : (
              <Button onClick={() => setComposing(true)}>{t("مهمة جديدة")}</Button>
            )
          }
        />
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في مهام مطابقة.")}
        </p>
      ) : (
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {visible.map((task, index) => {
              const running = task.status === "running" || task.status === "pending";
              const model = modelOf(task.model_id);
              const focused = index === cursor;
              return (
                <motion.li
                  key={task.id}
                  variants={listItem}
                  exit="exit"
                  layout="position"
                  className="group relative"
                  data-task-row={index}
                  onMouseLeave={() => confirming === task.id && setConfirming(null)}
                  onContextMenu={menu(() => [
                    { id: "open", label: t("افتح المهمة"), onSelect: () => navigate(`/tasks/${task.id}`) },
                    { id: "rerun", label: t("شغّلها من جديد"), onSelect: () => void rerun(task) },
                    { id: "copy", label: t("انسخ العنوان"), onSelect: () => void navigator.clipboard.writeText(task.title) },
                    { id: "delete", label: t("احذف المهمة"), onSelect: () => void removeTask(task.id), danger: true },
                  ])}
                >
                  <RowDelete
                    confirming={confirming === task.id}
                    running={running}
                    onClick={() => (confirming === task.id ? void removeTask(task.id) : setConfirming(task.id))}
                  />

                  <motion.button
                    whileTap={{ scale: 0.99 }}
                    transition={snappy}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                    onMouseEnter={() => setCursor(-1)}
                    className={`relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-lg border px-4 py-3 text-start transition-[background-color,padding] hover:bg-[var(--color-surface-2)] ${
                      confirming === task.id ? "pe-24" : "pe-12"
                    }`}
                    style={{
                      borderColor: focused
                        ? "var(--color-accent)"
                        : task.needs_approval
                          ? "var(--color-pending)"
                          : "var(--color-border)",
                      background: focused
                        ? "color-mix(in oklch, var(--color-accent) 8%, var(--color-surface))"
                        : "var(--color-surface)",
                    }}
                  >
                    {running && <RunningLine />}

                    <StatusStripe color={STATUS_COLOR[task.status]} />

                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium" dir="auto">
                        {task.title}
                      </span>
                      <span
                        className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        <span className="flex items-center gap-1">
                          {model && <BrandMark provider={model.provider} className="h-3 w-3" />}
                          {model?.name ?? task.model_id}
                        </span>
                        {task.working_dir && (
                          <span className="flex items-center gap-1" title={task.working_dir}>
                            <FolderIcon className="h-3.5 w-3.5" />
                            {folderName(task.working_dir)}
                          </span>
                        )}
                        {task.attachments && task.attachments.length > 0 && (
                          <span className="flex items-center gap-1">
                            <PaperclipIcon className="h-3.5 w-3.5" />
                            {task.attachments.length}
                          </span>
                        )}
                        {task.origin?.chat_id && (
                          <span className="flex items-center gap-1" style={{ color: "var(--color-accent)" }}>
                            <ChatIcon className="h-3.5 w-3.5" />
                            {t("من المحادثة")}
                          </span>
                        )}
                        <span>{timeAgo(task.created_at)}</span>
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-2">
                      <AnimatePresence>
                        {task.needs_approval && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: [1, 1.06, 1] }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            transition={{ scale: { duration: 1.6, repeat: Infinity, ease: "easeInOut" } }}
                            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                            style={{
                              background: "color-mix(in oklch, var(--color-pending) 18%, transparent)",
                              color: "var(--color-pending)",
                            }}
                          >
                            <ShieldIcon className="h-3.5 w-3.5" />
                            {t("بدها إذنك")}
                          </motion.span>
                        )}
                      </AnimatePresence>
                      <StatusPill status={task.status as TaskStatus} />
                    </span>
                  </motion.button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
      </>)}
    </div>
  );
}

/** A line that keeps moving while a task runs — the row's own heartbeat. */
function RunningLine() {
  return (
    <motion.span
      className="absolute inset-x-0 top-0 h-0.5"
      style={{ background: "linear-gradient(90deg, transparent, var(--color-accent), transparent)" }}
      animate={{ x: ["-60%", "160%"] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

function RowDelete({ confirming, running, onClick }: { confirming: boolean; running: boolean; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      transition={snappy}
      aria-label={confirming ? t("تأكيد الحذف") : t("حذف المهمة")}
      title={confirming ? (running ? t("المهمة شغّالة — رح توقف وتنحذف") : t("اضغط مرة ثانية للحذف")) : t("حذف")}
      className={`absolute end-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-opacity ${
        confirming ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
      }`}
      style={{
        background: confirming ? "var(--color-danger)" : "transparent",
        color: confirming ? "white" : "var(--color-ink-muted)",
      }}
    >
      <TrashIcon className="h-3.5 w-3.5" />
      {confirming && <span>{t("حذف؟")}</span>}
    </motion.button>
  );
}
