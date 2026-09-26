/**
 * Ctrl+K: every page, the app's own commands, and your chats, tasks and designs in one box.
 *
 * Opened empty it's a map — the pages, the settings sections, what you can do, and what you
 * worked on last. Typing narrows it: names are matched with Arabic folded the way people
 * write it (harakat, hamza forms, ى, ة), and from two letters on the chats are searched
 * inside their messages too (the same search as the chat list), opening at the message.
 *
 * The shortcut listens for the K *key*, not the letter, so it works on an Arabic layout
 * where that key types «ن».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { listChats, listDesigns, listTasks, searchChats } from "../lib/api";
import type { ChatSearchResult, ChatSummary, DesignSummary, TaskSummary } from "../lib/types";
import { useCurrentWorkspaceId } from "../lib/workspace";
import { fieldDir } from "../lib/bidi";
import { timeAgo } from "../lib/time";
import { easeOutExpo } from "../lib/motion";
import {
  ChatIcon,
  CollapseIcon,
  InboxIcon,
  InfoIcon,
  LinkIcon,
  ModelsIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  SunIcon,
  TasksIcon,
} from "./Icons";
import { t } from "../i18n";

type Icon = (props: { className?: string; style?: React.CSSProperties }) => React.ReactElement;

type Item = {
  id: string;
  label: string;
  /** Shown after the label, quieter: where it lives, when it last changed. */
  hint?: string;
  /** A line under the label — the matching words of a message, marked. */
  snippet?: { text: string; marks: [number, number][] };
  Icon: Icon;
  /** Extra words that find it — English and Arabic, whatever the interface language. */
  keywords?: string;
  run: () => void;
};

type Group = { title: string; items: Item[] };

const DEEP_FROM = 2;

// ── Matching ──────────────────────────────────────────────────────────────────

const _MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
// The letters the look-alikes fold into, by code point (ا ي ه): they're data, not UI text.
const ALEF = String.fromCharCode(0x0627);
const YA = String.fromCharCode(0x064a);
const HA = String.fromCharCode(0x0647);

/** Lower-case, accents and harakat gone, hamza forms and the look-alike letters unified. */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(_MARKS, "")
    .toLowerCase()
    .replace(/[أإآٱ]/g, ALEF)
    .replace(/ى/g, YA)
    .replace(/ة/g, HA)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** How well an item answers the query: 0 = not at all; higher is better. Every word of the
 *  query has to appear somewhere; a label that starts with the query ranks first. */
export function score(item: Pick<Item, "label" | "hint" | "keywords">, query: string): number {
  const q = fold(query.trim());
  if (!q) return 1;
  const label = fold(item.label);
  const haystack = `${label} ${fold(item.hint ?? "")} ${fold(item.keywords ?? "")}`;
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.every((w) => haystack.includes(w))) return 0;
  if (label.startsWith(q)) return 3;
  if (words.every((w) => label.includes(w))) return 2;
  return 1;
}

