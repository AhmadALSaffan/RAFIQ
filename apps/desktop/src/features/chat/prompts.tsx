/**
 * The prompt library: text the user keeps retyping, one click away.
 *
 * `{{name}}` marks the parts that change. Picking a prompt with variables asks for them
 * first; the filled text then goes into the message box — never straight to the model — so
 * the user reads it before it's sent.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPrompt, deletePrompt, listPrompts, markPromptUsed, updatePrompt } from "../../lib/api";
import type { SavedPrompt } from "../../lib/types";
import { Dialog } from "../../components/ChatCommands";
import { Button } from "../../components/ui";
import { PencilIcon, PlusIcon, SearchIcon, TrashIcon } from "../../components/Icons";
import { fieldDir } from "../../lib/bidi";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";
import { fillPrompt, variablesOf } from "../../lib/variables";

// The `{{name}}` rule is shared with task templates (lib/variables.ts).
export { fillPrompt, variablesOf } from "../../lib/variables";

/** A title from the text itself: its first line, short. */
export function titleFrom(body: string): string {
  const first = body.trim().split("\n")[0].trim();
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

function Variables({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-full border px-2 py-0.5 font-mono text-[10.5px]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
          dir="auto"
        >
          {`{{${n}}}`}
        </span>
      ))}
    </span>
  );
}

/** Save (or edit) a prompt. Starts from a message the user sent, or from nothing. */
export function SavePromptDialog({
  initial,
  editing,
  onClose,
  onSaved,
}: {
  initial: string;
  editing?: SavedPrompt;
  onClose: () => void;
  onSaved: (prompt: SavedPrompt) => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? titleFrom(initial));
  const [body, setBody] = useState(editing?.body ?? initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const names = useMemo(() => variablesOf(body), [body]);

  async function save() {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const saved = editing
        ? await updatePrompt(editing.id, { title: title.trim(), body })
        : await createPrompt(title.trim(), body);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={editing ? t("عدّل البرومبت") : t("احفظه كبرومبت")}
      subtitle={t("حط {0} مكان الأجزاء اللي بتتغير — رفيق بيسألك عنها كل مرة.", { 0: `{{${t("الاسم")}}}` })}
      onClose={onClose}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("الاسم")}
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" dir={fieldDir(title)} maxLength={120} autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("النص")}
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          className="input resize-y text-sm leading-relaxed"
          dir={fieldDir(body)}
        />
      </label>
      <Variables names={names} />
      {error && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("إلغاء")}
        </Button>
        <Button onClick={() => void save()} disabled={saving || !title.trim() || !body.trim()}>
          {t("احفظ")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Pick a prompt (and fill its variables); the result goes into the message box. */
export function PromptLibraryDialog({
  initialId,
  onClose,
  onInsert,
}: {
  initialId?: string | null;
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SavedPrompt | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SavedPrompt | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listPrompts()
      .then((list) => {
        setPrompts(list);
        const start = initialId ? list.find((p) => p.id === initialId) : undefined;
        if (start) choose(start);
      })
      .catch(() => setPrompts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!prompts) return [];
    return q ? prompts.filter((p) => `${p.title}\n${p.body}`.toLowerCase().includes(q)) : prompts;
  }, [prompts, query]);

  function insert(prompt: SavedPrompt, filled: string) {
    void markPromptUsed(prompt.id).catch(() => undefined);
    onInsert(filled);
  }

  function choose(prompt: SavedPrompt) {
    if (!prompt.variables.length) return insert(prompt, prompt.body);
    setValues({});
    setPicked(prompt);
  }

  useEffect(() => {
    if (picked) firstField.current?.focus();
  }, [picked]);

  async function remove(prompt: SavedPrompt) {
    if (confirming !== prompt.id) return setConfirming(prompt.id);
    setPrompts((prev) => prev?.filter((p) => p.id !== prompt.id) ?? prev);
    setConfirming(null);
    await deletePrompt(prompt.id).catch(() => undefined);
  }

  if (editing) {
    return (
      <SavePromptDialog
        initial=""
        editing={editing === "new" ? undefined : editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setPrompts((prev) => (prev ? [saved, ...prev.filter((p) => p.id !== saved.id)] : [saved]));
          setEditing(null);
        }}
      />
    );
  }

  if (picked) {
    const preview = fillPrompt(picked.body, values);
    const ready = picked.variables.every((n) => values[n]?.trim());
    return (
      <Dialog title={picked.title} subtitle={t("عبّي الأجزاء اللي بتتغير، وبينحط النص بمربّع الرسالة.")} onClose={onClose}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) insert(picked, preview);
          }}
        >
          {picked.variables.map((name, i) => (
            <label key={name} className="flex flex-col gap-1">
              <span className="font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                {name}
              </span>
              <input
                ref={i === 0 ? firstField : undefined}
                value={values[name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                className="input"
                dir={fieldDir(values[name] ?? "")}
              />
            </label>
          ))}
          <div
            className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-xs leading-relaxed"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink-muted)" }}
            dir="auto"
          >
            {preview}
          </div>
          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
              {t("رجوع")}
            </Button>
            <Button type="submit" disabled={!ready}>
              {t("حطه بمربّع الرسالة")}
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("البرومبتات")} subtitle={t("نصوص بتعيدها — بمتغيرات تعبّيها كل مرة.")} onClose={onClose}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border px-2.5" style={{ borderColor: "var(--color-border)" }}>
          <SearchIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("دوّر…")}
            aria-label={t("دوّر…")}
            className="w-full bg-transparent py-1.5 text-sm outline-none"
            dir={fieldDir(query)}
            autoFocus
          />
        </div>
        <Button variant="ghost" onClick={() => setEditing("new")}>
          <PlusIcon className="h-4 w-4" />
          {t("جديد")}
        </Button>
      </div>

      {prompts && prompts.length === 0 && (
        <p className="py-6 text-center text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في برومبتات لسا. كليك يمين على أي رسالة بعتّها ← «احفظه كبرومبت»، أو اضغط «جديد».")}
        </p>
      )}
      {prompts && prompts.length > 0 && shown.length === 0 && (
        <p className="py-6 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما لقيت شي.")}
        </p>
      )}

      <ul className="-mx-1 flex flex-col">
        <AnimatePresence initial={false}>
          {shown.map((p) => (
            <motion.li
              key={p.id}
              layout="position"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: easeOutExpo }}
              className="group relative"
              onMouseLeave={() => confirming === p.id && setConfirming(null)}
            >
              <button
                onClick={() => choose(p)}
                className="flex w-full flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <span className="flex w-full items-baseline gap-2 pe-16">
                  <span className="truncate text-sm font-medium" dir="auto">
                    {p.title}
                  </span>
                  {p.uses > 0 && (
                    <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                      {t("{0} مرة", { 0: p.uses })}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
                  {p.body}
                </span>
                <Variables names={p.variables} />
              </button>
              <span
                className={`absolute end-1.5 top-1.5 flex gap-0.5 transition-opacity ${confirming === p.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
              >
                <button
                  onClick={() => setEditing(p)}
                  aria-label={t("عدّل")}
                  title={t("عدّل")}
                  className="rounded p-1 transition-colors hover:bg-[var(--color-surface)]"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void remove(p)}
                  aria-label={confirming === p.id ? t("اضغط مرة ثانية للحذف") : t("حذف")}
                  title={confirming === p.id ? t("اضغط مرة ثانية للحذف") : t("حذف")}
                  className="rounded p-1 transition-colors"
                  style={confirming === p.id ? { background: "var(--color-danger)", color: "white" } : { color: "var(--color-ink-muted)" }}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Dialog>
  );
}
