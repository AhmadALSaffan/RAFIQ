import { useLayoutEffect, useRef, useState } from "react";
import { DiffView } from "./DiffView";
import { AnimatePresence, motion } from "motion/react";
import type { Resolution, ToolCall } from "../lib/types";
import { easeOutExpo } from "../lib/motion";
import { toolLabel } from "../lib/tools";
import { AlertIcon, ShieldIcon, SpinnerIcon, TerminalIcon } from "./Icons";
import { Button, DrawnCheck } from "./ui";

import { t } from "../i18n";
import { canAlwaysAllow, permissionLabelOf, type PermissionAnswer } from "../lib/permissions";

export function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 1 && typeof entries[0][1] === "string") return String(entries[0][1]);
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
}

export function ToolTitle({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <TerminalIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
      <span className="font-medium" style={{ color: "var(--color-ink)" }}>
        {toolLabel(name)}
      </span>
      <span className="truncate font-mono" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
        {name}
      </span>
    </span>
  );
}

/**
 * Text that may be long (a whole scene as JSON, a file, a command's output), kept to a
 * few lines until asked. Clamped by height, not by line count: one line of JSON can wrap
 * into dozens. Without it a single tool card could add a thousand pixels to the chat at
 * once, and the conversation would lurch down as it followed.
 */
function Clamped({ text, maxRem, className, style, dir }: { text: string; maxRem: number; className: string; style: React.CSSProperties; dir: "ltr" | "auto" }) {
  const ref = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  return (
    <>
      <pre
        ref={ref}
        className={`${className} ${open ? "max-h-[32rem] overflow-auto" : "overflow-hidden"}`}
        style={{
          ...style,
          maxHeight: open ? undefined : `${maxRem}rem`,
          maskImage: !open && overflows ? "linear-gradient(to bottom, black 60%, transparent)" : undefined,
        }}
        dir={dir}
      >
        {text}
      </pre>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full border-t px-4 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
        >
          {open ? t("إخفاء") : t("عرض الكل ({0} سطر)", { 0: text.split("\n").length })}
        </button>
      )}
    </>
  );
}

/** One tool step: what was called, then its output sliding open when it lands. */
export function ToolCard({
  tool,
  args,
  result,
}: {
  tool: string;
  args?: Record<string, unknown>;
  result?: { ok: boolean; output: string };
}) {
  const state = !result ? "running" : result.ok ? "ok" : "fail";

  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)" }}>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <ToolTitle name={tool} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }}
            className="flex shrink-0 items-center gap-1 text-xs"
            style={{ color: state === "ok" ? "var(--color-success)" : state === "fail" ? "var(--color-danger)" : "var(--color-ink-muted)" }}
          >
            {state === "running" && <SpinnerIcon className="h-3.5 w-3.5" />}
            {state === "ok" && <DrawnCheck className="h-3.5 w-3.5" />}
            {state === "fail" && <AlertIcon className="h-3.5 w-3.5" />}
            {state === "running" ? t("عم ينفّذ") : state === "ok" ? t("تم") : t("ما نجح")}
          </motion.span>
        </AnimatePresence>
      </div>
      {args && Object.keys(args).length > 0 && (
        <Clamped text={formatArgs(args)} maxRem={4.5} className="whitespace-pre-wrap break-words px-4 pb-2.5 font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr" />
      )}
      <AnimatePresence initial={false}>
        {result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.3, ease: easeOutExpo }}
            className="border-t"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }}
          >
            <Clamped text={result.output} maxRem={8} className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs" style={{ color: result.ok ? "var(--color-ink)" : "var(--color-danger)" }} dir="auto" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ArgsPanel({ call }: { call: ToolCall }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: "var(--color-surface-2)" }}>
      <div className="mb-1.5">
        <ToolTitle name={call.tool} />
      </div>
      <Clamped text={formatArgs(call.args)} maxRem={14} className="whitespace-pre-wrap break-words font-mono text-xs" style={{ color: "var(--color-ink)" }} dir="ltr" />
    </div>
  );
}

/** A write shown as what it changes — the diff — rather than the whole new file. */
function PreviewPanel({ call }: { call: ToolCall }) {
  const path = typeof call.args.path === "string" ? call.args.path : "";
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: "var(--color-surface-2)" }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <ToolTitle name={call.tool} />
        {path && (
          <code className="truncate font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
            {path}
          </code>
        )}
      </div>
      <p className="mb-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("شو رح يتغيّر:")}
      </p>
      <DiffView diff={call.preview ?? ""} maxHeight="20rem" />
    </div>
  );
}

/** The approve/deny card — radiates until answered, then settles into its verdict. */
export function PermissionCard({
  call,
  resolution,
  onResolve,
}: {
  call: ToolCall;
  resolution: Resolution;
  onResolve: (resolution: PermissionAnswer) => void;
}) {
  const pending = resolution === "pending";
  const group = permissionLabelOf(call.tool);
  return (
    <div
      className={`rounded-2xl border-2 px-4 py-4 transition-[border-color] duration-300 ${pending ? "pending-ring" : ""}`}
      style={{ background: "var(--color-surface)", borderColor: pending ? "var(--color-pending)" : "var(--color-border)" }}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <motion.span
          animate={pending ? { rotate: [0, -12, 12, -8, 0] } : { rotate: 0 }}
          transition={pending ? { duration: 0.6, repeat: Infinity, repeatDelay: 2.4 } : { duration: 0.2 }}
          className="inline-flex"
        >
          <ShieldIcon className="h-4 w-4" style={{ color: "var(--color-pending)" }} />
        </motion.span>
        {t("رفيق بدّه إذنك قبل ما يكمّل")}
      </div>
      {call.preview ? <PreviewPanel call={call} /> : <ArgsPanel call={call} />}
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.div key="actions" exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }} className="mt-3 flex gap-2">
            <Button variant="accent" onClick={() => onResolve("approved")} className="px-3.5 py-1.5">
              {t("سماح")}
            </Button>
            <Button variant="danger" onClick={() => onResolve("denied")} className="px-3.5 py-1.5">
              {t("رفض")}
            </Button>
            {canAlwaysAllow(call.tool) && (
              <Button
                variant="ghost"
                onClick={() => onResolve("always")}
                className="ms-auto px-3 py-1.5 text-xs"
                title={t("«{0}» بتصير بدون سؤال — فيك ترجّعها من الإعدادات ← السماحيات", { 0: group })}
              >
                {t("اسمح دايماً لـ «{0}»", { 0: group })}
              </Button>
            )}
          </motion.div>
        ) : (
          <motion.p
            key="resolved"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center gap-1.5 text-xs font-medium"
            style={{ color: resolution === "approved" ? "var(--color-success)" : "var(--color-danger)" }}
          >
            {resolution === "approved" ? <DrawnCheck className="h-3.5 w-3.5" /> : <AlertIcon className="h-3.5 w-3.5" />}
            {resolution === "approved" ? t("سمحتله") : t("رفضت")}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ThinkingDots({ label = t("رفيق عم يفكّر…") }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-sm" style={{ color: "var(--color-ink-muted)" }} role="status">
      <span className="flex items-center gap-1">
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
      {label}
    </div>
  );
}