function rank(items: Item[], query: string, limit: number): Item[] {
  return items
    .map((item, i) => ({ item, s: score(item, query), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}

// ── The palette ───────────────────────────────────────────────────────────────

function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <mark key={i} className="rounded-[3px] px-px" style={{ background: "color-mix(in oklch, var(--color-accent) 32%, transparent)", color: "var(--color-ink)" }}>
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export function CommandPalette({
  open,
  onClose,
  theme,
  onToggleTheme,
  navCollapsed,
  onToggleNav,
}: {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  navCollapsed: boolean;
  onToggleNav: () => void;
}) {
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [found, setFound] = useState<ChatSearchResult[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Fresh every time it opens: what you worked on a minute ago belongs in the box.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setFound([]);
    listChats(workspaceId).then(setChats).catch(() => setChats([]));
    listTasks(workspaceId).then(setTasks).catch(() => setTasks([]));
    listDesigns(workspaceId).then(setDesigns).catch(() => setDesigns([]));
  }, [open, workspaceId]);

  // Inside the messages, from two letters on — the newest query wins.
  const q = query.trim();
  useEffect(() => {
    if (!open || q.length < DEEP_FROM) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchChats(q, workspaceId, controller.signal)
        .then((r) => setFound(r.filter((x) => x.snippet && x.matches > 0)))
        .catch(() => undefined);
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, q, workspaceId]);

  const go = useCallback(
    (to: string) => () => {
      onClose();
      navigate(to);
    },
    [navigate, onClose],
  );

  const groups: Group[] = useMemo(() => {
    const pages: Item[] = [
      { id: "p-chat", label: t("المحادثات"), Icon: ChatIcon, keywords: "chats chat conversations", run: go("/chat") },
      { id: "p-work", label: t("شغلي"), Icon: InboxIcon, keywords: "my work issues jira linear github inbox", run: go("/work") },
      { id: "p-designs", label: t("التصاميم"), Icon: SparkIcon, keywords: "designs design ui", run: go("/designs") },
      { id: "p-tasks", label: t("المهام"), Icon: TasksIcon, keywords: "tasks task jobs", run: go("/tasks") },
      { id: "p-models", label: t("النماذج"), Icon: ModelsIcon, keywords: "models model agents keys api", run: go("/models") },
      { id: "p-integrations", label: t("الربط"), Icon: LinkIcon, keywords: "integrations connect jira linear github", run: go("/integrations") },
      { id: "p-settings", label: t("الإعدادات"), Icon: SettingsIcon, keywords: "settings preferences options", run: go("/settings") },
      { id: "p-about", label: t("من نحن"), Icon: InfoIcon, keywords: "about version updates", run: go("/about") },
    ];
    const settings = t("الإعدادات");
    const sections: Item[] = [
      { id: "s-general", label: t("عام"), hint: settings, Icon: SettingsIcon, keywords: "general language layout theme storage", run: go("/settings") },
      { id: "s-backup", label: t("نسخة احتياطية"), hint: settings, Icon: SettingsIcon, keywords: "backup restore export import zip", run: go("/settings") },
      { id: "s-accounts", label: t("الحسابات"), hint: settings, Icon: SettingsIcon, keywords: "accounts sign in login copilot openrouter", run: go("/settings?tab=accounts") },
      { id: "s-agent", label: t("المهام والنماذج"), hint: settings, Icon: SettingsIcon, keywords: "tasks models parallel worktree helper", run: go("/settings?tab=agent") },
      { id: "s-permissions", label: t("الصلاحيات"), hint: settings, Icon: SettingsIcon, keywords: "permissions allow ask deny", run: go("/settings?tab=permissions") },
      { id: "s-memory", label: t("الذاكرة"), hint: settings, Icon: SettingsIcon, keywords: "memory remember", run: go("/settings?tab=memory") },
      { id: "s-web", label: t("الويب والمتصفح"), hint: settings, Icon: SettingsIcon, keywords: "web browser search brave tavily searxng", run: go("/settings?tab=web") },
      { id: "s-mcp", label: "MCP", hint: settings, Icon: SettingsIcon, keywords: "mcp servers tools figma notion github", run: go("/settings?tab=mcp") },
      { id: "s-usage", label: t("التكلفة"), hint: settings, Icon: SettingsIcon, keywords: "cost usage budget tokens spend", run: go("/settings?tab=usage") },
      { id: "s-logs", label: t("السجلات"), hint: settings, Icon: SettingsIcon, keywords: "logs log errors debug", run: go("/settings?tab=logs") },
    ];
    const commands: Item[] = [
      { id: "c-chat", label: t("محادثة جديدة"), Icon: PlusIcon, keywords: "new chat", run: go("/chat") },
      { id: "c-task", label: t("مهمة جديدة"), Icon: PlusIcon, keywords: "new task", run: go("/tasks?new=1") },
      { id: "c-design", label: t("تصميم جديد"), Icon: PlusIcon, keywords: "new design", run: go("/designs?new=1") },
      {
        id: "c-theme",
        label: theme === "dark" ? t("وضع فاتح") : t("وضع غامق"),
        Icon: theme === "dark" ? SunIcon : MoonIcon,
        keywords: "theme dark light mode",
        run: () => {
          onClose();
          onToggleTheme();
        },
      },
      {
        id: "c-nav",
        label: navCollapsed ? t("وسّع الشريط الجانبي") : t("اطوِ الشريط الجانبي"),
        Icon: CollapseIcon,
        keywords: "sidebar collapse expand",
        run: () => {
          onClose();
          onToggleNav();
        },
      },
    ];
    const chatItems: Item[] = chats.map((c) => ({
      id: `chat-${c.id}`,
      label: c.title,
      hint: timeAgo(c.updated_at),
      Icon: ChatIcon,
      run: go(`/chat/${c.id}`),
    }));
    const taskItems: Item[] = tasks.map((task) => ({
      id: `task-${task.id}`,
      label: task.title,
      hint: timeAgo(task.updated_at),
      Icon: TasksIcon,
      run: go(`/tasks/${task.id}`),
    }));
    const designItems: Item[] = designs.map((d) => ({
      id: `design-${d.id}`,
      label: d.title,
      hint: timeAgo(d.updated_at),
      Icon: SparkIcon,
      run: go(`/designs/${d.id}`),
    }));

    if (!q) {
      return [
        { title: t("انتقل"), items: pages },
        { title: t("أوامر"), items: commands },
        { title: t("محادثات"), items: chatItems.slice(0, 5) },
        { title: t("مهام"), items: taskItems.slice(0, 4) },
        { title: t("التصاميم"), items: designItems.slice(0, 3) },
      ].filter((g) => g.items.length);
    }

    // A chat can be here twice: by its name (opens it) and by a message (opens at it).
    const messageItems: Item[] = found
      .slice(0, 6)
      .map((r) => ({
        id: `msg-${r.chat_id}`,
        label: r.title,
        hint: timeAgo(r.updated_at),
        snippet: r.snippet ? { text: r.snippet.text, marks: r.snippet.marks } : undefined,
        Icon: ChatIcon,
        run: go(r.snippet ? `/chat/${r.chat_id}?m=${encodeURIComponent(r.snippet.message_id)}` : `/chat/${r.chat_id}`),
      }));

    return [
      { title: t("انتقل"), items: rank([...pages, ...sections], q, 6) },
      { title: t("أوامر"), items: rank(commands, q, 5) },
      { title: t("محادثات"), items: rank(chatItems, q, 6) },
      { title: t("بالرسائل"), items: messageItems },
      { title: t("مهام"), items: rank(taskItems, q, 5) },
      { title: t("التصاميم"), items: rank(designItems, q, 5) },
    ].filter((g) => g.items.length);
  }, [q, chats, tasks, designs, found, theme, navCollapsed, go, onClose, onToggleTheme, onToggleNav]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let index = -1;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          style={{ background: "color-mix(in oklch, var(--color-bg) 55%, transparent)", backdropFilter: "blur(3px)" }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("ابحث بكل شي")}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: easeOutExpo }}
            className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2.5 border-b px-4" style={{ borderColor: "var(--color-border)" }}>
              <SearchIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
              <input
                ref={input}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={t("ابحث بكل شي…")}
                aria-label={t("ابحث بكل شي…")}
                aria-activedescendant={flat[active] ? `cmd-${flat[active].id}` : undefined}
                className="w-full bg-transparent py-3.5 text-sm outline-none"
                style={{ color: "var(--color-ink)" }}
                dir={fieldDir(query)}
              />
              <kbd className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }} dir="ltr">
                Esc
              </kbd>
            </div>

            <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox">
              {groups.map((group) => (
                <section key={group.title} className="mb-1">
                  <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-medium" style={{ color: "var(--color-ink-muted)" }}>
                    {group.title}
                  </h3>
                  {group.items.map((item) => {
                    index += 1;
                    const i = index;
                    const on = i === active;
                    return (
                      <button
                        key={item.id}
                        id={`cmd-${item.id}`}
                        data-index={i}
                        role="option"
                        aria-selected={on}
                        onMouseMove={() => active !== i && setActive(i)}
                        onClick={item.run}
                        className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-start"
                        style={{ background: on ? "color-mix(in oklch, var(--color-accent) 14%, transparent)" : undefined }}
                      >
                        <item.Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: on ? "var(--color-accent)" : "var(--color-ink-muted)" }} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-sm" dir="auto" style={{ color: "var(--color-ink)" }}>
                              {item.label}
                            </span>
                            {item.hint && (
                              <span className="shrink-0 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                                {item.hint}
                              </span>
                            )}
                          </span>
                          {item.snippet && (
                            <span className="mt-0.5 line-clamp-1 text-[12px]" dir="auto" style={{ color: "var(--color-ink-muted)" }}>
                              <Marked text={item.snippet.text} marks={item.snippet.marks} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))}
              {!flat.length && (
                <p className="px-3 py-8 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {t("ما لقيت شي.")}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}>
              <span>{t("↑↓ للتنقل · Enter للفتح · Esc للإغلاق")}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Ctrl+K (⌘K on a Mac) opens and closes it — by the K key, so any keyboard layout works. */
export function usePaletteShortcut(toggle: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyK") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}
