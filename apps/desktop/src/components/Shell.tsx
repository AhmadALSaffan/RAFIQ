import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  ChatIcon,
  CollapseIcon,
  InboxIcon,
  InfoIcon,
  LinkIcon,
  ModelsIcon,
  MoonIcon,
  SettingsIcon,
  SparkIcon,
  SunIcon,
  TasksIcon,
} from "./Icons";
import { DEFAULT_LAYOUT, NAV_COLLAPSED, NAV_MAX, NAV_MIN, setLayout, useLayout } from "../lib/layout";
import { Resizer } from "./Resizer";
import { useTheme } from "../lib/theme";
import { listTasks } from "../lib/api";
import type { TaskSummary } from "../lib/types";
import { easeOutExpo, snappy } from "../lib/motion";
import { ToastStack, type Toast } from "./Toasts";
import { Logo } from "./Logo";

const navItems = [
  { to: "/chat", label: "المحادثات", Icon: ChatIcon },
  { to: "/work", label: "شغلي", Icon: InboxIcon },
  { to: "/designs", label: "التصاميم", Icon: SparkIcon },
  { to: "/tasks", label: "المهام", Icon: TasksIcon },
  { to: "/models", label: "النماذج", Icon: ModelsIcon },
  { to: "/integrations", label: "الربط", Icon: LinkIcon },
  { to: "/settings", label: "الإعدادات", Icon: SettingsIcon },
  { to: "/about", label: "من نحن", Icon: InfoIcon },
];

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
            next = [...next, { id: approvalId, tone: "approval", title: "رفيق بدّه إذنك", body: task.title, actionLabel: "افتح المهمة", onAction: () => navigate(`/tasks/${task.id}`) }];
          }
          if (old && old.status !== task.status && !onPage && (task.status === "completed" || task.status === "failed")) {
            const id = `done-${task.id}`;
            next = [
              ...next.filter((t) => t.id !== id),
              {
                id,
                tone: task.status === "completed" ? "success" : "danger",
                title: task.status === "completed" ? "خلصت مهمة" : "مهمة ما نجحت",
                body: task.title,
                actionLabel: "عرض",
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
  const section = "/" + (location.pathname.split("/")[1] ?? "");
  // Chat and the design workspace fill the window and scroll their own panes.
  const fullHeight = section === "/chat" || /^\/designs\/.+/.test(location.pathname);
  const layout = useLayout();
  const collapsed = layout.navCollapsed;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full">
        <motion.nav
          layout
          transition={snappy}
          className="flex shrink-0 flex-col border-e px-3 py-4"
          style={{
            width: collapsed ? NAV_COLLAPSED : layout.nav,
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <div className={`mb-6 flex items-center gap-2 ${collapsed ? "justify-center px-0" : "px-2"}`}>
            <div className="relative isolate">
              <motion.div
                initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ duration: 0.6, ease: easeOutExpo }}
              >
                <Logo className="h-8 w-8" />
              </motion.div>
              <AnimatePresence>
                {running && (
                  <motion.span
                    key="glow"
                    className="pointer-events-none absolute inset-0 rounded-lg"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.55, 0, 0.55], scale: [1, 1.45, 1] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    style={{ background: "var(--color-accent)", zIndex: -1 }}
                  />
                )}
              </AnimatePresence>
            </div>
            {!collapsed && <span className="truncate text-base font-semibold">رفيق</span>}
            {!collapsed && (
              <button
                onClick={() => setLayout({ navCollapsed: true })}
                title="اطوِ الشريط الجانبي"
                aria-label="اطوِ الشريط الجانبي"
                className="ms-auto rounded-lg p-1 transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <CollapseIcon className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-1">
            {navItems.map(({ to, label, Icon }) => {
              const active = section === to;
              return (
                <NavLink
                  key={to}
                  to={to}
                  className={`relative flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors ${collapsed ? "justify-center px-2" : "px-3"}`}
                  style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }}
                  title={collapsed ? label : undefined}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-lg"
                      style={{ background: "var(--color-surface-2)" }}
                      transition={snappy}
                    />
                  )}
                  <Icon className="relative h-5 w-5 shrink-0" />
                  {!collapsed && <span className={`relative truncate ${active ? "font-medium" : ""}`}>{label}</span>}
                  {to === "/tasks" && (
                    <span className="relative ms-auto flex items-center gap-1.5">
                      <AnimatePresence>
                        {queued > 0 && (
                          <motion.span
                            key="queued"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={snappy}
                            className="rounded-full px-1.5 text-[11px] font-medium tabular-nums"
                            style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}
                            title={`${queued} بالدور`}
                          >
                            <AnimatePresence mode="popLayout" initial={false}>
                              <motion.span key={queued} className="inline-block" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}>
                                {queued}
                              </motion.span>
                            </AnimatePresence>
                          </motion.span>
                        )}
                        {(running || approvals > 0) && (
                          <motion.span
                            key="lamp"
                            className="h-2 w-2 rounded-full"
                            style={{ background: approvals > 0 ? "var(--color-pending)" : "var(--color-accent)" }}
                            initial={{ scale: 0 }}
                            animate={{ scale: approvals > 0 ? [1, 1.7, 1] : [1, 1.35, 1] }}
                            exit={{ scale: 0 }}
                            transition={{ duration: approvals > 0 ? 0.9 : 1.6, repeat: Infinity, ease: "easeInOut" }}
                            title={approvals > 0 ? "في مهمة بدها إذنك" : "في مهمة شغّالة"}
                          />
                        )}
                      </AnimatePresence>
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>

          {collapsed && (
            <button
              onClick={() => setLayout({ navCollapsed: false })}
              title="وسّع الشريط الجانبي"
              aria-label="وسّع الشريط الجانبي"
              className="mb-1 flex justify-center rounded-lg p-2 transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <CollapseIcon className="h-4 w-4 rotate-180" />
            </button>
          )}

          <motion.button
            onClick={toggle}
            whileTap={{ scale: 0.96 }}
            className={`flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors hover:bg-[var(--color-surface-2)] ${collapsed ? "justify-center px-2" : "px-3"}`}
            style={{ color: "var(--color-ink-muted)" }}
            title={theme === "dark" ? "وضع فاتح" : "وضع غامق"}
          >
            <span className="relative h-5 w-5 shrink-0">
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={theme}
                  className="absolute inset-0"
                  initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.22, ease: easeOutExpo }}
                >
                  {theme === "dark" ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
                </motion.span>
              </AnimatePresence>
            </span>
            {!collapsed && (theme === "dark" ? "وضع فاتح" : "وضع غامق")}
          </motion.button>
        </motion.nav>

        {!collapsed && (
          <Resizer
            value={layout.nav}
            min={NAV_MIN}
            max={NAV_MAX}
            onChange={(nav) => setLayout({ nav })}
            onDoubleClick={() => setLayout({ nav: DEFAULT_LAYOUT.nav })}
            label="عرض الشريط الجانبي"
          />
        )}

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
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </MotionConfig>
  );
}
