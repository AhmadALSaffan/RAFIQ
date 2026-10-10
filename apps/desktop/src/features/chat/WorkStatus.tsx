/**
 * One line under a reply that's still being made, saying what the model is doing right now
 * — reading a file, running a command, writing the answer — and for how long. While it only
 * thinks, the wording moves on every few seconds so a long think never looks frozen.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { t } from "../../i18n";
import { toolLabel } from "../../lib/tools";
import type { ChatPart } from "../../lib/types";

const THINKING = [
  t("عم يفكّر…"),
  t("عم يحلّل طلبك…"),
  t("عم يرتّب أفكاره…"),
  t("عم يخطّط للخطوة الجاية…"),
  t("عم يدقّق بالتفاصيل…"),
  t("عم يربط الخيوط ببعض…"),
];

const shortPath = (value: unknown) => (typeof value === "string" ? value.replace(/\\/g, "/").split("/").pop() || value : "");
const shortCommand = (value: unknown) => (typeof value === "string" ? (value.length > 48 ? `${value.slice(0, 48)}…` : value) : "");

/** What a running tool is doing, in a few words. */
export function doing(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "filesystem_read":
      return t("عم يقرأ {0}…", { 0: shortPath(args.path) });
    case "filesystem_write":
      return t("عم يكتب {0}…", { 0: shortPath(args.path) });
    case "filesystem_list":
      return t("عم يتفرّج على الملفات…");
    case "filesystem_delete":
      return t("عم يحذف {0}…", { 0: shortPath(args.path) });
    case "shell_run":
      return t("عم يشغّل: {0}", { 0: shortCommand(args.command) });
    case "web_search":
      return t("عم يدوّر على الإنترنت…");
    case "web_fetch":
      return t("عم يقرأ صفحة من الإنترنت…");
    case "wait_for_tasks":
      return t("ناطر المهام تخلص…");
    default:
      if (tool.startsWith("browser_")) return t("عم يستعمل المتصفح…");
      if (tool.startsWith("desktop_")) return t("عم يستعمل الشاشة…");
      return t("عم يستعمل «{0}»…", { 0: toolLabel(tool) });
  }
}

/** The line for the latest state of a reply in progress. */
export function statusOf(parts: ChatPart[]): { kind: "tool" | "permission" | "writing" | "thinking"; text?: string } {
  const pending = parts.find((p) => p.kind === "permission" && p.resolution === "pending");
  if (pending) return { kind: "permission", text: t("ناطر موافقتك…") };
  const running = [...parts].reverse().find((p) => p.kind === "tool" && p.ok === undefined);
  if (running && running.kind === "tool") return { kind: "tool", text: doing(running.tool, running.args ?? {}) };
  if (parts[parts.length - 1]?.kind === "text") return { kind: "writing", text: t("عم يكتب الرد…") };
  return { kind: "thinking" };
}

function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}

export function WorkStatus({ parts }: { parts: ChatPart[] }) {
  const started = useRef(Date.now());
  const now = useNow(1000);
  const seconds = Math.max(0, Math.floor((now - started.current) / 1000));
  const status = statusOf(parts);
  const text = status.text ?? THINKING[Math.floor(seconds / 3) % THINKING.length];
  const elapsed = seconds < 60 ? t("{0} ث", { 0: seconds }) : t("{0} د {1} ث", { 0: Math.floor(seconds / 60), 1: seconds % 60 });

  return (
    <div className="flex items-center gap-2.5 py-1 text-sm" style={{ color: "var(--color-ink-muted)" }} role="status" aria-live="polite">
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-accent)" }}
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
          />
        ))}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="min-w-0 truncate"
          dir="auto"
        >
          {text}
        </motion.span>
      </AnimatePresence>
      <span className="num shrink-0 text-xs" aria-hidden="true">
        · {elapsed}
      </span>
    </div>
  );
}
