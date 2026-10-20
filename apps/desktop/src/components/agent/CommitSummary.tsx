/**
 * What a task changed, as a commit reads: the files grouped by folder, each folder
 * folding open, a line count per file and per folder, and the diff of any one file a
 * click away. (After the "Commit" component on 21st.dev, written for Rafiq.)
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChangedFile } from "../../lib/types";
import { DiffView } from "../DiffView";
import { FileGlyph } from "./FileTree";
import { t } from "../../i18n";

const LETTER: Record<ChangedFile["status"], string> = { added: "A", deleted: "D", renamed: "R", modified: "M" };
const COLOR: Record<ChangedFile["status"], string> = {
  added: "var(--color-success)",
  deleted: "var(--color-danger)",
  renamed: "var(--color-pending)",
  modified: "var(--color-accent)",
};

/** One file's part of a unified diff (from its `diff --git` line to the next). */
export function diffOf(diff: string, path: string): string {
  const parts = diff.split(/^(?=diff --git )/m);
  return parts.find((p) => p.startsWith("diff --git") && (p.includes(` b/${path}\n`) || p.includes(` b/${path} `) || p.split("\n")[0].endsWith(`b/${path}`))) ?? "";
}

/** Files by folder: "src/app" → its files. The root is "". */
export function byFolder(files: ChangedFile[]): [string, ChangedFile[]][] {
  const groups = new Map<string, ChangedFile[]>();
  for (const f of files) {
    const at = f.path.lastIndexOf("/");
    const dir = at === -1 ? "" : f.path.slice(0, at);
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <bdi className="shrink-0 font-mono text-[11px] tabular-nums" dir="ltr">
      <span style={{ color: "var(--color-success)" }}>+{add}</span> <span style={{ color: "var(--color-danger)" }}>−{del}</span>
    </bdi>
  );
}

export function CommitSummary({ files, diff }: { files: ChangedFile[]; diff: string }) {
  const groups = useMemo(() => byFolder(files), [files]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--color-border)" }} dir="ltr">
      {groups.map(([dir, list]) => {
        const open = !closed.has(dir);
        const add = list.reduce((n, f) => n + f.additions, 0);
        const del = list.reduce((n, f) => n + f.deletions, 0);
        return (
          <div key={dir || "/"} className="border-b last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
            <button
              type="button"
              onClick={() => setClosed((s) => (s.has(dir) ? new Set([...s].filter((x) => x !== dir)) : new Set([...s, dir])))}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ background: "color-mix(in oklch, var(--color-surface-2) 60%, transparent)" }}
            >
              <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }} className="text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                ▶
              </motion.span>
              <FileGlyph name={dir || "/"} folder />
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{dir ? `${dir}/` : "./"}</span>
              <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                {t("{0} ملف", { 0: list.length })}
              </span>
              <Counts add={add} del={del} />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.ul initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  {list.map((f) => {
                    const name = f.path.slice(dir ? dir.length + 1 : 0);
                    const isShown = shown === f.path;
                    return (
                      <li key={f.path}>
                        <div className="flex items-center gap-2 py-1.5 pe-3 ps-8">
                          <span className="w-3 text-center font-mono text-[11px] font-bold" style={{ color: COLOR[f.status] }} title={f.status}>
                            {LETTER[f.status]}
                          </span>
                          <FileGlyph name={name} />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs" style={{ textDecoration: f.status === "deleted" ? "line-through" : undefined }}>
                            {name}
                          </span>
                          {f.binary ? (
                            <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                              bin
                            </span>
                          ) : (
                            <Counts add={f.additions} del={f.deletions} />
                          )}
                          {!f.binary && diff && (
                            <button
                              type="button"
                              onClick={() => setShown(isShown ? null : f.path)}
                              aria-expanded={isShown}
                              className="rounded-md px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
                              style={{ color: isShown ? "var(--color-ink)" : "var(--color-ink-muted)" }}
                            >
                              {isShown ? t("إخفاء") : t("الفرق")}
                            </button>
                          )}
                        </div>
                        <AnimatePresence initial={false}>
                          {isShown && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-3 pb-2">
                              <DiffView diff={diffOf(diff, f.path) || t("الفرق تبع هالملف مش ضمن الجزء المعروض.")} maxHeight="20rem" />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
