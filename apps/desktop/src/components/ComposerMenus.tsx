import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { completeIssue, commentOnIssue, listIssues, listWorkspaceFiles } from "../lib/api";
import type { TrackerIssue, WorkspaceFile } from "../lib/types";
import { easeOutExpo } from "../lib/motion";
import { BrandMark } from "./BrandMark";
import {
  AlertIcon,
  CompressIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  HelpIcon,
  ModelsIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  SpinnerIcon,
  TasksIcon,
} from "./Icons";
import { systemFileIcon } from "../lib/fileIcons";
import { fieldDir } from "../lib/bidi";
import { Button, DrawnCheck } from "./ui";

import { t } from "../i18n";
export type CommandId =
  | "task"
  | "file"
  | "attach"
  | "folder"
  | "model"
  | "config"
  | "summarize"
  | "retry"
  | "copy"
  | "export"
  | "done"
  | "new"
  | "help";

export interface CommandDef {
  id: CommandId;
  label: string;
  hint: string;
  aliases: string[];
  Icon: typeof TasksIcon;
  needs?: "folder" | "integration" | "chat";
}

export const COMMANDS: CommandDef[] = [
  { id: "task", label: t("/مهمة"), hint: t("اذكر مهمة من Jira أو غيرها"), aliases: ["task", "issue", t("مهمة"), t("جيرا")], Icon: TasksIcon, needs: "integration" },
  { id: "file", label: t("/ملف"), hint: t("اذكر ملف من مجلد المحادثة (أو اكتب @)"), aliases: ["file", t("ملف")], Icon: FileIcon, needs: "folder" },
  { id: "attach", label: t("/أرفق"), hint: t("ارفع صورة أو ملف من جهازك"), aliases: ["attach", "upload", t("ارفق"), t("أرفق"), t("مرفق")], Icon: PaperclipIcon },
  { id: "folder", label: t("/مجلد"), hint: t("حدد مجلد العمل لهالمحادثة"), aliases: ["folder", "dir", t("مجلد")], Icon: FolderIcon },
  { id: "model", label: t("/نموذج"), hint: t("بدّل النموذج اللي بيرد عليك"), aliases: ["model", t("نموذج"), t("موديل")], Icon: ModelsIcon },
  { id: "config", label: t("/إعدادات"), hint: t("طول الرد، لغته، الحرارة، وتشغيل الأدوات"), aliases: ["config", "settings", t("اعدادات"), t("إعدادات"), t("ضبط")], Icon: SettingsIcon },
  { id: "summarize", label: t("/لخّص"), hint: t("اطوِ المحادثة بملخص عشان توفّر توكنز"), aliases: ["summarize", "compact", t("لخص"), t("لخّص"), t("تلخيص")], Icon: CompressIcon, needs: "chat" },
  { id: "retry", label: t("/أعد"), hint: t("احذف آخر رد وجرّب من جديد"), aliases: ["retry", "again", t("اعد"), t("أعد"), t("كرر")], Icon: RefreshIcon, needs: "chat" },
  { id: "copy", label: t("/انسخ"), hint: t("انسخ آخر رد للحافظة"), aliases: ["copy", t("انسخ"), t("نسخ")], Icon: CopyIcon, needs: "chat" },
  { id: "export", label: t("/صدّر"), hint: t("احفظ المحادثة كملف Markdown"), aliases: ["export", "save", t("صدر"), t("صدّر"), t("تصدير"), t("حفظ")], Icon: DownloadIcon, needs: "chat" },
  { id: "done", label: t("/خلصت"), hint: t("اكتب تعليق على المهمة وعلّمها مكتملة"), aliases: ["done", "complete", t("خلصت"), t("انجزت"), t("أنجزت")], Icon: DrawnCheckIconShim, needs: "integration" },
  { id: "new", label: t("/جديد"), hint: t("ابدأ محادثة جديدة"), aliases: ["new", t("جديد")], Icon: PlusIcon },
  { id: "help", label: t("/مساعدة"), hint: t("كل الأوامر والاختصارات"), aliases: ["help", t("مساعدة"), t("اوامر"), t("أوامر")], Icon: HelpIcon },
];

