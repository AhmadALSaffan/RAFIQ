/**
 * One line under a reply that's still being made, saying what the model is doing right now
 * — reading a file, running a command, writing the answer — and for how long. While it only
 * thinks, the wording moves on every few seconds so a long think never looks frozen.
 */

import { useEffect, useRef, useState } from "react";
import { RaySpinner, ShimmerText, TextSwap } from "../../components/LiveText";
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
    <div
      className="flex max-w-full items-center gap-2 self-start rounded-full py-1.5 pe-3 ps-2.5 text-[13px]"
      // contain: paint — the turning spinner's rotated box would otherwise count toward the
      // chat's scroll height, and following the bottom would chase it every turn.
      style={{ background: "var(--color-surface)", color: "var(--color-ink-muted)", contain: "paint" }}
      role="status"
      aria-live="polite"
    >
      <span className="flex h-3.5 w-3.5 shrink-0 overflow-hidden" style={{ color: "var(--color-accent)" }}>
        <RaySpinner size={14} />
      </span>
      <TextSwap text={text} className="min-w-0">
        <ShimmerText>{text}</ShimmerText>
      </TextSwap>
      <span className="num shrink-0 text-xs opacity-70" aria-hidden="true">
        {elapsed}
      </span>
    </div>
  );
}
