/**
 * Notes: the user's own Markdown notes, written and read inside Rafiq with Arabic and
 * English laid out properly side by side. Each note is a `.md` file in the notes folder
 * (Settings → General), saved as it's typed. The list sits beside the note being written
 * (NoteWorkspace); a `.md` file from anywhere on the machine opens here too ("Open with →
 * Rafiq"), or alone in the light window (LiteNote).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { IconMessageCircle, IconNotebook } from "@tabler/icons-react";
import { moveNote, newNote, newNotesFolder, noteMention, notesTree, pinNote, trashNote, type NoteEntry, type NoteFile, type NotesTree } from "../../lib/api";
import { NotesSidebar } from "./NotesSidebar";
import { baseName, HeaderButton, isDesktop, NoteWorkspace } from "./NoteWorkspace";
import { Button, EmptyState } from "../../components/ui";
import { wordsDir } from "../../lib/noteBidi";
import { queueChatMessage } from "../../lib/handoff";
import { revealPath } from "../../lib/folders";
import { notify } from "../../lib/toast";
import { direction, t } from "../../i18n";

function folderOf(path: string): string {
  return path.includes("/") && !/^[a-zA-Z]:[\\/]/.test(path) && !path.startsWith("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export default function NotesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const path = params.get("path");

  const [tree, setTree] = useState<NotesTree | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; value: string; onDone: (value: string) => void } | null>(null);
  // A note just made opens with the cursor in it.
  const fresh = useRef<string | null>(null);

  const loadTree = useCallback(() => {
    notesTree()
      .then(setTree)
      .catch(() => setTree((prev) => prev));
  }, []);

  useEffect(loadTree, [loadTree]);
  useEffect(() => {
    window.addEventListener("focus", loadTree);
    return () => window.removeEventListener("focus", loadTree);
  }, [loadTree]);

  const open = useCallback(
    (next: string | null) => {
      setParams(next ? { path: next } : {}, { replace: false });
    },
    [setParams],
  );

  const createNote = async (folder: string, title = t("ملاحظة جديدة"), content = "") => {
    try {
      const made = await newNote({ folder, title, content });
      loadTree();
      fresh.current = made.path;
      open(made.path);
    } catch (e) {
      notify({ type: "error", title: t("ما قدرت أعمل الملاحظة"), description: e instanceof Error ? e.message : String(e) });
    }
  };

  // Ctrl+K → "New note" lands here with ?new=1.
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (wantsNew) void createNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew]);

  const ask = (title: string, value: string, onDone: (value: string) => void) => setPrompt({ title, value, onDone });

  const actions = {
    open: (p: string) => open(p),
    newNote: (folder: string) => void createNote(folder),
    newFolder: (parent: string) =>
      ask(t("اسم المجلد الجديد"), "", (name) => {
        newNotesFolder(parent ? `${parent}/${name}` : name)
          .then(loadTree)
          .catch((e) => notify({ type: "error", title: t("ما قدرت أعمل المجلد"), description: String(e?.message ?? e) }));
      }),
    openFile: async () => {
      if (!(await isDesktop())) {
        notify({ type: "info", title: t("فتح الملفات بيشتغل بالتطبيق المثبّت") });
        return;
      }
      const { open: pick } = await import("@tauri-apps/plugin-dialog");
      const picked = await pick({ multiple: false, filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }], title: t("افتح ملف Markdown") });
      if (typeof picked === "string") open(picked);
    },
    rename: (entry: NoteEntry) =>
      ask(t("الاسم الجديد (اكتب مجلد/اسم لتنقلها)"), entry.kind === "note" ? entry.path.replace(/\.(md|markdown)$/i, "") : entry.path, (value) => {
        moveNote(entry.path, value)
          .then((out) => {
            loadTree();
            if (path === entry.path) open(out.path);
            else if (path?.startsWith(`${entry.path}/`)) open(out.path + path.slice(entry.path.length));
          })
          .catch((e) => notify({ type: "error", title: t("ما قدرت أغيّر الاسم"), description: String(e?.message ?? e) }));
      }),
    remove: (entry: NoteEntry) => {
      trashNote(entry.path)
        .then(() => {
          loadTree();
          if (path === entry.path || path?.startsWith(`${entry.path}/`)) open(null);
          notify({ type: "success", title: entry.kind === "dir" ? t("انحذف المجلد") : t("انحذفت الملاحظة"), description: t("لسا موجودة بسلة الملاحظات، جوا مجلد الملاحظات.") });
        })
        .catch((e) => notify({ type: "error", title: t("ما قدرت أحذف"), description: String(e?.message ?? e) }));
    },
    pin: (p: string, pinned: boolean) => {
      pinNote(p, pinned)
        .then((out) => setTree((prev) => (prev ? { ...prev, pinned: out.pinned } : prev)))
        .catch(() => undefined);
    },
    move: (from: string, folder: string) => {
      const name = from.split("/").pop() ?? from;
      moveNote(from, folder ? `${folder}/${name}` : name)
        .then((out) => {
          loadTree();
          if (path === from) open(out.path);
          else if (path?.startsWith(`${from}/`)) open(out.path + path.slice(from.length));
        })
        .catch((e) => notify({ type: "error", title: t("ما قدرت أنقلها"), description: String(e?.message ?? e) }));
    },
    reveal: async (p: string) => {
      const full = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") ? p : `${tree?.root ?? ""}\\${p.replace(/\//g, "\\")}`;
      if (!(await revealPath(full))) notify({ type: "info", title: full });
    },
  };

  // `[[name]]` opens the note with that name or title, or starts it.
  const openByName = (name: string, from: NoteFile) => {
    const wanted = name.trim().toLowerCase();
    const found = tree?.items.find((e) => e.kind === "note" && (baseName(e.path).toLowerCase() === wanted || e.title.toLowerCase() === wanted || e.path.toLowerCase() === wanted));
    if (found) open(found.path);
    else void createNote(from.external ? "" : folderOf(from.path), name.trim(), `# ${name.trim()}\n\n`);
  };

  const askInChat = async (note: NoteFile, save: () => Promise<void>) => {
    await save();
    queueChatMessage(note.external ? `${note.content.slice(0, 20000)}\n\n` : `${noteMention(note.path)} `);
    navigate("/chat");
  };

  return (
    <div className="flex h-full min-h-0">
      <NotesSidebar tree={tree} current={path} actions={actions} />

      <section className="flex min-w-0 flex-1 flex-col">
        {path ? (
          <NoteWorkspace
            key={path}
            path={path}
            onSaved={loadTree}
            onOpenNote={openByName}
            onBack={() => open(null)}
            focusOnLoad={fresh.current === path}
            actions={({ note, save }) => (
              <HeaderButton label={t("اسأل عنها بالمحادثة")} onClick={() => void askInChat(note, save)}>
                <IconMessageCircle size={17} />
              </HeaderButton>
            )}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <div className="w-full max-w-md">
              <EmptyState
                icon={<IconNotebook />}
                title={t("اكتب أفكارك، بالعربي والإنجليزي سوا")}
                text={t("كل ملاحظة ملف Markdown بمجلدك. كل سطر بياخد اتجاهه من كلامه، والكلمات الإنجليزية جوّا الجملة العربية بتضل بمحلها.")}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => void createNote("")}>{t("ملاحظة جديدة")}</Button>
                    <Button variant="soft" onClick={() => void actions.openFile()}>
                      {t("افتح ملف Markdown")}
                    </Button>
                  </div>
                }
              />
            </div>
          </div>
        )}
      </section>

      {prompt && <NamePrompt {...prompt} onClose={() => setPrompt(null)} />}
    </div>
  );
}

function NamePrompt({ title, value, onDone, onClose }: { title: string; value: string; onDone: (value: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = () => {
    if (!text.trim()) return;
    onDone(text.trim());
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <button type="button" tabIndex={-1} aria-label={t("إلغاء")} className="absolute inset-0 cursor-default" style={{ background: "color-mix(in oklch, black 40%, transparent)" }} onClick={onClose} />
      <motion.form
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="relative w-full max-w-sm rounded-2xl border p-5 shadow-xl"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="mb-3 text-sm font-semibold">{title}</p>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          dir={text ? (wordsDir(text) ?? direction()) : direction()}
          className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg, var(--color-surface-2))" }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("إلغاء")}
          </Button>
          <Button type="submit" disabled={!text.trim()}>
            {t("تمام")}
          </Button>
        </div>
      </motion.form>
    </div>
  );
}