function DrawnCheckIconShim({ className }: { className?: string }) {
  return <DrawnCheck className={className} />;
}

export type TriggerKind = "/" | "@" | "#";

/** Reads the token being typed right before the caret: "/tas", "@src/ma", "#RAF-1".
 *  Deliberately forgiving — it also fires when the trigger follows a word or punctuation
 *  ("شوف@…"), because requiring a leading space made the menu silently not open. */
export function readTrigger(text: string, caret: number): { kind: TriggerKind; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /([/@#])([^\s/@#]*)$/.exec(before);
  if (!match) return null;
  const start = before.length - match[1].length - match[2].length;
  return { kind: match[1] as TriggerKind, query: match[2], start };
}

/** Swaps the token under the caret for the chosen value, keeping the rest of the text. */
export function replaceTrigger(text: string, start: number, caret: number, insertion: string): { text: string; caret: number } {
  const next = `${text.slice(0, start)}${insertion}${text.slice(caret)}`;
  return { text: next, caret: start + insertion.length };
}

function MenuShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: easeOutExpo }}
      className="absolute bottom-full start-0 end-0 mb-2 origin-bottom overflow-hidden rounded-xl border shadow-lg"
      style={{ zIndex: "var(--z-index-dropdown)" as unknown as number, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {children}
    </motion.div>
  );
}

function Rows<T>({
  items,
  active,
  onPick,
  onHover,
  render,
  empty,
}: {
  items: T[];
  active: number;
  onPick: (item: T) => void;
  onHover: (index: number) => void;
  render: (item: T) => React.ReactNode;
  empty: React.ReactNode;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  // The mouse moves the selection to a row that is already under the cursor, so only
  // keyboard moves should scroll the list.
  const cameFromMouse = useRef(false);
  const highlight = useId();

  useEffect(() => {
    const row = activeRef.current;
    if (!row) return;
    if (cameFromMouse.current) {
      cameFromMouse.current = false;
      return;
    }
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }, [active, items.length]);

  if (!items.length) {
    return (
      <p className="px-4 py-4 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {empty}
      </p>
    );
  }
  return (
    <motion.ul layoutScroll className="max-h-72 overflow-y-auto overscroll-contain p-1.5" role="listbox">
      {items.map((item, i) => (
        <li key={i} ref={i === active ? activeRef : undefined}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => {
              cameFromMouse.current = true;
              onHover(i);
            }}
            onClick={() => onPick(item)}
            className="relative w-full rounded-lg px-3 py-2 text-start"
          >
            {i === active && (
              <motion.span
                layoutId={highlight}
                className="absolute inset-0 rounded-lg"
                style={{
                  background: "color-mix(in oklch, var(--color-accent) 16%, transparent)",
                  boxShadow: "inset 0 0 0 1px var(--color-accent)",
                }}
                transition={{ type: "spring", stiffness: 620, damping: 44, mass: 0.7 }}
              />
            )}
            <span className="relative block">{render(item)}</span>
          </button>
        </li>
      ))}
    </motion.ul>
  );
}

