import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  ChatIcon,
  HomeIcon,
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
  XIcon,
} from "./Icons";
import { CommandPalette, usePaletteShortcut } from "./CommandPalette";
import { useTheme } from "../lib/theme";
import { getSettings, listChats, listDesigns, listTasks } from "../lib/api";
import { closeTab, neighbourAfterClose, openTab, pruneTabs, tabFor, useTabs, type AppTab } from "../lib/tabs";
import { notify, syncBackground } from "../lib/background";
import { syncQuickAsk } from "../lib/quickAsk";
import type { TaskSummary } from "../lib/types";
import { easeOutExpo, snappy } from "../lib/motion";
import { ToastStack, type Toast } from "./Toasts";
import { Logo } from "./Logo";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

import { t } from "../i18n";
const navItems = [
  { to: "/", label: t("الرئيسية"), Icon: HomeIcon },
  { to: "/chat", label: t("المحادثات"), Icon: ChatIcon },
  { to: "/tasks", label: t("المهام"), Icon: TasksIcon },
  { to: "/designs", label: t("التصاميم"), Icon: SparkIcon },
  { to: "/work", label: t("شغلي"), Icon: InboxIcon },
  { to: "/models", label: t("النماذج"), Icon: ModelsIcon },
  { to: "/integrations", label: t("الربط"), Icon: LinkIcon },
];

/** The slim rail's width — also where the chat's slide-over list starts. */
export const RAIL = 60;
/** The top bar's height (tabs). */
export const TOPBAR = 44;

