/**
 * Settings → Logs: what Rafiq and each MCP server wrote, without leaving the app.
 *
 * The agent sends only the tail of a file, already scrubbed of anything secret, so what is
 * on screen is safe to copy into a bug report. Filtering happens here, on the lines already
 * loaded; "more" asks the agent for a longer tail.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { listLogs, readLog } from "../../lib/api";
import { canPickNatively, revealPath } from "../../lib/folders";
import { snappy } from "../../lib/motion";
import type { LogInfo, LogOut } from "../../lib/types";
import { Button } from "../../components/ui";
import { CopyIcon, FolderIcon, RefreshIcon, SearchIcon } from "../../components/Icons";
import { Hint, Section, Switch } from "./controls";
import { locale, t } from "../../i18n";

const SHORT = 500;
const LONG = 5000;
const POLL_MS = 3000;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
}

/** Errors stand out, warnings a little; everything else stays quiet. */
function tone(line: string): string | undefined {
  if (/\b(error|exception|traceback|failed|fatal)\b/i.test(line)) return "var(--color-danger)";
  if (/\bwarn(ing)?\b/i.test(line)) return "var(--color-accent)";
  return undefined;
}

export function LogsSettings() {
  const [list, setList] = useState<LogInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<LogOut | null>(null);
  const [lines, setLines] = useState(SHORT);
  const [filter, setFilter] = useState("");
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const body = useRef<HTMLPreElement>(null);
  const stick = useRef(true); // keep following the end unless the reader scrolled up

  useEffect(() => {
    void canPickNatively().then(setNative);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const next = await listLogs();
      setList(next);
      setActive((current) => (current && next.some((l) => l.id === current) ? current : (next[0]?.id ?? null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setList([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!active) return;
    try {
      setLog(await readLog(active, lines));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [active, lines]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    stick.current = true;
    void load();
  }, [load]);

  // Following a log live: re-read every few seconds, but only while the window is looked at.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
        void refreshList();
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, load, refreshList]);

  const shown = useMemo(() => {
    const all = log?.text ? log.text.split("\n") : [];
    const needle = filter.trim().toLowerCase();
    return needle ? all.filter((line) => line.toLowerCase().includes(needle)) : all;
  }, [log, filter]);

  useEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t("ما قدرت أنسخ — حدّد النص وانسخه بإيدك."));
    }
  }

  const muted = { color: "var(--color-ink-muted)" };

  return (
    <Section
      title={t("السجلات")}
      action={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs" style={muted}>
            <Switch checked={live} onChange={setLive} label={t("تحديث تلقائي")} />
            {t("تحديث تلقائي")}
          </label>
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => {
              void refreshList();
              void load();
            }}
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            {t("حدّث")}
          </Button>
        </div>
      }
    >
      <Hint>{t("المفاتيح والتوكنات وكلمات السر بتنخفى قبل ما توصل هون، فالسجل آمن تنسخه وتبعته مع أي مشكلة.")}</Hint>

      {list !== null && list.length === 0 && (
        <div className="rounded-lg border px-4 py-6 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-medium">{t("ما في سجلات لسا")}</p>
          <p className="mt-1 text-xs leading-relaxed" style={muted}>
            {t("سجل رفيق بينكتب بالنسخة المثبّتة من التطبيق، وكل خادم MCP محلي بيكتب سجله أول ما يشتغل.")}
          </p>
        </div>
      )}

      {list && list.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("السجلات")}>
            {list.map((item) => {
              const on = item.id === active;
              return (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setActive(item.id);
                    setLines(SHORT);
                    setFilter("");
                  }}
                  className="relative rounded-lg px-3 py-1.5 text-start transition-colors"
                  style={{ color: on ? "var(--color-ink)" : "var(--color-ink-muted)" }}
                  title={when(item.modified)}
                >
                  {on && (
                    <motion.span
                      layoutId="log-pill"
                      className="absolute inset-0 rounded-lg"
                      style={{
                        background: "color-mix(in oklch, var(--color-accent) 14%, transparent)",
                        boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--color-accent) 45%, transparent)",
                      }}
                      transition={snappy}
                    />
                  )}
                  <span className="relative block text-sm font-medium">{item.name}</span>
                  <span className="relative block text-[11px] tabular-nums" style={muted}>
                    {item.kind === "agent" ? t("رفيق") : "MCP"} · {bytes(item.size)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
              <div className="relative min-w-40 flex-1">
                <SearchIcon className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={muted} />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("فلتر السطور…")}
                  aria-label={t("فلتر السطور…")}
                  className="input w-full py-1 ps-7 text-xs"
                />
              </div>
              <span className="text-[11px] tabular-nums" style={muted}>
                {filter.trim()
                  ? t("{0} من {1} سطر", { 0: String(shown.length), 1: String(log?.lines ?? 0) })
                  : t("{0} سطر", { 0: String(log?.lines ?? 0) })}
              </span>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy()} disabled={!shown.length}>
                <CopyIcon className="h-3.5 w-3.5" />
                {copied ? t("انتسخ") : t("انسخ")}
              </Button>
              {native && log && (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void revealPath(log.path)}>
                  <FolderIcon className="h-3.5 w-3.5" />
                  {t("افتح المجلد")}
                </Button>
              )}
            </div>

            {log?.truncated && lines < LONG && !filter.trim() && (
              <button
                onClick={() => {
                  stick.current = false;
                  setLines(LONG);
                }}
                className="w-full py-1.5 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
                style={muted}
              >
                {t("في سطور أقدم — اعرض آخر {0} سطر", { 0: String(LONG) })}
              </button>
            )}

            <pre
              ref={body}
              dir="ltr"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className="max-h-[60vh] min-h-40 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap"
              style={{ wordBreak: "break-word" }}
            >
              {log && !log.text && <span style={muted}>{t("السجل فاضي.")}</span>}
              {log && log.text && !shown.length && <span style={muted}>{t("ما في سطور فيها هالكلمة.")}</span>}
              {shown.map((line, i) => (
                <div key={i} style={{ color: tone(line) }}>
                  {line || " "}
                </div>
              ))}
            </pre>
          </div>
        </>
      )}

      {error && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