export function CommandMenu({
  query,
  available,
  onPick,
  onClose,
  registerKeyHandler,
}: {
  query: string;
  available: (cmd: CommandDef) => boolean;
  onPick: (cmd: CommandDef) => void;
  onClose: () => void;
  registerKeyHandler: (handler: (e: React.KeyboardEvent) => boolean) => void;
}) {
  const q = query.toLowerCase();
  const items = COMMANDS.filter((c) => !q || c.aliases.some((a) => a.toLowerCase().startsWith(q)) || c.label.includes(q));
  const [active, setActive] = useState(0);

  useEffect(() => setActive(0), [query]);
  useKeyNav(items.length, active, setActive, () => items[active] && onPick(items[active]), onClose, registerKeyHandler);

  return (
    <MenuShell>
      <Rows
        items={items}
        active={active}
        onHover={setActive}
        onPick={onPick}
        empty={t("ما في أمر بهالاسم")}
        render={(cmd) => (
          <span className="flex items-center gap-2.5">
            <cmd.Icon className="h-4 w-4 shrink-0" style={{ color: "var(--color-accent)" }} />
            <span className="min-w-0">
              <span className="block text-sm">{cmd.label}</span>
              <span className="block text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {cmd.hint}
                {!available(cmd) && cmd.needs === "folder" && t(" — لازم تحدد مجلد أول")}
                {!available(cmd) && cmd.needs === "integration" && t(" — لازم تربط حساب أول")}
                {!available(cmd) && cmd.needs === "chat" && t(" — لازم تبدأ المحادثة أول")}
              </span>
            </span>
          </span>
        )}
      />
    </MenuShell>
  );
}

/** Explorer's own icon for this file type, with our generic glyph as the fallback. */
function FileTypeIcon({ path }: { path: string }) {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setIcon(null);
    systemFileIcon(path).then((url) => alive && setIcon(url));
    return () => {
      alive = false;
    };
  }, [path]);

  if (icon) return <img src={icon} alt="" className="h-4 w-4 shrink-0" draggable={false} />;
  return <FileIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-ink-muted)" }} />;
}

export function FileMenu({
  dir,
  query,
  onPick,
  onClose,
  registerKeyHandler,
}: {
  dir: string | null;
  query: string;
  onPick: (file: WorkspaceFile) => void;
  onClose: () => void;
  registerKeyHandler: (handler: (e: React.KeyboardEvent) => boolean) => void;
}) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!dir) return;
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      listWorkspaceFiles(dir, query, 40)
        .then((f) => alive && setFiles(f))
        .catch(() => alive && setFiles([]))
        .finally(() => alive && setLoading(false));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [dir, query]);

  useEffect(() => setActive(0), [query]);
  useKeyNav(files.length, active, setActive, () => files[active] && onPick(files[active]), onClose, registerKeyHandler);

  if (!dir) {
    return (
      <MenuShell>
        <p className="px-4 py-4 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("حدد مجلد للمحادثة أول (من زر المجلد فوق) عشان تقدر تشاور على ملفاته.")}
        </p>
      </MenuShell>
    );
  }

  return (
    <MenuShell>
      <Rows
        items={files}
        active={active}
        onHover={setActive}
        onPick={onPick}
        empty={loading ? t("جارِ البحث…") : t("ما في ملفات مطابقة")}
        render={(file) => (
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <FileTypeIcon path={file.path} />
              <span className="truncate font-mono text-xs" dir="ltr">
                {file.path}
              </span>
            </span>
            <span className="shrink-0 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`}
            </span>
          </span>
        )}
      />
    </MenuShell>
  );
}

export function IssueMenu({
  query,
  onPick,
  onClose,
  registerKeyHandler,
}: {
  query: string;
  onPick: (issue: TrackerIssue) => void;
  onClose: () => void;
  registerKeyHandler: (handler: (e: React.KeyboardEvent) => boolean) => void;
}) {
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      listIssues(query, 25)
        .then((i) => alive && setIssues(i))
        .catch(() => alive && setIssues([]))
        .finally(() => alive && setLoading(false));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  useEffect(() => setActive(0), [query]);
  useKeyNav(issues.length, active, setActive, () => issues[active] && onPick(issues[active]), onClose, registerKeyHandler);

  return (
    <MenuShell>
      <Rows
        items={issues}
        active={active}
        onHover={setActive}
        onPick={onPick}
        empty={loading ? t("جارِ جلب مهامك…") : t("ما في مهام مطابقة")}
        render={(issue) => (
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <BrandMark provider={issue.provider} className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm" dir="auto">
                  {issue.title}
                </span>
                <span className="font-mono text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                  {issue.key}
                </span>
              </span>
            </span>
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
              {issue.status}
            </span>
          </span>
        )}
      />
    </MenuShell>
  );
}

