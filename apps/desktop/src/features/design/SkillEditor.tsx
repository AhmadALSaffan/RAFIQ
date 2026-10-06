/**
 * Write and edit a skill without leaving Rafiq: the files of the skill on one side, the text
 * in the middle, and on the other side what the model will make of it — the check (errors
 * block saving, warnings are advice) and a preview of the instructions.
 *
 * A bundled skill opens read-only; "make my own copy" puts an editable copy in the user's
 * skills folder, which then takes over the same name.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { checkSkill, copySkill, createSkill, deleteSkillFile, listSkillFiles, readSkillFile, saveSkillFile } from "../../lib/api";
import type { SkillCheck, SkillFile } from "../../lib/types";
import { easeOutExpo } from "../../lib/motion";
import { Markdown } from "../../components/Markdown";
import { BracketLabel } from "../../components/brand";
import { Button, ErrorText } from "../../components/ui";
import { AlertIcon, CheckCircleIcon, FileIcon, PlusIcon, SpinnerIcon, TrashIcon, XIcon } from "../../components/Icons";
import { bodyOf, fileTemplate, lineRange, newFilePath, skillTemplate, type NewFileKind } from "./skillDraft";
import { t } from "../../i18n";

const MAIN = "SKILL.md";

type Mode = { kind: "new" } | { kind: "edit"; name: string } | { kind: "view"; name: string };

export function SkillEditor({ open, onClose, onSaved }: { open: Mode | null; onClose: () => void; onSaved: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "rgba(0,0,0,0.4)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <Editor key={open.kind === "new" ? "new" : open.name} start={open} onClose={onClose} onSaved={onSaved} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type { Mode as SkillEditorMode };

function Editor({ start, onClose, onSaved }: { start: Mode; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<Mode>(start);
  const [files, setFiles] = useState<SkillFile[]>(start.kind === "new" ? [{ path: MAIN, size: 0 }] : []);
  const [active, setActive] = useState(MAIN);
  // What's on disk and what's in the box, per file. A file not on disk yet has no `saved`.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(start.kind === "new" ? { [MAIN]: skillTemplate() } : {});
  const [check, setCheck] = useState<SkillCheck | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "copy" | null>(start.kind === "new" ? null : "load");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<NewFileKind | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const readOnly = mode.kind === "view";
  const name = mode.kind === "new" ? null : mode.name;
  const text = drafts[active] ?? "";
  const dirty = useMemo(() => Object.keys(drafts).filter((p) => drafts[p] !== saved[p]), [drafts, saved]);

  // Load the skill's files (and SKILL.md) when opening an existing one.
  const load = useCallback(async (skill: string) => {
    setBusy("load");
    try {
      const list = await listSkillFiles(skill);
      const main = await readSkillFile(skill, MAIN);
      setFiles(list);
      setSaved({ [MAIN]: main });
      setDrafts({ [MAIN]: main });
      setActive(MAIN);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (start.kind !== "new") void load(start.name);
  }, [start, load]);

  // Opening another file reads it once; its draft is kept while switching back and forth.
  async function openFile(path: string) {
    setActive(path);
    if (drafts[path] !== undefined || !name) return;
    try {
      const content = await readSkillFile(name, path);
      setSaved((s) => ({ ...s, [path]: content }));
      setDrafts((d) => ({ ...d, [path]: content }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // The check follows SKILL.md as it's typed.
  const main = drafts[MAIN];
  useEffect(() => {
    if (main === undefined) return;
    const id = setTimeout(() => {
      checkSkill(main)
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 300);
    return () => clearTimeout(id);
  }, [main]);

  const blocked = Boolean(check && !check.ok);

  async function save() {
    if (readOnly || busy || blocked || (!dirty.length && mode.kind !== "new")) return;
    setBusy("save");
    setError(null);
    try {
      if (mode.kind === "new") {
        const skill = await createSkill(drafts[MAIN]);
        setMode({ kind: "edit", name: skill.name });
        setSaved({ ...drafts });
        setFiles(await listSkillFiles(skill.name));
      } else if (mode.kind === "edit") {
        let current = mode.name;
        // SKILL.md first: a rename in its header changes the name the other files go under.
        for (const path of [...dirty].sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : 0))) {
          const skill = await saveSkillFile(current, path, drafts[path]);
          current = skill.name;
        }
        setMode({ kind: "edit", name: current });
        setSaved({ ...drafts });
        setFiles(await listSkillFiles(current));
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function makeCopy() {
    if (mode.kind !== "view") return;
    setBusy("copy");
    setError(null);
    try {
      const skill = await copySkill(mode.name);
      setMode({ kind: "edit", name: skill.name });
      onSaved();
      await load(skill.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  function addFile() {
    if (!adding) return;
    const path = newFilePath(adding, newName);
    if (!path) return;
    if (files.some((f) => f.path === path)) {
      setActive(path);
    } else {
      setFiles((list) => [...list, { path, size: 0 }]);
      setDrafts((d) => ({ ...d, [path]: fileTemplate(adding) }));
      setActive(path);
    }
    setAdding(null);
    setNewName("");
  }

  async function removeFile(path: string) {
    if (!name || path === MAIN) return;
    try {
      if (saved[path] !== undefined) await deleteSkillFile(name, path);
      setFiles((list) => list.filter((f) => f.path !== path));
      setDrafts(({ [path]: _gone, ...rest }) => rest);
      setSaved(({ [path]: _was, ...rest }) => rest);
      if (active === path) setActive(MAIN);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function jumpTo(line: number | null) {
    if (!line || !area.current) return;
    setActive(MAIN);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      const [from, to] = lineRange(el.value, line);
      el.focus();
      el.setSelectionRange(from, to);
    });
  }

  function close() {
    if (dirty.length && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  return (
    <motion.div
      initial={{ scale: 0.97, y: 10, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      exit={{ scale: 0.98, opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.28, ease: easeOutExpo }}
      className="flex h-full max-h-[860px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      role="dialog"
      aria-label={t("محرّر المهارات")}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          close();
        }
      }}
    >
      {/* Header: which skill, the check at a glance, save. */}
      <header className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <BracketLabel>{mode.kind === "new" ? t("مهارة جديدة") : readOnly ? t("مهارة مدمجة") : t("مهارتك")}</BracketLabel>
          <h2 className="mt-1 truncate font-mono text-lg font-bold" dir="ltr" style={{ textAlign: "start" }}>
            {check?.name || name || "…"}
          </h2>
        </div>
        {check && <CheckBadge check={check} />}
        {readOnly ? (
          <Button variant="accent" onClick={() => void makeCopy()} disabled={busy !== null}>
            {busy === "copy" ? <SpinnerIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
            {t("اعمل نسختي لعدّلها")}
          </Button>
        ) : (
          <Button
            variant="accent"
            onClick={() => void save()}
            disabled={busy !== null || blocked || (!dirty.length && mode.kind !== "new")}
            title={blocked ? t("صلّح الأخطاء أول") : t("احفظ (Ctrl+S)")}
          >
            {busy === "save" ? <SpinnerIcon className="h-4 w-4" /> : justSaved ? <CheckCircleIcon className="h-4 w-4" /> : null}
            {justSaved ? t("انحفظت") : mode.kind === "new" ? t("احفظ المهارة") : t("احفظ")}
          </Button>
        )}
        <button
          onClick={close}
          aria-label={t("إغلاق")}
          title={confirmClose ? t("في تعديلات ما انحفظت — اضغط كمان مرة لتسكّر بدونها") : t("إغلاق")}
          className="flex items-center gap-1 rounded-full p-2 text-xs transition-colors hover:bg-[var(--color-surface)]"
          style={{ color: confirmClose ? "var(--color-danger)" : "var(--color-ink-muted)" }}
        >
          {confirmClose && <span>{t("سكّر بدون حفظ؟")}</span>}
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <ErrorText message={error} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto px-2 pb-2 md:grid-cols-[13rem_minmax(0,1fr)_minmax(0,0.85fr)] md:overflow-hidden">
        {/* Files of the skill. */}
        <aside className="flex max-h-56 min-h-0 flex-col gap-1 overflow-y-auto rounded-2xl p-2 md:max-h-none" style={{ background: "var(--color-surface)" }}>
          <BracketLabel className="px-2 pb-1 pt-1">{t("الملفات")}</BracketLabel>
          {files.map((file) => {
            const on = file.path === active;
            const changed = drafts[file.path] !== undefined && drafts[file.path] !== saved[file.path];
            return (
              <div key={file.path} className="group flex items-center">
                <button
                  onClick={() => void openFile(file.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-start font-mono text-xs transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ background: on ? "var(--color-surface-2)" : undefined, color: on ? "var(--color-ink)" : "var(--color-ink-muted)" }}
                  dir="ltr"
                >
                  <FileIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{file.path}</span>
                  {changed && <span className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-ink)" }} aria-label={t("فيه تعديل")} />}
                </button>
                {!readOnly && file.path !== MAIN && name && (
                  <button
                    onClick={() => void removeFile(file.path)}
                    aria-label={t("احذف الملف")}
                    title={t("احذف الملف")}
                    className="rounded-full p-1.5 opacity-0 transition-opacity hover:bg-[var(--color-surface-2)] focus-visible:opacity-100 group-hover:opacity-100"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          {!readOnly && (
            <div className="mt-auto flex flex-col gap-1.5 pt-3">
              {mode.kind === "new" ? (
                <p className="px-2 text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                  {t("احفظ المهارة أول، وبعدين بتقدر تضيف ملفات مرجعية وأوامر.")}
                </p>
              ) : adding ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addFile();
                  }}
                  className="flex flex-col gap-1.5"
                >
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setAdding(null))}
                    placeholder={adding === "command" ? "release-notes" : "STYLE"}
                    aria-label={adding === "command" ? t("اسم الأمر") : t("اسم الملف")}
                    className="input py-1.5 font-mono text-xs"
                    dir="ltr"
                  />
                  <p className="px-1 font-mono text-[10px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                    {newFilePath(adding, newName) ?? "…"}
                  </p>
                </form>
              ) : (
                <>
                  <button onClick={() => setAdding("reference")} className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]">
                    <PlusIcon className="h-3.5 w-3.5" />
                    {t("ملف مرجعي")}
                  </button>
                  <button onClick={() => setAdding("command")} className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]">
                    <PlusIcon className="h-3.5 w-3.5" />
                    {t("أمر /")}
                  </button>
                </>
              )}
            </div>
          )}
        </aside>

        {/* The text. */}
        <div className="flex min-h-80 flex-col overflow-hidden rounded-2xl md:min-h-0" style={{ background: "var(--color-surface)" }}>
          <div className="flex items-center justify-between px-4 pt-3">
            <span className="font-mono text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
              {active}
            </span>
            <span className="num text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {text.length.toLocaleString("en")}
            </span>
          </div>
          {busy === "load" ? (
            <div className="m-4 flex-1 rounded-xl shimmer" />
          ) : (
            <textarea
              ref={area}
              value={text}
              readOnly={readOnly}
              onChange={(e) => {
                const value = e.target.value;
                setDrafts((d) => ({ ...d, [active]: value }));
                setConfirmClose(false);
              }}
              spellCheck={false}
              aria-label={active}
              className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-6 outline-none"
              dir="auto"
            />
          )}
        </div>

        {/* What the model will make of it. */}
        <div className="flex flex-col gap-2 md:min-h-0 md:overflow-y-auto">
          {active === MAIN && check && (
            <div className="rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
              <BracketLabel>{t("الفحص")}</BracketLabel>
              {check.errors.length === 0 && check.warnings.length === 0 ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm" style={{ color: "var(--color-success)" }}>
                  <CheckCircleIcon className="h-4 w-4" />
                  {t("المهارة سليمة وجاهزة للنموذج.")}
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {[...check.errors.map((i) => ({ ...i, error: true })), ...check.warnings.map((i) => ({ ...i, error: false }))].map((issue, i) => (
                    <li key={i}>
                      <button
                        onClick={() => jumpTo(issue.line)}
                        disabled={!issue.line}
                        className="flex w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-start text-xs leading-relaxed transition-colors enabled:hover:bg-[var(--color-surface-2)]"
                        style={{ color: issue.error ? "var(--color-danger)" : "var(--color-pending)" }}
                      >
                        <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">{issue.message}</span>
                        {issue.line && (
                          <span className="num shrink-0 opacity-70" dir="ltr">
                            L{issue.line}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {check.description && (
                <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                  {check.description}
                </p>
              )}
              {check.commands.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1" dir="ltr">
                  {check.commands.map((c) => (
                    <code key={c.name} title={c.description} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--color-border)" }}>
                      /{c.name}
                    </code>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
            <BracketLabel>{t("معاينة")}</BracketLabel>
            <div className="mt-2">
              {bodyOf(text) ? (
                <Markdown text={active === MAIN ? bodyOf(text) : text} />
              ) : (
                <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                  {t("اكتب التعليمات وبتطلع هون متل ما بيقرأها النموذج.")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function CheckBadge({ check }: { check: SkillCheck }) {
  const errors = check.errors.length;
  const warnings = check.warnings.length;
  const color = errors ? "var(--color-danger)" : warnings ? "var(--color-pending)" : "var(--color-success)";
  return (
    <span className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: "var(--color-border)", color }}>
      {errors || warnings ? <AlertIcon className="h-3.5 w-3.5" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
      {errors ? t("{0} خطأ", { 0: errors }) : warnings ? t("{0} ملاحظة", { 0: warnings }) : t("سليمة")}
    </span>
  );
}
