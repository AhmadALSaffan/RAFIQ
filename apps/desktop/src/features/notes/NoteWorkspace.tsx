/**
 * One note, being written and read: its header (title, where it lives, whether it's
 * saved), the write/read switch, the formatting bar with "Help me", the editor or the
 * rendered note, the outline, and export. It loads the note, saves it as it's typed, and
 * notices when the file changed elsewhere. The notes page puts it beside the list; the
 * light window (LiteNote) shows it alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  IconBold,
  IconCheck,
  IconChevronDown,
  IconCode,
  IconDownload,
  IconEye,
  IconFileTypeDocx,
  IconFileTypePdf,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconListTree,
  IconNotebook,
  IconPencil,
  IconPhoto,
  IconQuote,
  IconSeparatorHorizontal,
  IconSourceCode,
  IconSparkles,
  IconStrikethrough,
  IconTable,
} from "@tabler/icons-react";
import { assistNote, exportNote, listModels, readNote, saveNote, saveNoteImage, type AssistAction, type NoteFile } from "../../lib/api";
import type { LlmModel } from "../../lib/types";
import { NoteEditor, type FormatCommand, type NoteEditorHandle } from "../../components/notes/NoteEditor";
import { NoteView } from "../../components/notes/NoteView";
import { BrandMark } from "../../components/BrandMark";
import { Button, EmptyState } from "../../components/ui";
import { noteHeadings, wordsDir } from "../../lib/noteBidi";
import { revealPath } from "../../lib/folders";
import { notify } from "../../lib/toast";
import { savedModel } from "../chat/constants";
import { direction, t } from "../../i18n";

type Mode = "write" | "read";
type Status = "saved" | "dirty" | "saving" | "conflict" | "error";

const MODE_KEY = "rafiq-notes-mode";
const OUTLINE_KEY = "rafiq-notes-outline";
const ASSIST_MODEL_KEY = "rafiq-notes-assist-model";
const SAVE_AFTER = 700;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a convenience only
  }
}

export async function isDesktop(): Promise<boolean> {
  const { isTauri } = await import("@tauri-apps/api/core");
  return isTauri();
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.(md|markdown|txt)$/i, "");
}

interface AssistState {
  action: AssistAction;
  scope: "selection" | "note" | "after";
  result: string | null;
  error: string | null;
  model: string | null;
}

interface Props {
  path: string;
  /** After every save (the notes list refreshes its times and titles). */
  onSaved?: () => void;
  /** A `[[name]]` link was clicked. */
  onOpenNote?: (name: string, from: NoteFile) => void;
  /** Shown with a load error, to leave it. */
  onBack?: () => void;
  /** Buttons of the host's own in the header (send to a chat, open in the full app…). */
  actions?: (ctx: { note: NoteFile; save: () => Promise<void> }) => ReactNode;
  /** Put the cursor in the editor once the note is open (a note just made). */
  focusOnLoad?: boolean;
}

