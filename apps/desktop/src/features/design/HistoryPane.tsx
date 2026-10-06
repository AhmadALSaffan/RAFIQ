/**
 * A design's history: every version of every document, newest first. Pick one to see it
 * against the version before it (or any other) — side by side as rendered pages, or as the
 * lines that changed — and bring an old one back if the new direction didn't work out.
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { compareDesignVersions, getDesignVersion, listDesignVersions, restoreDesignVersion } from "../../lib/api";
import type { Design, DesignDiff, DesignVersion } from "../../lib/types";
import { listContainer, listItem, snappy } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { Button } from "../../components/ui";
import { RefreshIcon } from "../../components/Icons";
import { guarded } from "./preview";
import { t } from "../../i18n";

type Mode = "side" | "changes";

/** "home · v3" — a version by its document and number. */
export function versionLabel(v: Pick<DesignVersion, "document" | "number">): string {
  return t("{0} · ن{1}", { 0: v.document, 1: v.number });
}

/** What a version is compared with by default: the version of the same document just
 *  before it (versions come newest first), or nothing for a document's first version. */
export function previousOf(versions: DesignVersion[], id: string): string | null {
  const index = versions.findIndex((v) => v.id === id);
  if (index < 0) return null;
  const doc = versions[index].document;
  return versions.slice(index + 1).find((v) => v.document === doc)?.id ?? null;
}

