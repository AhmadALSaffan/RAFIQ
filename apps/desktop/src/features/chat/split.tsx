/**
 * Chats side by side: the chat page can show up to four conversations at once — the one in
 * the address (with the list and the header) and up to three more beside it, each a full chat
 * of its own (the same embedded `ChatPage` the designs page uses). Which ones are open is
 * remembered, so they're still there next time.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatSummary } from "../../lib/types";
import { PlusIcon, SplitIcon } from "../../components/Icons";
import { easeOutExpo } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { TokenText } from "../../components/TokenText";
import { t } from "../../i18n";

/** The most conversations on screen at once, the main one included. */
export const MAX_CHATS = 4;
const KEY = "rafiq-chat-split";

/** One chat beside the main one. `id` is null until a new chat's first message creates it;
 *  `slot` stays the same through that, so the pane isn't rebuilt when it gets its id. */
export type Pane = { slot: string; id: string | null };

function load(): Pane[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is Pane => p && typeof p.slot === "string" && (typeof p.id === "string" || p.id === null))
      .filter((p) => p.id !== null)
      .slice(0, MAX_CHATS - 1);
  } catch {
    return [];
  }
}

function save(panes: Pane[]) {
  try {
    // A pane still waiting for its first message has nothing to come back to.
    localStorage.setItem(KEY, JSON.stringify(panes.filter((p) => p.id)));
  } catch {
    // convenience only
  }
}

export function newSlot(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The chats open beside the main one, and the ways to change them. Only the main chat page
 *  holds them (`enabled`); the chats inside the panes don't. */
export function useSplit(mainId: string | undefined, enabled: boolean) {
  const [panes, setPanes] = useState<Pane[]>(() => (enabled ? load() : []));
  useEffect(() => {
    if (enabled) save(panes);
  }, [panes, enabled]);

  // The chat that becomes the main one leaves its pane: the same chat isn't shown twice.
  useEffect(() => {
    if (mainId) setPanes((prev) => (prev.some((p) => p.id === mainId) ? prev.filter((p) => p.id !== mainId) : prev));
  }, [mainId]);

  const open = useCallback(
    (id: string | null) =>
      setPanes((prev) => {
        if (id && (id === mainId || prev.some((p) => p.id === id))) return prev;
        if (prev.length >= MAX_CHATS - 1) return prev;
        return [...prev, { slot: newSlot(), id }];
      }),
    [mainId],
  );
  const close = useCallback((slot: string) => setPanes((prev) => prev.filter((p) => p.slot !== slot)), []);
  const created = useCallback((slot: string, id: string) => setPanes((prev) => prev.map((p) => (p.slot === slot ? { ...p, id } : p))), []);
  // A chat deleted elsewhere closes its pane.
  const forget = useCallback((id: string) => setPanes((prev) => prev.filter((p) => p.id !== id)), []);

  return { panes, open, close, created, forget, full: panes.length >= MAX_CHATS - 1 };
}

/** Header button: open another chat beside this one — a new one, or one from the list. */
export function SplitMenu({
  chats,
  openIds,
  full,
  onOpen,
}: {
  chats: ChatSummary[];
  /** Already on screen: left out of the list. */
  openIds: (string | undefined | null)[];
  full: boolean;
  onOpen: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const recent = chats.filter((c) => !c.archived_at && !openIds.includes(c.id)).slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (id: string | null) => {
    setOpen(false);
    onOpen(id);
  };
  const label = full ? t("فاتح {0} محادثات، هاد الحد", { 0: MAX_CHATS }) : t("افتح محادثة جنبها");

  return (
    <div ref={ref} className="relative shrink-0">
      <motion.button
        type="button"
        whileTap={full ? undefined : { scale: 0.94 }}
        onClick={() => !full && setOpen((v) => !v)}
        disabled={full}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex items-center rounded-full p-1.5 transition-colors enabled:hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        style={{ color: open ? "var(--color-ink)" : "var(--color-ink-muted)", background: open ? "var(--color-surface)" : undefined }}
      >
        <SplitIcon className="h-4 w-4" />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
            className="absolute end-0 top-full mt-2 flex max-h-96 w-72 origin-top flex-col overflow-y-auto rounded-2xl border p-1.5 shadow-lg"
            style={{ zIndex: "var(--z-index-dropdown)" as unknown as number, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            role="menu"
          >
            <p className="px-2 pb-1 pt-1 text-[11px] font-medium" style={{ color: "var(--color-ink-muted)" }}>
              {t("افتح محادثة جنبها")}
            </p>
            <button
              role="menuitem"
              onClick={() => pick(null)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm transition-colors hover:bg-[var(--color-surface-2)]"
            >
              <PlusIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-accent)" }} />
              {t("محادثة جديدة")}
            </button>
            {recent.length > 0 && <div className="my-1 h-px" style={{ background: "var(--color-border)" }} />}
            {recent.map((c) => (
              <button
                key={c.id}
                role="menuitem"
                onClick={() => pick(c.id)}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <span className="w-full truncate text-sm" dir="auto">
                  <TokenText text={c.title} />
                </span>
                <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  {timeAgo(c.updated_at)}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
