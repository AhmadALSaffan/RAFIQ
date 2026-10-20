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
import { doing } from "../features/chat/WorkStatus";

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

/** The arguments in one line, keys sorted: "path: notes.md · query: payment". */
export function argsSubtitle(args: Record<string, unknown>): string {
  return Object.keys(args)
    .sort()
    .map((k) => {
      const v = args[k];
      const text = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${text.length > 48 ? `${text.slice(0, 47)}…` : text}`;
    })
    .join(" · ");
}

/** A tool's output, pretty-printed when it's JSON. */
export function prettyOutput(output: string): { text: string; json: boolean } {
  const trimmed = output.trim();
  if (!/^[[{]/.test(trimmed)) return { text: output, json: false };
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true };
  } catch {
    return { text: output, json: false };
  }
}

type ToolState = "running" | "ok" | "fail" | "interrupted";

/**
 * One tool step. While it runs, it says what it's doing in the present ("reading
 * notes.md…"); once done, what it did. A line of its arguments (keys sorted) under the
 * name, the full arguments a click away, and the output — pretty-printed when it's JSON —
 * sliding open when it lands. A step that never got an answer (the reply stopped) says
 * so. (The states follow 21st.dev's "MCP Tool" component, written for Rafiq.)
 */
export function ToolCard({
  tool,
  args,
  result,
  interrupted = false,
}: {
  tool: string;
  args?: Record<string, unknown>;
  result?: { ok: boolean; output: string };
  /** The reply ended without this call's result. */
  interrupted?: boolean;
}) {
  const state: ToolState = result ? (result.ok ? "ok" : "fail") : interrupted ? "interrupted" : "running";
  const [inputs, setInputs] = useState(false);
  const hasArgs = Boolean(args && Object.keys(args).length);
  const out = result ? prettyOutput(result.output) : null;
  const color = state === "ok" ? "var(--color-success)" : state === "fail" ? "var(--color-danger)" : state === "interrupted" ? "var(--color-pending)" : "var(--color-ink-muted)";

  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)" }}>
      <div className="flex items-start justify-between gap-2 px-4 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <TerminalIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={state === "running" ? "doing" : "done"}
                initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className={`truncate font-medium ${state === "running" ? "shimmer-text" : ""}`}
                style={state === "running" ? undefined : { color: "var(--color-ink)" }}
              >
                {state === "running" ? doing(tool, args ?? {}) : toolLabel(tool)}
              </motion.span>
            </AnimatePresence>
          </span>
          {hasArgs && (
            <span className="truncate ps-[22px] font-mono text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr" title={argsSubtitle(args!)}>
              {argsSubtitle(args!)}
            </span>
          )}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }}
            className="flex shrink-0 items-center gap-1 text-xs"
            style={{ color }}
          >
            {state === "running" && <SpinnerIcon className="h-3.5 w-3.5" />}
            {state === "ok" && <DrawnCheck className="h-3.5 w-3.5" />}
            {(state === "fail" || state === "interrupted") && <AlertIcon className="h-3.5 w-3.5" />}
            {state === "running" ? t("عم ينفّذ") : state === "ok" ? t("تم") : state === "fail" ? t("ما نجح") : t("انقطع")}
          </motion.span>
        </AnimatePresence>
      </div>
      {hasArgs && (
        <>
          <button
            type="button"
            onClick={() => setInputs((v) => !v)}
            aria-expanded={inputs}
            className="w-full border-t px-4 py-1 text-start text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          >
            {t("المدخلات")} {inputs ? "▴" : "▾"}
          </button>
          <AnimatePresence initial={false}>
            {inputs && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                <Clamped text={JSON.stringify(args, Object.keys(args!).sort(), 2)} maxRem={10} className="whitespace-pre-wrap break-words px-4 pb-2.5 font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr" />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      <AnimatePresence initial={false}>
        {result && out && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.3, ease: easeOutExpo }}
            className="border-t"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }}
          >
            {out.json && (
              <span className="block px-4 pt-2 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--color-ink-muted)" }}>
                json
              </span>
            )}
            <Clamped text={out.text} maxRem={8} className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs" style={{ color: result.ok ? "var(--color-ink)" : "var(--color-danger)" }} dir={out.json ? "ltr" : "auto"} />
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