export function HistoryPane({
  designId,
  changedAt,
  onRestored,
}: {
  designId: string;
  /** When the design last changed — a new reply means new versions to list. */
  changedAt: string;
  onRestored: (design: Design, label: string) => void;
}) {
  const [versions, setVersions] = useState<DesignVersion[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [against, setAgainst] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("side");
  const [html, setHtml] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<DesignDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listDesignVersions(designId)
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        // Open on the newest version, against the one before it.
        if (list.length && !list.some((v) => v.id === picked)) {
          setPicked(list[0].id);
          setAgainst(previousOf(list, list[0].id));
        }
      })
      .catch((err) => alive && (setVersions([]), setError(err instanceof Error ? err.message : String(err))));
    return () => {
      alive = false;
    };
    // `picked` is only read to keep the selection across a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId, changedAt]);

  // The HTML of the two versions on screen, fetched once each.
  useEffect(() => {
    for (const id of [picked, against]) {
      if (!id || html[id] !== undefined) continue;
      getDesignVersion(designId, id)
        .then((v) => setHtml((all) => ({ ...all, [id]: v.html })))
        .catch(() => setHtml((all) => ({ ...all, [id]: "" })));
    }
  }, [designId, picked, against, html]);

  useEffect(() => {
    setDiff(null);
    if (!picked || !against || mode !== "changes") return;
    let alive = true;
    compareDesignVersions(designId, against, picked)
      .then((d) => alive && setDiff(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [designId, picked, against, mode]);

  const byId = useMemo(() => new Map((versions ?? []).map((v) => [v.id, v])), [versions]);
  const current = picked ? byId.get(picked) : undefined;
  const other = against ? byId.get(against) : undefined;
  // The newest version of each document is what the design shows now.
  const latest = useMemo(() => {
    const seen = new Set<string>();
    return new Set((versions ?? []).filter((v) => !seen.has(v.document) && seen.add(v.document)).map((v) => v.id));
  }, [versions]);

  async function restore(version: DesignVersion) {
    setBusy(true);
    setError(null);
    try {
      onRestored(await restoreDesignVersion(designId, version.id), versionLabel(version));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (versions === null) return <div className="shimmer m-6 h-40 rounded-xl" />;
  if (!versions.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
        <p className="max-w-sm text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {error ?? t("كل مرة النموذج بيكتب أو بيعدّل الواجهة، بتنحفظ نسخة هون — وبتقدر تقارن بين أي تنتين أو ترجع لوحدة قديمة.")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Every version, newest first. */}
      <motion.ol
        variants={listContainer}
        initial="hidden"
        animate="show"
        className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-e p-2" data-pane="versions"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        {versions.map((v) => {
          const active = v.id === picked;
          return (
            <motion.li key={v.id} variants={listItem}>
              <button
                onClick={() => {
                  setPicked(v.id);
                  setAgainst(previousOf(versions, v.id));
                }}
                className="relative flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              >
                {active && (
                  <motion.span
                    layoutId="design-version"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: "var(--color-surface-2)", boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--color-ink) 40%, transparent)" }}
                    transition={snappy}
                  />
                )}
                <span className="relative flex items-center gap-1.5 text-xs font-medium">
                  <span className="truncate" dir="auto">
                    {versionLabel(v)}
                  </span>
                  {latest.has(v.id) && (
                    <span className="shrink-0 rounded px-1 py-px text-[10px] font-normal" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                      {t("الحالية")}
                    </span>
                  )}
                </span>
                <span className="relative flex items-center gap-2 text-[11px] tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                  {timeAgo(v.created_at)}
                  <span dir="ltr">
                    <span style={{ color: "var(--color-success)" }}>+{v.added}</span> <span style={{ color: "var(--color-danger)" }}>−{v.removed}</span>
                  </span>
                </span>
                {v.summary && (
                  <span className="relative line-clamp-2 text-[11px] leading-snug" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                    {v.summary}
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
      </motion.ol>

      {/* The comparison. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs" style={{ borderColor: "var(--color-border)" }}>
          <span style={{ color: "var(--color-ink-muted)" }}>{t("قارن مع")}</span>
          <select value={against ?? ""} onChange={(e) => setAgainst(e.target.value || null)} className="input w-48 py-1 text-xs">
            <option value="">{t("ولا شي — اعرضها لحالها")}</option>
            {versions
              .filter((v) => v.id !== picked)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {versionLabel(v)}
                </option>
              ))}
          </select>
          <div className="flex items-center gap-0.5 rounded-full p-0.5" style={{ background: "var(--color-surface-2)" }}>
            {(["side", "changes"] as Mode[]).map((key) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                disabled={key === "changes" && !against}
                className="relative rounded-md px-2.5 py-1 disabled:opacity-40"
                style={{ color: mode === key ? "var(--color-ink)" : "var(--color-ink-muted)" }}
              >
                {mode === key && (
                  <motion.span layoutId="history-mode" className="absolute inset-0 rounded-md" style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--color-border)" }} transition={snappy} />
                )}
                <span className="relative">{key === "side" ? t("جنب بعض") : t("الأسطر اللي تغيّرت")}</span>
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {current && !latest.has(current.id) && (
            <Button className="px-2.5 py-1 text-xs" onClick={() => void restore(current)} disabled={busy}>
              <RefreshIcon className="h-3.5 w-3.5" />
              {t("رجّع هالنسخة")}
            </Button>
          )}
        </div>

        {error && (
          <p className="px-4 py-2 text-xs" style={{ color: "var(--color-danger)" }} role="alert">
            {error}
          </p>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {mode === "side" || !against ? (
            <motion.div key="side" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex min-h-0 flex-1 gap-3 p-3">
              {other && <Frame title={versionLabel(other)} html={html[other.id]} muted />}
              {current && <Frame title={versionLabel(current)} html={html[current.id]} />}
            </motion.div>
          ) : (
            <motion.div key="changes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="min-h-0 flex-1 overflow-auto p-3">
              {diff ? <DiffView diff={diff} /> : <div className="shimmer h-40 rounded-lg" />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Frame({ title, html, muted = false }: { title: string; html: string | undefined; muted?: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl" style={{ background: "var(--color-surface)" }}>
      <p className="border-b px-3 py-1.5 text-[11px] font-medium" style={{ borderColor: "var(--color-border)", color: muted ? "var(--color-ink-muted)" : "var(--color-ink)" }} dir="auto">
        {title}
      </p>
      {html === undefined ? (
        <div className="shimmer m-3 flex-1 rounded-lg" />
      ) : (
        <iframe title={title} srcDoc={guarded(html)} sandbox="allow-scripts allow-forms" className="min-h-0 w-full flex-1 bg-white" />
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: DesignDiff }) {
  return (
    <div className="overflow-hidden rounded-2xl font-mono text-[11.5px] leading-relaxed" style={{ background: "var(--color-surface)" }} dir="ltr">
      <p className="flex items-center gap-3 border-b px-3 py-1.5 font-sans text-[11px]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }} dir="auto">
        {t("من {0} لـ {1}", { 0: versionLabel(diff.a), 1: versionLabel(diff.b) })}
        <span dir="ltr" className="tabular-nums">
          <span style={{ color: "var(--color-success)" }}>+{diff.added}</span> <span style={{ color: "var(--color-danger)" }}>−{diff.removed}</span>
        </span>
      </p>
      {diff.added === 0 && diff.removed === 0 ? (
        <p className="px-3 py-4 font-sans text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
          {t("النسختين متطابقتين.")}
        </p>
      ) : (
        diff.runs.map((run, i) =>
          run.kind === "skip" ? (
            <p key={i} className="px-3 py-1 font-sans text-[11px]" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }} dir="auto">
              {t("… {0} سطر ما تغيّروا", { 0: run.count })}
            </p>
          ) : (
            run.lines.map((line, j) => (
              <div
                key={`${i}-${j}`}
                className="flex gap-3 whitespace-pre-wrap break-all px-3"
                style={{
                  background:
                    run.kind === "add"
                      ? "color-mix(in oklch, var(--color-success) 14%, transparent)"
                      : run.kind === "del"
                        ? "color-mix(in oklch, var(--color-danger) 14%, transparent)"
                        : undefined,
                }}
              >
                <span className="w-8 shrink-0 select-none text-end tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                  {run.start + j}
                </span>
                <span className="w-3 shrink-0 select-none" style={{ color: run.kind === "add" ? "var(--color-success)" : run.kind === "del" ? "var(--color-danger)" : "transparent" }}>
                  {run.kind === "add" ? "+" : run.kind === "del" ? "−" : " "}
                </span>
                <span className="min-w-0 flex-1">{line || " "}</span>
              </div>
            ))
          ),
        )
      )}
    </div>
  );
}