/** Titles for the open tabs, looked up from the lists (refreshed when tabs change). */
function useTabTitles(tabs: AppTab[]): Map<string, string> {
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const key = tabs.map((t) => t.path).join("|");
  useEffect(() => {
    if (!tabs.length) return;
    let alive = true;
    Promise.all([
      listChats(undefined, true).catch(() => null),
      listTasks().catch(() => null),
      listDesigns().catch(() => null),
    ]).then(([chats, tasks, designs]) => {
      if (!alive) return;
      const map = new Map<string, string>();
      chats?.forEach((c) => map.set(`/chat/${c.id}`, c.title));
      tasks?.forEach((x) => map.set(`/tasks/${x.id}`, x.title));
      designs?.forEach((d) => map.set(`/designs/${d.id}`, d.title));
      setTitles(map);
      // A tab whose chat/task/design was deleted goes away (only once its list loaded).
      pruneTabs((tab) => {
        const list = tab.kind === "chat" ? chats : tab.kind === "task" ? tasks : designs;
        return list === null || map.has(tab.path);
      });
    });
    return () => {
      alive = false;
    };
    // `key` stands for the tab list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return titles;
}

/** Polls the task list app-wide: drives the nav lamp/badge and raises toasts for tasks that
 *  need approval or just finished — tasks the chat starts run in the background, so the user
 *  might be anywhere when they need attention. */
function useTaskWatcher(currentPath: string, navigate: (to: string) => void) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const previous = useRef<Map<string, TaskSummary> | null>(null);
  const dismissed = useRef(new Set<string>());
  const pathRef = useRef(currentPath);
  pathRef.current = currentPath;

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let list: TaskSummary[];
      try {
        list = await listTasks();
      } catch {
        return;
      }
      if (!alive) return;
      setTasks(list);

      const before = previous.current;
      previous.current = new Map(list.map((t) => [t.id, t]));
      if (!before) return; // first load: don't toast history

      // Rafiq may be hidden in the tray: say it with a Windows notification too.
      for (const task of list) {
        const old = before.get(task.id);
        if (task.needs_approval && !old?.needs_approval) void notify(t("رفيق بدّه إذنك"), task.title);
        if (old && old.status !== task.status && (task.status === "completed" || task.status === "failed")) {
          void notify(task.status === "completed" ? t("خلصت مهمة") : t("مهمة ما نجحت"), task.title);
        }
      }

      setToasts((prev) => {
        let next = prev.filter((t) => {
          // Approval toasts disappear once the approval is handled (or the task is gone).
          if (t.tone !== "approval") return true;
          const task = list.find((x) => `approval-${x.id}` === t.id);
          return Boolean(task?.needs_approval);
        });
        for (const task of list) {
          const old = before.get(task.id);
          const onPage = pathRef.current === `/tasks/${task.id}`;
          const approvalId = `approval-${task.id}`;
          if (task.needs_approval && !onPage && !dismissed.current.has(approvalId) && !next.some((t) => t.id === approvalId)) {
            next = [...next, { id: approvalId, tone: "approval", title: t("رفيق بدّه إذنك"), body: task.title, actionLabel: t("افتح المهمة"), onAction: () => navigate(`/tasks/${task.id}`) }];
          }
          if (old && old.status !== task.status && !onPage && (task.status === "completed" || task.status === "failed")) {
            const id = `done-${task.id}`;
            next = [
              ...next.filter((t) => t.id !== id),
              {
                id,
                tone: task.status === "completed" ? "success" : "danger",
                title: task.status === "completed" ? t("خلصت مهمة") : t("مهمة ما نجحت"),
                body: task.title,
                actionLabel: t("عرض"),
                onAction: () => navigate(`/tasks/${task.id}`),
              },
            ];
            setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 6000);
          }
        }
        return next;
      });
    };
    check();
    const id = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [navigate]);

  const dismiss = (id: string) => {
    dismissed.current.add(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return {
    running: tasks.some((t) => t.status === "running" || t.status === "pending"),
    queued: tasks.filter((t) => t.status === "queued").length,
    approvals: tasks.filter((t) => t.needs_approval).length,
    toasts,
    dismiss,
  };
}

export function Shell() {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { running, queued, approvals, toasts, dismiss } = useTaskWatcher(location.pathname, navigate);

  // The tray, close-to-tray and the quick-ask shortcut follow the saved settings from the
  // first moment — the main window loads even when Rafiq starts hidden in the tray.
  useEffect(() => {
    getSettings()
      .then((s) => {
        void syncBackground(s.run_in_background ?? true);
        void syncQuickAsk(s.quick_ask_shortcut ?? null);
      })
      .catch(() => undefined);
  }, []);

  // "Open in Rafiq" from the quick-ask box lands here.
  useEffect(() => {
    let off: (() => void) | undefined;
    void (async () => {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return;
      const { listen } = await import("@tauri-apps/api/event");
      off = await listen<string>("rafiq://navigate", (event) => navigate(event.payload));
    })();
    return () => off?.();
  }, [navigate]);
  const section = "/" + (location.pathname.split("/")[1] ?? "");
  // Chat and the design workspace fill the window and scroll their own panes.
  const fullHeight = section === "/chat" || /^\/designs\/.+/.test(location.pathname);

  // Every chat, task or design the user opens gets a tab along the top.
  const tabs = useTabs();
  const titles = useTabTitles(tabs);
  useEffect(() => {
    const tab = tabFor(location.pathname);
    if (tab) openTab(tab);
  }, [location.pathname]);
  const activeTab = tabFor(location.pathname)?.path ?? null;
  function close(tab: AppTab) {
    if (tab.path === activeTab) navigate(neighbourAfterClose(tabs, tab.path));
    closeTab(tab.path);
  }

  // Ctrl+K from anywhere; any page change closes it.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  usePaletteShortcut(togglePalette);
  useEffect(() => setPaletteOpen(false), [location.pathname]);

  const railButton = "relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        {/* Tabs along the top, like a browser. */}
        <header className="flex h-11 shrink-0 items-center gap-1 border-b ps-3 pe-2" style={{ borderColor: "var(--color-border)" }}>
          <div className="relative isolate me-2 flex items-center gap-2">
            <motion.div initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ duration: 0.6, ease: easeOutExpo }}>
              <Logo className="h-6 w-6" />
            </motion.div>
            <AnimatePresence>
              {running && (
                <motion.span
                  key="glow"
                  className="pointer-events-none absolute start-0 top-0 h-6 w-6 rounded-md"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.55, 0, 0.55], scale: [1, 1.45, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  style={{ background: "var(--color-accent)", zIndex: -1 }}
                />
              )}
            </AnimatePresence>
            <span className="text-[15px] font-extrabold" style={{ fontFamily: "var(--font-display)" }}>
              {t("رفيق")}
            </span>
          </div>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label={t("التبويبات")} style={{ scrollbarWidth: "none" }}>
            <AnimatePresence initial={false}>
              {tabs.map((tab) => {
                const active = tab.path === activeTab;
                const title = titles.get(tab.path) ?? (tab.kind === "chat" ? t("محادثة") : tab.kind === "task" ? t("مهمة") : t("تصميم"));
                const Icon = tab.kind === "chat" ? ChatIcon : tab.kind === "task" ? TasksIcon : SparkIcon;
                return (
                  <motion.div
                    key={tab.path}
                    layout="position"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
                    transition={snappy}
                    className="group relative flex max-w-[200px] shrink-0 items-center rounded-lg"
                    onAuxClick={(e) => e.button === 1 && close(tab)}
                  >
                    {active && (
                      <motion.span layoutId="tab-active" className="absolute inset-0 rounded-lg" style={{ background: "var(--color-surface)" }} transition={snappy} />
                    )}
                    <button
                      onClick={() => navigate(tab.path)}
                      className="relative flex min-w-0 items-center gap-1.5 py-1.5 ps-2.5 pe-1 text-xs"
                      style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)", fontWeight: active ? 500 : 400 }}
                      title={title}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate" dir="auto">
                        {title}
                      </span>
                    </button>
                    <button
                      onClick={() => close(tab)}
                      aria-label={t("سكّر التبويب")}
                      title={t("سكّر التبويب")}
                      className={`relative me-1 rounded p-0.5 transition-opacity hover:bg-[var(--color-surface-2)] ${active ? "opacity-70" : "opacity-0 group-hover:opacity-70 focus-visible:opacity-70"}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <button
              onClick={() => navigate("/chat")}
              aria-label={t("محادثة جديدة")}
              title={t("محادثة جديدة")}
              className="shrink-0 rounded-full p-1.5 transition-colors hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </nav>

          <button
            onClick={() => setPaletteOpen(true)}
            aria-label={t("ابحث بكل شي")}
            className="flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface)]"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <SearchIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("ابحث بكل شي")}</span>
            <kbd className="num rounded border px-1 text-[10px]" style={{ borderColor: "var(--color-border)" }} dir="ltr">
              Ctrl K
            </kbd>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* The slim rail: pages, the workspace, and the few things always at hand. */}
          <nav className="flex shrink-0 flex-col items-center gap-1 border-e py-3" style={{ width: RAIL, borderColor: "var(--color-border)" }} aria-label={t("الصفحات")}>
            <div className="w-10">
              <WorkspaceSwitcher collapsed />
            </div>
            {navItems.map(({ to, label, Icon }) => {
              const active = to === "/" ? location.pathname === "/" : section === to;
              return (
                <NavLink key={to} to={to} className={railButton} style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }} title={label} aria-label={label}>
                  {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl" style={{ background: "var(--color-surface)" }} transition={snappy} />}
                  <Icon className="relative h-5 w-5" />
                  {to === "/tasks" && (
                    <AnimatePresence>
                      {queued > 0 && (
                        <motion.span
                          key="queued"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={snappy}
                          className="num absolute -top-0.5 -end-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-medium"
                          style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}
                          title={t("{0} بالدور", { 0: queued })}
                        >
                          {queued}
                        </motion.span>
                      )}
                      {(running || approvals > 0) && (
                        <motion.span
                          key="lamp"
                          className="absolute bottom-1 h-1.5 w-1.5 rounded-full"
                          style={{ background: approvals > 0 ? "var(--color-pending)" : "var(--color-accent)" }}
                          initial={{ scale: 0 }}
                          animate={{ scale: approvals > 0 ? [1, 1.7, 1] : [1, 1.35, 1] }}
                          exit={{ scale: 0 }}
                          transition={{ duration: approvals > 0 ? 0.9 : 1.6, repeat: Infinity, ease: "easeInOut" }}
                          title={approvals > 0 ? t("في مهمة بدها إذنك") : t("في مهمة شغّالة")}
                        />
                      )}
                    </AnimatePresence>
                  )}
                </NavLink>
              );
            })}

            <div className="mt-auto flex flex-col items-center gap-1">
              <motion.button
                onClick={toggle}
                whileTap={{ scale: 0.92 }}
                className={`${railButton} hover:bg-[var(--color-surface)]`}
                style={{ color: "var(--color-ink-muted)" }}
                title={theme === "dark" ? t("وضع فاتح") : t("وضع غامق")}
                aria-label={theme === "dark" ? t("وضع فاتح") : t("وضع غامق")}
              >
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={theme}
                    initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                    animate={{ rotate: 0, opacity: 1, scale: 1 }}
                    exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.22, ease: easeOutExpo }}
                  >
                    {theme === "dark" ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
              {[
                { to: "/settings", label: t("الإعدادات"), Icon: SettingsIcon },
                { to: "/about", label: t("من نحن"), Icon: InfoIcon },
              ].map(({ to, label, Icon }) => {
                const active = section === to;
                return (
                  <NavLink key={to} to={to} className={railButton} style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }} title={label} aria-label={label}>
                    {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl" style={{ background: "var(--color-surface)" }} transition={snappy} />}
                    <Icon className="relative h-5 w-5" />
                  </NavLink>
                );
              })}
            </div>
          </nav>

          <main className={`min-w-0 flex-1 ${fullHeight ? "overflow-hidden" : "overflow-y-auto"}`}>
            <motion.div
              // Chat keeps one instance across /chat → /chat/:id so a reply streaming into a
              // just-created conversation isn't torn down by the route change.
              key={section === "/chat" ? section : location.pathname}
              className={fullHeight ? "h-full" : undefined}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: easeOutExpo }}
            >
              <Outlet />
            </motion.div>
          </main>
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <CommandPalette open={paletteOpen} onClose={closePalette} theme={theme} onToggleTheme={toggle} />
    </MotionConfig>
  );
}
