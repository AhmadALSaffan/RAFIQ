/**
 * What the model did, beside the conversation: the files it wrote (opened right here — a
 * web page runs, a picture shows, code reads with line numbers) and the commands it ran,
 * like a terminal. Opens by itself the first time either happens in a chat.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { t } from "../../i18n";
import { previewFile, rawFileUrl, type FilePreview } from "../../lib/api";
import { revealPath } from "../../lib/folders";
import { roving } from "../../lib/keyboard";
import { easeOutExpo } from "../../lib/motion";
import type { ChatPart } from "../../lib/types";
import { Markdown } from "../../components/Markdown";
import { AlertIcon, CopyIcon, FileIcon, FolderIcon, RefreshIcon, SpinnerIcon, TerminalIcon, XIcon } from "../../components/Icons";
import { DrawnCheck } from "../../components/ui";

export type ActivityState = "running" | "ok" | "fail";
export interface FileActivity {
  id: string;
  path: string;
  state: ActivityState;
}
export interface CommandActivity {
  id: string;
  command: string;
  state: ActivityState;
  output: string;
}
export interface Activity {
  files: FileActivity[];
  commands: CommandActivity[];
}
export type ActivityTab = "files" | "commands";

const WRITES = new Set(["filesystem_write"]);
const RUNS = new Set(["shell_run"]);

const stateOf = (ok: boolean | undefined): ActivityState => (ok === undefined ? "running" : ok ? "ok" : "fail");

/** The files written (newest first, one entry per path) and commands run (in order). */
export function collectActivity(parts: ChatPart[]): Activity {
  const files = new Map<string, FileActivity>();
  const commands: CommandActivity[] = [];
  for (const part of parts) {
    if (part.kind !== "tool") continue;
    if (WRITES.has(part.tool) && typeof part.args?.path === "string") {
      const path = part.args.path.replace(/\\/g, "/").replace(/^\.\//, "");
      files.delete(path); // a rewrite moves it back to the top
      files.set(path, { id: part.id, path, state: stateOf(part.ok) });
    } else if (RUNS.has(part.tool) && typeof part.args?.command === "string") {
      commands.push({ id: part.id, command: part.args.command, state: stateOf(part.ok), output: part.output ?? "" });
    }
  }
  return { files: [...files.values()].reverse(), commands };
}

function StateMark({ state }: { state: ActivityState }) {
  const label = state === "running" ? t("عم ينفّذ") : state === "ok" ? t("تم") : t("ما نجح");
  return (
    <span role="img" aria-label={label} title={label} className="flex shrink-0" style={{ color: state === "ok" ? "var(--color-success)" : state === "fail" ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
      {state === "running" ? <SpinnerIcon className="h-3.5 w-3.5" /> : state === "ok" ? <DrawnCheck className="h-3.5 w-3.5" /> : <AlertIcon className="h-3.5 w-3.5" />}
    </span>
  );
}

export function ActivityPanel({
  activity,
  folder,
  tab,
  onTab,
  onClose,
}: {
  activity: Activity;
  folder: string | null;
  tab: ActivityTab;
  onTab: (tab: ActivityTab) => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl" aria-label={t("شغل الموديل")} style={{ background: "var(--color-surface)" }}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
        <div ref={roving} role="tablist" aria-label={t("شغل الموديل")} className="flex flex-1 gap-1">
          {(
            [
              ["files", t("الملفات"), activity.files.length, FileIcon],
              ["commands", t("الأوامر"), activity.commands.length, TerminalIcon],
            ] as const
          ).map(([id, label, count, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTab(id)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: tab === id ? "var(--color-inverse)" : "transparent", color: tab === id ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="num">{count}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label={t("سكّر اللوحة")} title={t("سكّر اللوحة")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{tab === "files" ? <FilesView files={activity.files} folder={folder} /> : <CommandsView commands={activity.commands} />}</div>
    </aside>
  );
}

// ── Files ──────────────────────────────────────────────────────────────────────────────

function FilesView({ files, folder }: { files: FileActivity[]; folder: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  // The newest file unless the user picked one; a rewrite of the open file refreshes it.
  const current = files.find((f) => f.path === picked) ?? files[0];
  if (!files.length) {
    return (
      <p className="p-6 text-center text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
        {t("لما الموديل يعمل أو يعدّل ملف، بيطلع هون وبتقدر تفتحه وتشوفه بدون ما تطلع من رفيق.")}
      </p>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <ul className="flex max-h-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-b p-2" style={{ borderColor: "var(--color-border)" }} aria-label={t("الملفات")}>
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              aria-pressed={f.path === current?.path}
              onClick={() => setPicked(f.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ background: f.path === current?.path ? "var(--color-surface-2)" : undefined }}
            >
              <StateMark state={f.state} />
              <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
                {f.path}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {current && folder ? (
        <PreviewView key={current.path} dir={folder} path={current.path} version={`${current.id}:${current.state}`} running={current.state === "running"} />
      ) : (
        <p className="p-6 text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في مجلد لهالمحادثة، فما بقدر افتح الملف.")}
        </p>
      )}
    </div>
  );
}

function PreviewView({ dir, path, version, running }: { dir: string; path: string; version: string; running: boolean }) {
  const [data, setData] = useState<FilePreview | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asCode, setAsCode] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (running) return; // the file is still being written
    let alive = true;
    setError(null);
    Promise.all([previewFile(dir, path), rawFileUrl(dir, path, `${version}:${reload}`)])
      .then(([preview, url]) => {
        if (!alive) return;
        setData(preview);
        setRaw(url);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [dir, path, version, running, reload]);

  const full = `${dir.replace(/[\\/]+$/, "")}/${path}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="ltr" title={full}>
          {path.split("/").pop()}
        </p>
        {data && (data.kind === "html" || data.kind === "markdown") && (
          <button
            type="button"
            onClick={() => setAsCode((v) => !v)}
            className="rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: "var(--color-ink-muted)" }}
            aria-pressed={asCode}
          >
            {asCode ? t("المعاينة") : t("الكود")}
          </button>
        )}
        <button type="button" onClick={() => setReload((n) => n + 1)} aria-label={t("حدّث")} title={t("حدّث")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(full)} aria-label={t("انسخ المسار")} title={t("انسخ المسار")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <CopyIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => void revealPath(full)} aria-label={t("افتح مكانه")} title={t("افتح مكانه")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <FolderIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {running ? (
          <p className="flex items-center gap-2 p-4 text-sm" style={{ color: "var(--color-ink-muted)" }}>
            <SpinnerIcon className="h-4 w-4" />
            {t("عم يكتب الملف…")}
          </p>
        ) : error ? (
          <p className="p-4 text-sm" style={{ color: "var(--color-danger)" }} role="alert">
            {error}
          </p>
        ) : !data || !raw ? (
          <div className="shimmer h-40 rounded-xl" />
        ) : data.kind === "image" ? (
          <img src={raw} alt={data.name} className="mx-auto max-h-full max-w-full rounded-xl" style={{ background: "repeating-conic-gradient(var(--color-surface-2) 0 25%, transparent 0 50%) 0 0 / 16px 16px" }} />
        ) : data.kind === "pdf" || (data.kind === "html" && !asCode) ? (
          // A web page the model wrote runs in its own sandbox: no access to Rafiq or its data.
          <iframe title={data.name} src={raw} sandbox={data.kind === "html" ? "allow-scripts allow-forms allow-modals" : undefined} className="h-full min-h-[24rem] w-full rounded-xl border bg-white" style={{ borderColor: "var(--color-border)" }} />
        ) : data.kind === "markdown" && !asCode ? (
          <div className="px-1 text-sm">
            <Markdown text={data.text ?? ""} />
          </div>
        ) : data.kind === "binary" ? (
          <p className="p-4 text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("هالملف مش نص ولا صورة ({0} KB) — افتحه من مكانه.", { 0: Math.max(1, Math.round(data.size / 1024)) })}
          </p>
        ) : (
          <CodeView text={data.text ?? ""} truncated={Boolean(data.truncated)} />
        )}
      </div>
    </div>
  );
}

function CodeView({ text, truncated }: { text: string; truncated: boolean }) {
  const lines = text.split("\n");
  return (
    <div className="overflow-hidden rounded-xl" style={{ background: "var(--color-surface-2)" }}>
      <pre className="overflow-x-auto py-3 font-mono text-xs leading-5" dir="ltr">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 select-none pe-3 text-end" style={{ color: "var(--color-ink-muted)" }} aria-hidden="true">
              {i + 1}
            </span>
            <span className="whitespace-pre pe-4">{line || " "}</span>
          </div>
        ))}
      </pre>
      {truncated && (
        <p className="border-t px-3 py-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}>
          {t("الملف أطول من هيك — افتحه من مكانه لتشوفه كامل.")}
        </p>
      )}
    </div>
  );
}

// ── Commands ───────────────────────────────────────────────────────────────────────────

function CommandsView({ commands }: { commands: CommandActivity[] }) {
  const end = useRef<HTMLDivElement>(null);
  const last = commands[commands.length - 1];
  // Follow the newest command, the way a terminal does.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [commands.length, last?.state]);
  if (!commands.length) {
    return (
      <p className="p-6 text-center text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
        {t("لما الموديل يشغّل أمر على جهازك (متل تثبيت مكتبة أو تشغيل اختبارات)، بيطلع هون مع نتيجته.")}
      </p>
    );
  }
  return (
    <div className="h-full overflow-y-auto p-3" role="log" aria-label={t("الأوامر")}>
      <ol className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {commands.map((c) => (
            <motion.li key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: easeOutExpo }}>
              <CommandRow command={c} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      <div ref={end} />
    </div>
  );
}

function CommandRow({ command }: { command: CommandActivity }) {
  const lines = command.output.split("\n");
  const long = lines.length > 14;
  const [open, setOpen] = useState(false);
  const shown = long && !open ? lines.slice(-14).join("\n") : command.output;
  return (
    <div className="overflow-hidden rounded-xl" style={{ background: "var(--color-surface-2)" }}>
      <div className="flex items-start gap-2 px-3 py-2">
        <StateMark state={command.state} />
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs" dir="ltr">
          <span style={{ color: "var(--color-ink-muted)" }} aria-hidden="true">
            ${" "}
          </span>
          {command.command}
        </code>
      </div>
      {command.state !== "running" && command.output.trim() && (
        <>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t px-3 py-2 font-mono text-[11px] leading-5" dir="ltr" style={{ borderColor: "var(--color-border)", color: command.state === "fail" ? "var(--color-danger)" : "var(--color-ink)" }}>
            {long && !open ? "…\n" : ""}
            {shown}
          </pre>
          {long && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="w-full border-t px-3 py-1 text-xs hover:bg-[var(--color-surface)]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}>
              {open ? t("أقل") : t("كل الناتج ({0} سطر)", { 0: lines.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
