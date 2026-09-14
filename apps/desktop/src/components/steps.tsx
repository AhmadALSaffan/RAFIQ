import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Resolution, ToolCall } from "../lib/types";
import { easeOutExpo } from "../lib/motion";
import { toolLabel } from "../lib/tools";
import { AlertIcon, ShieldIcon, SpinnerIcon, TerminalIcon } from "./Icons";
import { Button, DrawnCheck } from "./ui";

const COLLAPSE_AT = 12;

export function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 1 && typeof entries[0][1] === "string") return String(entries[0][1]);
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
}

export function ToolTitle({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <TerminalIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-accent)" }} />
      <span className="font-medium" style={{ color: "var(--color-ink)" }}>
        {toolLabel(name)}
      </span>
      <span className="truncate font-mono" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
        {name}
      </span>
    </span>
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
  const lines = result?.output.split("\n") ?? [];
  const long = lines.length > COLLAPSE_AT;
  const [expanded, setExpanded] = useState(false);
  const shown = long && !expanded ? lines.slice(0, COLLAPSE_AT).join("\n") : result?.output;
  const state = !result ? "running" : result.ok ? "ok" : "fail";

  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }}>
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
            {state === "running" ? "عم ينفّذ" : state === "ok" ? "تم" : "ما نجح"}
          </motion.span>
        </AnimatePresence>
      </div>
      {args && Object.keys(args).length > 0 && (
        <pre className="whitespace-pre-wrap px-4 pb-2.5 font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
          {formatArgs(args)}
        </pre>
      )}
      <AnimatePresence initial={false}>
        {result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.3, ease: easeOutExpo }}
            className="border-t"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <pre
              className="max-h-96 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs"
              style={{ color: result.ok ? "var(--color-ink)" : "var(--color-danger)" }}
              dir="auto"
            >
              {shown}
            </pre>
            {long && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full border-t px-4 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
              >
                {expanded ? "إخفاء" : `عرض الكل (${lines.length} سطر)`}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ArgsPanel({ call }: { call: ToolCall }) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
      <div className="mb-1.5">
        <ToolTitle name={call.tool} />
      </div>
      <pre className="whitespace-pre-wrap font-mono text-xs" style={{ color: "var(--color-ink)" }} dir="ltr">
        {formatArgs(call.args)}
      </pre>
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
  onResolve: (resolution: "approved" | "denied") => void;
}) {
  const pending = resolution === "pending";
  return (
    <div
      className={`rounded-lg border-2 px-4 py-4 transition-[border-color] duration-300 ${pending ? "pending-ring" : ""}`}
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
        رفيق بدّه إذنك قبل ما يكمّل
      </div>
      <ArgsPanel call={call} />
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.div key="actions" exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }} className="mt-3 flex gap-2">
            <Button onClick={() => onResolve("approved")} className="px-3.5 py-1.5">
              سماح
            </Button>
            <Button variant="danger" onClick={() => onResolve("denied")} className="px-3.5 py-1.5">
              رفض
            </Button>
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
            {resolution === "approved" ? "سمحتله" : "رفضت"}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ThinkingDots({ label = "رفيق عم يفكّر…" }: { label?: string }) {
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