function useKeyNav(
  count: number,
  active: number,
  setActive: React.Dispatch<React.SetStateAction<number>>,
  choose: () => void,
  close: () => void,
  register: (handler: (e: React.KeyboardEvent) => boolean) => void,
) {
  const state = useRef({ count, active });
  state.current = { count, active };

  useEffect(() => {
    register((e: React.KeyboardEvent) => {
      const { count: n } = state.current;
      // Functional updates, because holding the arrow key fires faster than React re-renders.
      if (e.key === "ArrowDown") {
        setActive((a) => (n ? (a + 1) % n : 0));
        return true;
      }
      if (e.key === "ArrowUp") {
        setActive((a) => (n ? (a - 1 + n) % n : 0));
        return true;
      }
      if (e.key === "Home") {
        setActive(0);
        return true;
      }
      if (e.key === "End") {
        setActive(Math.max(0, n - 1));
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (!n) return false;
        choose();
        return true;
      }
      if (e.key === "Escape") {
        close();
        return true;
      }
      return false;
    });
  });
}

/** The "I'm done" flow: comment on the tracker issue and optionally close it. */
export function DoneDialog({
  preset,
  defaultComment,
  onClose,
  onDone,
}: {
  preset: TrackerIssue | null;
  defaultComment: string;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [selected, setSelected] = useState<TrackerIssue | null>(preset);
  const [comment, setComment] = useState(defaultComment);
  const [markDone, setMarkDone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listIssues("", 30)
      .then((list) => {
        setIssues(list);
        setSelected((cur) => cur ?? list[0] ?? null);
      })
      .catch(() => setIssues([]));
  }, []);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (markDone) {
        const res = await completeIssue(selected.integration_id, selected.key, comment.trim() || undefined);
        onDone(t("{0} صارت «{1}»{2}", { 0: selected.key, 1: res.status, 2: comment.trim() ? t(" مع تعليق") : "" }));
      } else {
        await commentOnIssue(selected.integration_id, selected.key, comment.trim());
        onDone(t("انكتب تعليق على {0}", { 0: selected.key }));
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أحدّث المهمة"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.45)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.96, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ duration: 0.28, ease: easeOutExpo }}
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div>
          <h2 className="text-sm font-semibold">{t("وثّق النتيجة على المهمة")}</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("بينكتب التعليق على حسابك بالمنصّة، وإذا فعّلت الخيار بتنعلّم مكتملة.")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("المهمة")}
          </span>
          {issues.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}>
              {t("ما في مهام مفتوحة — تأكد إنك رابط حساب من صفحة الربط.")}
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border p-1" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
              {issues.map((issue) => {
                const active = selected?.key === issue.key && selected?.integration_id === issue.integration_id;
                return (
                  <button
                    key={`${issue.integration_id}-${issue.key}`}
                    onClick={() => setSelected(issue)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start transition-colors"
                    style={{ background: active ? "color-mix(in oklch, var(--color-accent) 14%, transparent)" : "transparent" }}
                  >
                    <BrandMark provider={issue.provider} className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-xs" dir="auto">
                      {issue.title}
                    </span>
                    <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                      {issue.key}
                    </span>
                    {active && <DrawnCheck className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("التعليق")}
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={6}
            className="input resize-none text-sm"
            placeholder={t("شو انعمل بالضبط…")}
            dir={fieldDir(comment)}
          />
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
          {t("علّمها مكتملة كمان")}
        </label>

        {error && (
          <p className="flex items-start gap-1.5 text-xs" style={{ color: "var(--color-danger)" }}>
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy || !selected || (!markDone && !comment.trim())}>
            {busy ? (
              <>
                <SpinnerIcon className="h-4 w-4" />
                {t("جارِ الإرسال…")}
              </>
            ) : markDone ? (
              t("علّمها مكتملة")
            ) : (
              t("اكتب التعليق")
            )}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("إلغاء")}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function MenuPortalAnimator({ children }: { children: React.ReactNode }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}
