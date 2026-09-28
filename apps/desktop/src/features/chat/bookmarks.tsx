/**
 * Bookmarks: the messages worth coming back to, starred where they are and listed in the
 * chat header. Picking one scrolls the chat to it.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatMessage } from "../../lib/types";
import { StarIcon, XIcon } from "../../components/Icons";
import { easeOutExpo } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { t } from "../../i18n";

/** The start of a message on one line — a reply made only of tool calls is named by its text. */
export function excerptOf(message: Pick<ChatMessage, "content" | "parts">, limit = 140): string {
  let text = message.content ?? "";
  if (!text.trim()) {
    const part = message.parts?.find((p) => p.kind === "text");
    text = part && part.kind === "text" ? part.text : "";
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Starred messages first-starred first — the order they were worth keeping in. */
export function bookmarkedOf(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.bookmarked_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/** The star button used on both sides of the conversation. */
export function StarButton({ on, onToggle, className = "" }: { on: boolean; onToggle: () => void; className?: string }) {
  const label = on ? t("شيل العلامة") : t("علّم الرسالة");
  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={`rounded-md p-1 transition-colors hover:bg-[var(--color-surface-2)] ${className}`}
      style={{ color: on ? "var(--color-accent)" : "var(--color-ink-muted)" }}
    >
      <motion.span key={on ? "on" : "off"} initial={{ scale: on ? 0.4 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 18 }} className="block">
        <StarIcon className="h-3.5 w-3.5" filled={on} />
      </motion.span>
    </motion.button>
  );
}

/** Header chip: how many messages are starred, and the list of them. Hidden while none are. */
export function BookmarksMenu({
  messages,
  onJump,
  onRemove,
}: {
  messages: ChatMessage[];
  onJump: (messageId: string) => void;
  onRemove: (message: ChatMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const marks = bookmarkedOf(messages);

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

  useEffect(() => {
    if (!marks.length) setOpen(false);
  }, [marks.length]);

  return (
    <AnimatePresence initial={false}>
      {marks.length > 0 && (
        <motion.div
          ref={ref}
          className="relative"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.18, ease: easeOutExpo }}
        >
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs tabular-nums transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
            title={t("الرسائل المعلّمة")}
            aria-label={t("الرسائل المعلّمة")}
            aria-expanded={open}
          >
            <StarIcon className="h-3.5 w-3.5" filled style={{ color: "var(--color-accent)" }} />
            {marks.length}
          </motion.button>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
                transition={{ duration: 0.2, ease: easeOutExpo }}
                className="absolute end-0 top-full mt-2 flex max-h-96 w-80 origin-top flex-col overflow-y-auto rounded-xl border p-1.5 shadow-lg"
                style={{ zIndex: "var(--z-index-dropdown)" as unknown as number, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                role="menu"
              >
                <p className="px-2 pb-1 pt-1 text-[11px] font-medium" style={{ color: "var(--color-ink-muted)" }}>
                  {t("الرسائل المعلّمة")}
                </p>
                <AnimatePresence initial={false}>
                  {marks.map((m) => (
                    <motion.div
                      key={m.id}
                      layout="position"
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.16, ease: easeOutExpo }}
                      className="group relative"
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          onJump(m.id);
                        }}
                        className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 pe-8 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                      >
                        <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                          {m.role === "user" ? t("إنت") : t("رفيق")} · {timeAgo(m.created_at)}
                        </span>
                        <span className="line-clamp-2 text-xs leading-relaxed" dir="auto">
                          {excerptOf(m) || t("(بدون نص)")}
                        </span>
                      </button>
                      <button
                        onClick={() => onRemove(m)}
                        aria-label={t("شيل العلامة")}
                        title={t("شيل العلامة")}
                        className="absolute end-1.5 top-2 rounded p-1 opacity-0 transition-opacity hover:bg-[var(--color-surface)] focus-visible:opacity-100 group-hover:opacity-100"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
