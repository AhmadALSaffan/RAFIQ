/**
 * One line under a reply that's still being made, saying what the model is doing right now
 * — reading a file, running a command, writing the answer — and for how long. While it only
 * thinks, the wording moves on every few seconds so a long think never looks frozen.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShimmerText, TextSwap } from "../../components/LiveText";
import { WorkOrb } from "../../components/Orb";
import { NumberFlow } from "../../components/MotionKit";
import { BoltIcon, CheckCircleIcon, FileIcon, GlobeIcon, PencilIcon, ShieldIcon, TasksIcon, TerminalIcon, WandIcon } from "../../components/Icons";
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
const firstLine = (value: unknown) => (typeof value === "string" ? value.trim().split("\n")[0] : "");
const shortCommand = (value: unknown) => (typeof value === "string" ? (value.length > 48 ? `${value.slice(0, 48)}…` : value) : "");

/** What a running tool is doing, in a few words. */
export function doing(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "filesystem_read":
      return t("عم يقرأ {0}…", { 0: shortPath(args.path) });
    case "filesystem_write":
      return t("عم يكتب {0}…", { 0: shortPath(args.path) });
    case "filesystem_edit":
      return t("عم يعدّل {0}…", { 0: shortPath(args.path) });
    case "word_write":
      return t("عم يكتب مستند Word: {0}…", { 0: shortPath(args.path) });
    case "slides_write":
      return t("عم يعمل عرض PowerPoint: {0}…", { 0: shortPath(args.path) });
    case "excel_read":
      return t("عم يقرأ الجدول {0}…", { 0: shortPath(args.path) });
    case "excel_write":
      return t("عم يكتب جدول Excel: {0}…", { 0: shortPath(args.path) });
    case "image_view":
      return t("عم يتفرّج على {0}…", { 0: shortPath(args.path) });
    case "notes_list":
      return t("عم يدوّر بملاحظاتك…");
    case "find_files":
      return t("عم يدوّر بملفاتك…");
    case "note_read":
      return t("عم يقرأ ملاحظتك {0}…", { 0: shortPath(args.path) });
    case "note_create":
      return t("عم يكتب ملاحظة: {0}…", { 0: shortCommand(args.title) });
    case "note_edit":
      return t("عم يعدّل ملاحظتك {0}…", { 0: shortPath(args.path) });
    case "filesystem_list":
      return t("عم يتفرّج على الملفات…");
    case "filesystem_delete":
      return t("عم يحذف {0}…", { 0: shortPath(args.path) });
    case "shell_run":
      return t("عم يشغّل: {0}", { 0: shortCommand(args.command ?? firstLine(args.script)) });
    case "web_search":
      return t("عم يدوّر على الإنترنت…");
    case "web_fetch":
      return t("عم يقرأ صفحة من الإنترنت…");
    case "wait_for_tasks":
      return t("ناطر المهام تخلص…");
    case "design_start":
      return t("عم يفتح جلسة تصميم…");
    case "motion_start":
      return t("عم يفتح مشروع موشن…");
    case "design_review":
      return t("عم يراجع التصميم قسم قسم…");
    case "design_slop_check":
      return t("عم يفحص علامات التصميم الآلي…");
    case "motion_review":
      return t("عم يراجع الريل لقطة لقطة…");
    case "issue_read":
      return t("عم يقرأ {0}…", { 0: String(args.key ?? "") });
    case "issue_search":
    case "issue_list":
      return t("عم يدوّر بالمهام…");
    case "issue_create":
      return t("عم ينشئ مهمة…");
    case "issue_split":
      return t("عم يقسّم {0}…", { 0: String(args.key ?? "") });
    case "issue_comment":
      return t("عم يعلّق على {0}…", { 0: String(args.key ?? "") });
    case "schedule_create":
      return t("عم يجدول مهمة…");
    case "notify_post":
      return t("عم يبعت لقناة الفريق…");
    default:
      if (tool.startsWith("browser_")) return t("عم يستعمل المتصفح…");
      if (tool.startsWith("desktop_")) return t("عم يستعمل الشاشة…");
      return t("عم يستعمل «{0}»…", { 0: toolLabel(tool) });
  }
}

type Phase = "read" | "write" | "run" | "web" | "design" | "issue" | "tool";

/** What kind of work a tool is, for the icon beside the status. */
export function phaseOf(tool: string): Phase {
  if (/^(filesystem_(read|list)|excel_read|image_view|notes_list|note_read)$/.test(tool)) return "read";
  if (/^(filesystem_(write|edit|delete)|word_write|slides_write|excel_write|note_(create|edit))$/.test(tool)) return "write";
  if (tool === "shell_run") return "run";
  if (tool.startsWith("web_") || tool.startsWith("browser_")) return "web";
  if (tool.startsWith("design_") || tool.startsWith("motion_")) return "design";
  if (tool.startsWith("issue_") || tool.startsWith("schedule_") || tool === "wait_for_tasks") return "issue";
  return "tool";
}

const PHASE_ICON = { read: FileIcon, write: PencilIcon, run: TerminalIcon, web: GlobeIcon, design: WandIcon, issue: TasksIcon, tool: BoltIcon };

/** The line for the latest state of a reply in progress. */
export function statusOf(parts: ChatPart[]): { kind: "tool" | "permission" | "writing" | "thinking"; text?: string; phase?: Phase } {
  const pending = parts.find((p) => p.kind === "permission" && p.resolution === "pending");
  if (pending) return { kind: "permission", text: t("ناطر موافقتك…") };
  const running = [...parts].reverse().find((p) => p.kind === "tool" && p.ok === undefined);
  if (running && running.kind === "tool") return { kind: "tool", text: doing(running.tool, running.args ?? {}), phase: phaseOf(running.tool) };
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
  const steps = parts.filter((p) => p.kind === "tool" && p.ok !== undefined).length;
  // The icon follows the kind of work, so a glance says reading / writing / running.
  const icon = status.kind === "permission" ? "permission" : status.phase ?? "orb";
  const Icon = icon === "permission" ? ShieldIcon : icon === "orb" ? null : PHASE_ICON[icon];
  const elapsed = seconds < 60 ? t("{0} ث", { 0: seconds }) : t("{0} د {1} ث", { 0: Math.floor(seconds / 60), 1: seconds % 60 });

  return (
    <div
      className="flex max-w-full items-center gap-2 self-start rounded-full py-1.5 pe-3 ps-2.5 text-[13px]"
      // contain: paint — the orb's glow would otherwise count toward the chat's scroll
      // height, and following the bottom would chase it every turn.
      style={{ background: "var(--color-surface)", color: "var(--color-ink-muted)", contain: "paint" }}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={icon}
            className="flex"
            initial={{ opacity: 0, scale: 0.4, rotate: -30 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.12 } }}
            transition={{ type: "spring", visualDuration: 0.35, bounce: 0.35 }}
            style={{ color: icon === "permission" ? "var(--color-pending)" : "var(--color-accent)" }}
          >
            {Icon ? <Icon className="h-4 w-4" /> : <WorkOrb size={16} />}
          </motion.span>
        </AnimatePresence>
      </span>
      <TextSwap text={text} className="min-w-0">
        <ShimmerText>{text}</ShimmerText>
      </TextSwap>
      {steps > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs opacity-70" title={t("{0} خطوة خلصت", { 0: steps })}>
          <CheckCircleIcon className="h-3 w-3" />
          <NumberFlow value={steps} />
        </span>
      )}
      <span className="num shrink-0 text-xs opacity-70" aria-hidden="true">
        {elapsed}
      </span>
    </div>
  );
}