export function NoteWorkspace({ path, onSaved, onOpenNote, onBack, actions, focusOnLoad = false }: Props) {
  const [note, setNote] = useState<NoteFile | null>(null);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<Status>("saved");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => (stored(MODE_KEY) === "read" ? "read" : "write"));
  const [outline, setOutline] = useState(() => stored(OUTLINE_KEY) !== "off");
  const [assist, setAssist] = useState<AssistState | null>(null);
  const [printing, setPrinting] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [assistModel, setAssistModel] = useState<string | null>(() => stored(ASSIST_MODEL_KEY));

  const editor = useRef<NoteEditorHandle>(null);
  const readPane = useRef<HTMLDivElement>(null);
  // What's on disk, and the version of it the editor started from (for the 409 check).
  const saved = useRef({ path: "", text: "", mtime: 0 as number | null });
  const latestText = useRef(text);
  latestText.current = text;
  const timer = useRef<number | null>(null);
  const savedHook = useRef(onSaved);
  savedHook.current = onSaved;

  useEffect(() => {
    listModels()
      .then((list) => setModels(list.filter((m) => m.verify_ok !== false)))
      .catch(() => setModels([]));
  }, []);

  // The model "Help me" runs on: the one picked here, or the chat's, or the first that works.
  const helper = models.find((m) => m.id === assistModel) ?? models.find((m) => m.id === savedModel()) ?? models[0] ?? null;

  // ── Saving ──────────────────────────────────────────────────────────────────────────────

  const save = useCallback(async (force = false) => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const target = saved.current.path;
    const content = latestText.current;
    if (!target || (!force && content === saved.current.text)) return;
    setStatus("saving");
    try {
      const out = await saveNote(target, content, force ? null : saved.current.mtime);
      if (saved.current.path !== target) return;
      saved.current = { path: target, text: content, mtime: out.mtime };
      setStatus(latestText.current === content ? "saved" : "dirty");
      savedHook.current?.();
    } catch (e) {
      if (saved.current.path !== target) return;
      if ((e as { status?: number }).status === 409) setStatus("conflict");
      else {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  const onChange = useCallback(
    (next: string) => {
      setText(next);
      setStatus("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), SAVE_AFTER);
    },
    [save],
  );

  // Opening another note saves the one being written first.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await save();
      if (!alive) return;
      try {
        const file = await readNote(path);
        if (!alive) return;
        saved.current = { path: file.path, text: file.content, mtime: file.mtime };
        setNote(file);
        setText(file.content);
        setStatus("saved");
        setError(null);
        setRevision((r) => r + 1);
        if (focusOnLoad) {
          setMode("write");
          window.setTimeout(() => editor.current?.focus(), 200);
        }
      } catch (e) {
        if (!alive) return;
        setNote(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // focusOnLoad is read once per note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, save]);

  // Leaving (another page, a closed window) saves what's left.
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );
  useEffect(() => {
    const flush = () => void save();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [save]);

  // Changed on disk while Rafiq was in the background (another editor, OneDrive): a note
  // with nothing unsaved picks the new text up when the window comes back.
  useEffect(() => {
    const onFocus = () => {
      const target = saved.current.path;
      if (!target || latestText.current !== saved.current.text) return;
      readNote(target)
        .then((file) => {
          if (saved.current.path !== target || file.mtime === saved.current.mtime || latestText.current !== saved.current.text) return;
          saved.current = { path: file.path, text: file.content, mtime: file.mtime };
          setText(file.content);
          setRevision((r) => r + 1);
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const reloadFromDisk = async () => {
    if (!saved.current.path) return;
    const file = await readNote(saved.current.path);
    saved.current = { path: file.path, text: file.content, mtime: file.mtime };
    setText(file.content);
    setStatus("saved");
    setRevision((r) => r + 1);
  };

  const toggleTask = (line: number) => {
    const lines = latestText.current.split("\n");
    const at = line - 1;
    if (!lines[at]) return;
    lines[at] = lines[at].replace(/\[( |x|X)\]/, (_, mark: string) => (mark === " " ? "[x]" : "[ ]"));
    onChange(lines.join("\n"));
    setRevision((r) => r + 1);
  };

  // ── The model's help ────────────────────────────────────────────────────────────────────

  const pickModel = (id: string) => {
    setAssistModel(id);
    store(ASSIST_MODEL_KEY, id);
  };

  const runAssist = async (action: AssistAction) => {
    const selection = editor.current?.selection() ?? "";
    const scope = action === "continue" ? "after" : selection ? "selection" : "note";
    const source = action === "continue" ? (editor.current?.beforeCursor() || latestText.current).slice(-8000) : selection || latestText.current;
    if (!source.trim()) return;
    setAssist({ action, scope, result: null, error: null, model: helper?.name ?? null });
    try {
      const out = await assistNote(action, source, helper?.id ?? null);
      setAssist((prev) => (prev && prev.action === action ? { ...prev, result: out.text, model: out.model || prev.model } : prev));
    } catch (e) {
      setAssist((prev) => (prev ? { ...prev, error: e instanceof Error ? e.message : String(e) } : prev));
    }
  };

  const applyAssist = (how: "replace" | "after") => {
    if (!assist?.result) return;
    if (assist.scope === "note" && how === "replace") {
      onChange(assist.result);
      setRevision((r) => r + 1);
    } else if (how === "replace") {
      editor.current?.replaceSelection(assist.result);
    } else {
      editor.current?.insertAfterSelection(`${assist.action === "continue" ? "" : "\n\n"}${assist.result}`);
    }
    setAssist(null);
  };

  // ── Export ──────────────────────────────────────────────────────────────────────────────

  const exportWord = async () => {
    if (!note) return;
    await save();
    if (!(await isDesktop())) {
      notify({ type: "info", title: t("التصدير لـ Word بيشتغل بالتطبيق المثبّت") });
      return;
    }
    const { save: pick } = await import("@tauri-apps/plugin-dialog");
    const dest = await pick({ defaultPath: `${baseName(note.name)}.docx`, filters: [{ name: "Word", extensions: ["docx"] }] });
    if (!dest) return;
    try {
      const out = await exportNote(note.path, dest);
      notify({ type: "success", title: t("انحفظ ملف Word"), description: out.path, action: { label: t("افتح المجلد"), onClick: () => void revealPath(out.path) } });
    } catch (e) {
      notify({ type: "error", title: t("ما قدرت أصدّر"), description: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportPdf = () => {
    setPrinting(true);
    const done = () => {
      setPrinting(false);
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    // Two frames: the print copy is in the page before the dialog reads it.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  // ── Keys ────────────────────────────────────────────────────────────────────────────────

  const switchMode = (next: Mode) => {
    void save();
    setMode(next);
    store(MODE_KEY, next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !note) return;
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        switchMode(mode === "write" ? "read" : "write");
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const headings = useMemo(() => noteHeadings(text), [text]);
  const title = headings.find((h) => h.level === 1)?.text ?? (note ? baseName(note.name) : "");
  const goToHeading = (index: number) => {
    const heading = headings[index];
    if (!heading) return;
    if (mode === "write") editor.current?.scrollToLine(heading.line);
    else readPane.current?.querySelector(`#h-${index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onImage = useCallback(
    async (file: File) => {
      if (!note) return null;
      try {
        const out = await saveNoteImage(note.path, file.name || "image.png", await readFile(file));
        return out.src;
      } catch (e) {
        notify({ type: "error", title: t("ما قدرت أحفظ الصورة"), description: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [note],
  );

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const src = await onImage(file);
      if (src) editor.current?.insert(`![${file.name.replace(/\.[^.]+$/, "")}](${encodeURI(src)})\n`);
    };
    input.click();
  };

  const tableTemplate = `| ${t("عمود")} | ${t("عمود")} |\n| --- | --- |\n|  |  |`;

  if (!note) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        {error && (
          <EmptyState icon={<IconNotebook />} title={t("ما قدرت أفتح الملاحظة")} text={error} action={onBack ? <Button onClick={onBack}>{t("رجوع")}</Button> : undefined} />
        )}
      </div>
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold" dir={wordsDir(title) ?? direction()} style={{ fontFamily: "var(--font-display)" }}>
            {title || t("بدون عنوان")}
          </p>
          <p className="flex items-center gap-2 truncate text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {note.external && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--color-surface-2)" }}>
                {t("ملف من جهازك")}
              </span>
            )}
            {note.external ? (
              <span className="truncate" dir="ltr">
                {note.path}
              </span>
            ) : (
              <span className="truncate" dir={wordsDir(note.path) ?? direction()}>
                {note.path.replace(/\.(md|markdown)$/i, "").split("/").join(" / ")}
              </span>
            )}
            <SaveStatus status={status} />
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }} role="tablist">
          {(["write", "read"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className="relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium"
              style={{ color: mode === m ? "var(--color-ink)" : "var(--color-ink-muted)" }}
              title={t("Ctrl+E للتبديل")}
            >
              {mode === m && <motion.span layoutId="note-mode" className="absolute inset-0 rounded-lg" style={{ background: "var(--color-surface)" }} transition={{ duration: 0.2 }} />}
              <span className="relative flex items-center gap-1.5">
                {m === "write" ? <IconPencil size={15} /> : <IconEye size={15} />}
                {m === "write" ? t("كتابة") : t("قراءة")}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {actions?.({ note, save: () => save() })}
          <ExportMenu onPdf={exportPdf} onWord={() => void exportWord()} />
          <HeaderButton
            label={t("فهرس العناوين")}
            active={outline}
            onClick={() => {
              setOutline((v) => !v);
              store(OUTLINE_KEY, outline ? "off" : "on");
            }}
          >
            <IconListTree size={17} />
          </HeaderButton>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {mode === "write" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            // Not clipped: the "Help me" list opens below the bar.
            className="relative z-20 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Toolbar onFormat={(c) => editor.current?.format(c)} onImage={pickImage} onAssist={(a) => void runAssist(a)} models={models} model={helper} onModel={pickModel} />
          </motion.div>
        )}
      </AnimatePresence>

      {status === "conflict" && (
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-2.5 text-sm" style={{ borderColor: "var(--color-border)", background: "color-mix(in oklch, var(--color-pending) 14%, transparent)" }}>
          <span className="flex-1">{t("الملف انعدّل من برا رفيق بعد ما فتحته. أي نسخة بدك؟")}</span>
          <Button variant="soft" onClick={() => void reloadFromDisk()}>
            {t("النسخة اللي عالجهاز")}
          </Button>
          <Button onClick={() => void save(true)}>{t("خلّي نسختي")}</Button>
        </div>
      )}
      {status === "error" && error && (
        <div className="border-b px-5 py-2 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {mode === "write" ? (
            <NoteEditor
              ref={editor}
              docKey={`${note.path}#${revision}`}
              value={text}
              onChange={onChange}
              onImage={onImage}
              placeholder={t("اكتب هون… # للعنوان، - للقائمة، [[اسم]] لرابط لملاحظة تانية")}
              fallback={direction()}
              tableTemplate={tableTemplate}
            />
          ) : (
            <div ref={readPane} className="h-full overflow-y-auto">
              <article className="mx-auto max-w-[760px] px-8 pb-[30vh] pt-7">
                <NoteView text={text} path={note.path} onOpenNote={onOpenNote ? (name) => onOpenNote(name, note) : undefined} onToggleTask={toggleTask} />
              </article>
            </div>
          )}
          <AssistPanel state={assist} onClose={() => setAssist(null)} onApply={applyAssist} notePath={note.path} />
        </div>
        <AnimatePresence initial={false}>
          {outline && headings.length > 0 && (
            <motion.nav
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 overflow-hidden border-s"
              style={{ borderColor: "var(--color-border)" }}
              aria-label={t("فهرس العناوين")}
            >
              <div className="h-full w-[220px] overflow-y-auto px-3 py-5">
                <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-ink-muted)" }}>
                  {t("العناوين")}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {headings.map((h, i) => (
                    <li key={`${h.line}:${h.text}`}>
                      <button
                        type="button"
                        onClick={() => goToHeading(i)}
                        className="w-full truncate rounded-md py-1 pe-2 text-start text-[13px] transition-colors hover:bg-[var(--color-surface-2)]"
                        style={{ paddingInlineStart: 8 + (h.level - 1) * 12, color: h.level === 1 ? "var(--color-ink)" : "var(--color-ink-muted)", fontWeight: h.level === 1 ? 600 : 400 }}
                        dir={wordsDir(h.text) ?? direction()}
                      >
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      {printing &&
        createPortal(
          <div className="note-print-root">
            <NoteView text={text} path={note.path} />
          </div>,
          document.body,
        )}
    </>
  );
}

function SaveStatus({ status }: { status: Status }) {
  const label = { saved: t("انحفظ"), dirty: t("عم يكتب…"), saving: t("عم يحفظ…"), conflict: t("انعدّل من برا"), error: t("ما انحفظ") }[status];
  const color = status === "conflict" || status === "error" ? "var(--color-danger)" : "var(--color-ink-muted)";
  return (
    <span className="flex shrink-0 items-center gap-1" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: status === "saved" ? "var(--color-success)" : color }} />
      {label}
    </span>
  );
}

export function HeaderButton({ label, onClick, children, active = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className="grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ color: active ? "var(--color-accent)" : "var(--color-ink-muted)" }}
    >
      {children}
    </button>
  );
}

function ExportMenu({ onPdf, onWord }: { onPdf: () => void; onWord: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <HeaderButton label={t("صدّر")} onClick={() => setOpen((o) => !o)}>
        <IconDownload size={17} />
      </HeaderButton>
      <AnimatePresence>
        {open && (
          <>
            <button type="button" tabIndex={-1} aria-label={t("سكّر")} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute end-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border p-1 shadow-lg"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              {[
                { label: t("PDF (طباعة ← حفظ كـ PDF)"), Icon: IconFileTypePdf, run: onPdf },
                { label: t("ملف Word"), Icon: IconFileTypeDocx, run: onWord },
              ].map(({ label, Icon, run }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    run();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  <Icon size={17} style={{ color: "var(--color-accent)" }} />
                  {label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

const ASSISTS: { action: AssistAction; label: () => string; hint: () => string }[] = [
  { action: "tidy", label: () => t("رتّب"), hint: () => t("عناوين وفقرات وقوائم، بنفس كلامك") },
  { action: "continue", label: () => t("كمّل الكتابة"), hint: () => t("من وين وقف المؤشر") },
  { action: "translate", label: () => t("ترجم النص"), hint: () => t("عربي ↔ إنجليزي") },
  { action: "shorten", label: () => t("اختصر"), hint: () => t("أقصر وأوضح") },
  { action: "fix", label: () => t("صحّح الأخطاء"), hint: () => t("إملاء وقواعد وترقيم") },
];

function Toolbar({
  onFormat,
  onImage,
  onAssist,
  models,
  model,
  onModel,
}: {
  onFormat: (c: FormatCommand) => void;
  onImage: () => void;
  onAssist: (a: AssistAction) => void;
  models: LlmModel[];
  model: LlmModel | null;
  onModel: (id: string) => void;
}) {
  const [assistOpen, setAssistOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const groups: { command: FormatCommand; label: string; Icon: typeof IconBold }[][] = [
    [
      { command: "h1", label: t("عنوان كبير"), Icon: IconH1 },
      { command: "h2", label: t("عنوان"), Icon: IconH2 },
      { command: "h3", label: t("عنوان صغير"), Icon: IconH3 },
    ],
    [
      { command: "bold", label: t("غامق (Ctrl+B)"), Icon: IconBold },
      { command: "italic", label: t("مائل (Ctrl+I)"), Icon: IconItalic },
      { command: "strike", label: t("مشطوب"), Icon: IconStrikethrough },
      { command: "code", label: t("كود"), Icon: IconCode },
      { command: "link", label: t("رابط (Ctrl+K)"), Icon: IconLink },
    ],
    [
      { command: "bullet", label: t("قائمة"), Icon: IconList },
      { command: "numbered", label: t("قائمة مرقّمة"), Icon: IconListNumbers },
      { command: "task", label: t("قائمة مهام"), Icon: IconListCheck },
      { command: "quote", label: t("اقتباس"), Icon: IconQuote },
    ],
    [
      { command: "table", label: t("جدول"), Icon: IconTable },
      { command: "codeblock", label: t("كتلة كود"), Icon: IconSourceCode },
      { command: "divider", label: t("خط فاصل"), Icon: IconSeparatorHorizontal },
    ],
  ];
  const close = () => {
    setAssistOpen(false);
    setChoosing(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1 px-4 py-1.5">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5 border-e pe-1.5 last:border-e-0" style={{ borderColor: "var(--color-border)" }}>
          {group.map(({ command, label, Icon }) => (
            <ToolButton key={command} label={label} onClick={() => onFormat(command)}>
              <Icon size={17} stroke={1.75} />
            </ToolButton>
          ))}
          {gi === groups.length - 1 && (
            <ToolButton label={t("صورة (أو الصق صورة مباشرة)")} onClick={onImage}>
              <IconPhoto size={17} stroke={1.75} />
            </ToolButton>
          )}
        </div>
      ))}
      <div className="relative ms-auto">
        <button
          type="button"
          onClick={() => (assistOpen ? close() : setAssistOpen(true))}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors"
          style={{ background: "color-mix(in oklch, var(--color-accent) 14%, transparent)", color: "var(--color-accent)" }}
          aria-expanded={assistOpen}
        >
          <IconSparkles size={16} />
          {t("ساعدني")}
        </button>
        <AnimatePresence>
          {assistOpen && (
            <>
              <button type="button" tabIndex={-1} aria-label={t("سكّر")} className="fixed inset-0 z-10 cursor-default" onClick={close} />
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute end-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-xl border p-1 shadow-lg"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                {/* Which model helps: shown, and changed from here. */}
                <button
                  type="button"
                  onClick={() => setChoosing((c) => !c)}
                  disabled={!models.length}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-default"
                  aria-expanded={choosing}
                >
                  <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                    {t("الموديل:")}
                  </span>
                  {model ? (
                    <>
                      <BrandMark provider={model.provider} className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" dir="auto">
                        {model.name}
                      </span>
                    </>
                  ) : (
                    <span className="flex-1 text-[13px]" style={{ color: "var(--color-ink-muted)" }}>
                      {t("ما في موديل — ضيف واحد من صفحة النماذج")}
                    </span>
                  )}
                  {models.length > 1 && (
                    <motion.span animate={{ rotate: choosing ? 180 : 0 }} className="flex opacity-60">
                      <IconChevronDown size={14} />
                    </motion.span>
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {choosing && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="mx-1 mb-1 max-h-52 overflow-y-auto rounded-lg"
                      style={{ background: "var(--color-surface-2)" }}
                      role="listbox"
                      aria-label={t("الموديل:")}
                    >
                      {models.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={m.id === model?.id}
                            onClick={() => {
                              onModel(m.id);
                              setChoosing(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] transition-colors hover:bg-[var(--color-border)]"
                          >
                            <BrandMark provider={m.provider} className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate" dir="auto">
                              {m.name}
                            </span>
                            {m.id === model?.id && <IconCheck size={15} style={{ color: "var(--color-accent)" }} />}
                          </button>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
                <div className="my-1 h-px" style={{ background: "var(--color-border)" }} />
                <p className="px-3 pb-1 pt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                  {t("على النص اللي محدّده، أو الملاحظة كلها")}
                </p>
                {ASSISTS.map(({ action, label, hint }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={!model}
                    onClick={() => {
                      close();
                      onAssist(action);
                    }}
                    className="flex w-full flex-col rounded-lg px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">{label()}</span>
                    <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                      {hint()}
                    </span>
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {children}
    </button>
  );
}

function AssistPanel({
  state,
  onClose,
  onApply,
  notePath,
}: {
  state: AssistState | null;
  onClose: () => void;
  onApply: (how: "replace" | "after") => void;
  notePath: string;
}) {
  const label = state ? ASSISTS.find((a) => a.action === state.action)?.label() : "";
  return (
    <AnimatePresence>
      {state && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-x-6 bottom-6 z-10 mx-auto flex max-h-[55%] max-w-[720px] flex-col overflow-hidden rounded-2xl border shadow-xl"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--color-border)" }}>
            <IconSparkles size={16} style={{ color: "var(--color-accent)" }} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {label}
              {state.model && (
                <span className="ms-2 text-xs font-normal" style={{ color: "var(--color-ink-muted)" }}>
                  {t("بـ {0}", { 0: state.model })}
                </span>
              )}
            </span>
            {state.result && (
              <>
                {state.scope !== "after" && (
                  <Button onClick={() => onApply("replace")}>{state.scope === "note" ? t("استبدل الملاحظة") : t("استبدل المحدّد")}</Button>
                )}
                <Button variant={state.scope === "after" ? "primary" : "soft"} onClick={() => onApply("after")}>
                  {state.scope === "after" ? t("ضيفه") : t("ضيفه بعده")}
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onClose}>
              {t("إلغاء")}
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            {state.error ? (
              <p className="text-sm" style={{ color: "var(--color-danger)" }}>
                {state.error}
              </p>
            ) : state.result ? (
              <NoteView text={state.result} path={notePath} />
            ) : (
              <p className="shimmer-text text-sm">{t("الموديل عم يشتغل عليها…")}</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
