/**
 * The notes list: one button to start writing, search across every note, the pinned ones
 * on top, then folders and notes as a tree. A note shows its first line under its title.
 * Notes and folders drag onto a folder (or the "All notes" heading) to move; each row has
 * a ⋯ button with the same actions as its right-click menu.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  IconChevronDown,
  IconClockHour4,
  IconDots,
  IconFileImport,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconPin,
  IconPlus,
  IconSearch,
  IconSortAscendingLetters,
  IconX,
} from "@tabler/icons-react";
import { searchNotes, type NoteEntry, type NoteHit, type NotesTree } from "../../lib/api";
import { useElementMenu, SEPARATOR, type MenuEntry } from "../../components/ContextMenu";
import { FolderIcon, PencilIcon, PinIcon, TrashIcon, ExternalIcon } from "../../components/Icons";
import { wordsDir } from "../../lib/noteBidi";
import { timeAgo } from "../../lib/time";
import { direction, t } from "../../i18n";

export interface SidebarActions {
  open: (path: string) => void;
  newNote: (folder: string) => void;
  newFolder: (parent: string) => void;
  openFile: () => void;
  rename: (entry: NoteEntry) => void;
  remove: (entry: NoteEntry) => void;
  pin: (path: string, pinned: boolean) => void;
  reveal: (path: string) => void;
  /** Moves a note or folder into `folder` ("" = the top of the notes). */
  move: (path: string, folder: string) => void;
}

interface Node {
  entry: NoteEntry;
  children: Node[];
}

type Sort = "recent" | "name";

const COLLAPSED_KEY = "rafiq-notes-collapsed";
const SORT_KEY = "rafiq-notes-sort";
const DRAG_TYPE = "application/x-rafiq-note";

function stored<T>(key: string, read: (raw: string) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : read(raw);
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // a convenience only
  }
}

const collator = new Intl.Collator(["ar", "en"], { numeric: true, sensitivity: "base" });

/** The newest note anywhere inside a folder, for sorting folders by "recent". */
function newest(node: Node): number {
  return node.entry.kind === "note" ? node.entry.mtime : Math.max(node.entry.mtime, ...node.children.map(newest));
}

function noteCount(node: Node): number {
  return node.entry.kind === "note" ? 1 : node.children.reduce((sum, c) => sum + noteCount(c), 0);
}

function buildTree(items: NoteEntry[], sort: Sort): Node[] {
  const byPath = new Map<string, Node>();
  const roots: Node[] = [];
  for (const entry of items) byPath.set(entry.path, { entry, children: [] });
  for (const node of byPath.values()) {
    const parent = node.entry.path.includes("/") ? node.entry.path.slice(0, node.entry.path.lastIndexOf("/")) : "";
    (parent && byPath.get(parent) ? byPath.get(parent)!.children : roots).push(node);
  }
  const order = (nodes: Node[]) => {
    nodes.sort((a, b) => {
      if (a.entry.kind !== b.entry.kind) return a.entry.kind === "dir" ? -1 : 1;
      return sort === "recent" ? newest(b) - newest(a) : collator.compare(a.entry.title, b.entry.title);
    });
    nodes.forEach((n) => order(n.children));
  };
  order(roots);
  return roots;
}

function textDir(text: string): "rtl" | "ltr" {
  return wordsDir(text) ?? direction();
}

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Opens the row's right-click menu under its ⋯ button. */
function openRowMenu(event: React.MouseEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom + 4 }));
}

export function NotesSidebar({ tree, current, actions }: { tree: NotesTree | null; current: string | null; actions: SidebarActions }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(stored(COLLAPSED_KEY, (raw) => JSON.parse(raw) as string[], [])));
  const [sort, setSort] = useState<Sort>(() => stored<Sort>(SORT_KEY, (raw) => (raw === "name" ? "name" : "recent"), "recent"));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const menu = useElementMenu();

  const nodes = useMemo(() => buildTree(tree?.items ?? [], sort), [tree, sort]);
  const byPath = useMemo(() => new Map((tree?.items ?? []).map((e) => [e.path, e])), [tree]);
  const pinned = (tree?.pinned ?? []).map((p) => byPath.get(p)).filter((e): e is NoteEntry => Boolean(e && e.kind === "note"));
  const total = (tree?.items ?? []).filter((e) => e.kind === "note").length;

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      searchNotes(q)
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  // A note opened from a link or a search shows inside its folders.
  useEffect(() => {
    if (!current) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (let at = current.lastIndexOf("/"); at > 0; at = current.lastIndexOf("/", at - 1)) {
        if (next.delete(current.slice(0, at))) changed = true;
      }
      return changed ? next : prev;
    });
  }, [current]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      store(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });

  const changeSort = () => {
    const next: Sort = sort === "recent" ? "name" : "recent";
    setSort(next);
    store(SORT_KEY, next);
  };

  const isPinned = (path: string) => (tree?.pinned ?? []).includes(path);

  const noteMenu = (entry: NoteEntry): MenuEntry[] => [
    { id: "pin", label: isPinned(entry.path) ? t("إلغاء التثبيت") : t("ثبّت فوق"), Icon: PinIcon, onSelect: () => actions.pin(entry.path, !isPinned(entry.path)) },
    { id: "rename", label: t("غيّر الاسم أو انقل"), Icon: PencilIcon, onSelect: () => actions.rename(entry) },
    { id: "reveal", label: t("أظهر بالمستكشف"), Icon: ExternalIcon, onSelect: () => actions.reveal(entry.path) },
    SEPARATOR,
    { id: "trash", label: t("احذف (بتنحط بسلة الملاحظات)"), Icon: TrashIcon, danger: true, onSelect: () => actions.remove(entry) },
  ];
  const folderMenu = (entry: NoteEntry): MenuEntry[] => [
    { id: "new", label: t("ملاحظة جديدة هون"), Icon: PencilIcon, onSelect: () => actions.newNote(entry.path) },
    { id: "folder", label: t("مجلد جوّاه"), Icon: FolderIcon, onSelect: () => actions.newFolder(entry.path) },
    { id: "rename", label: t("غيّر الاسم أو انقل"), Icon: PencilIcon, onSelect: () => actions.rename(entry) },
    { id: "reveal", label: t("أظهر بالمستكشف"), Icon: ExternalIcon, onSelect: () => actions.reveal(entry.path) },
    SEPARATOR,
    { id: "trash", label: t("احذف المجلد مع ملاحظاته"), Icon: TrashIcon, danger: true, onSelect: () => actions.remove(entry) },
  ];

  // ── Dragging into folders ───────────────────────────────────────────────────────────────

  const dragProps = (path: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragged.current = path;
      e.dataTransfer.setData(DRAG_TYPE, path);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      dragged.current = null;
      setDropTarget(null);
    },
  });

  const canDrop = (folder: string) => {
    const from = dragged.current;
    if (from === null) return false;
    // Not where it already is, and a folder never into itself.
    return parentOf(from) !== folder && folder !== from && !folder.startsWith(`${from}/`);
  };

  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop(folder)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== folder) setDropTarget(folder);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropTarget((d) => (d === folder ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      const from = e.dataTransfer.getData(DRAG_TYPE) || dragged.current;
      setDropTarget(null);
      if (!from || !canDrop(folder)) return;
      e.preventDefault();
      e.stopPropagation();
      actions.move(from, folder);
    },
  });

  function renderNodes(list: Node[], depth: number) {
    return list.map((node) => {
      const { entry, children } = node;
      if (entry.kind === "dir") {
        const open = !collapsed.has(entry.path);
        const count = noteCount(node);
        const dropping = dropTarget === entry.path;
        return (
          <li key={entry.path} {...dropProps(entry.path)}>
            <div
              {...dragProps(entry.path)}
              onContextMenu={menu(() => folderMenu(entry))}
              className="group relative flex items-center rounded-xl transition-colors hover:bg-[var(--color-surface-2)]"
              style={{
                marginInlineStart: depth * 14,
                background: dropping ? "color-mix(in oklch, var(--color-accent) 16%, transparent)" : undefined,
                outline: dropping ? "1.5px dashed var(--color-accent)" : undefined,
              }}
            >
              <button type="button" onClick={() => toggle(entry.path)} className="flex min-w-0 flex-1 items-center gap-2 py-2 ps-2 text-start" aria-expanded={open}>
                <motion.span animate={{ rotate: open ? 0 : direction() === "rtl" ? 90 : -90 }} transition={{ duration: 0.15 }} className="flex opacity-50">
                  <IconChevronDown size={14} />
                </motion.span>
                {open ? (
                  <IconFolderOpen size={18} stroke={1.6} style={{ color: "var(--color-accent)" }} className="shrink-0" />
                ) : (
                  <IconFolder size={18} stroke={1.6} style={{ color: "var(--color-accent)" }} className="shrink-0" />
                )}
                <span className="min-w-0 truncate text-[13.5px] font-semibold" dir={textDir(entry.name)}>
                  {entry.name}
                </span>
              </button>
              <span className="me-2.5 text-[11px] tabular-nums group-hover:hidden" style={{ color: "var(--color-ink-muted)" }}>
                {count}
              </span>
              <span className="me-1 hidden items-center group-hover:flex">
                <RowButton label={t("ملاحظة جديدة هون")} onClick={() => actions.newNote(entry.path)}>
                  <IconPlus size={15} />
                </RowButton>
                <RowButton label={t("خيارات")} onClick={openRowMenu}>
                  <IconDots size={15} />
                </RowButton>
              </span>
            </div>
            <AnimatePresence initial={false}>
              {open && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  {children.length ? (
                    renderNodes(children, depth + 1)
                  ) : (
                    <li className="py-1.5 text-[12px]" style={{ paddingInlineStart: 44 + depth * 14, color: "var(--color-ink-muted)" }}>
                      {t("فاضي — اسحب ملاحظة لهون")}
                    </li>
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
          </li>
        );
      }
      return (
        <li key={entry.path}>
          <NoteRow
            entry={entry}
            depth={depth}
            active={entry.path === current}
            pinned={isPinned(entry.path)}
            onOpen={() => actions.open(entry.path)}
            onMenu={menu(() => noteMenu(entry))}
            drag={dragProps(entry.path)}
          />
        </li>
      );
    });
  }

  return (
    <aside className="flex h-full w-[288px] shrink-0 flex-col border-e" style={{ borderColor: "var(--color-border)", background: "color-mix(in oklch, var(--color-surface) 55%, transparent)" }}>
      <div className="px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-baseline gap-2 text-[22px] font-extrabold leading-none" style={{ fontFamily: "var(--font-display)" }}>
            {t("ملاحظات")}
            {total > 0 && (
              <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
                {total}
              </span>
            )}
          </h1>
          <div className="flex items-center">
            <IconButton label={t("مجلد جديد")} onClick={() => actions.newFolder("")}>
              <IconFolderPlus size={18} stroke={1.6} />
            </IconButton>
            <IconButton label={t("افتح ملف Markdown من جهازك")} onClick={actions.openFile}>
              <IconFileImport size={18} stroke={1.6} />
            </IconButton>
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => actions.newNote("")}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-[filter] hover:brightness-110"
          style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}
        >
          <IconPlus size={17} stroke={2.2} />
          {t("ملاحظة جديدة")}
        </motion.button>

        <label className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--color-surface-2)" }}>
          <IconSearch size={15} stroke={1.8} style={{ color: "var(--color-ink-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("دوّر بالملاحظات…")}
            dir={query ? textDir(query) : direction()}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            aria-label={t("دوّر بالملاحظات…")}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("امسح البحث")} className="opacity-60 hover:opacity-100">
              <IconX size={14} />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {hits ? (
          <>
            <SectionLabel>{hits.length ? t("{0} نتيجة", { 0: hits.length }) : t("ما في ملاحظة فيها هالكلام")}</SectionLabel>
            <ul className="flex flex-col gap-0.5">
              {hits.map((hit) => (
                <li key={`${hit.path}:${hit.line}`}>
                  <button
                    type="button"
                    onClick={() => actions.open(hit.path)}
                    className="w-full rounded-xl px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                    style={{ background: hit.path === current ? "color-mix(in oklch, var(--color-accent) 13%, transparent)" : undefined }}
                  >
                    <span className="block truncate text-[13.5px] font-semibold" dir={textDir(hit.title)}>
                      {hit.title}
                    </span>
                    {hit.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir={textDir(hit.snippet)}>
                        {hit.snippet}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="mb-3">
                <SectionLabel>
                  <IconPin size={12} />
                  {t("مثبّتة")}
                </SectionLabel>
                <ul className="flex flex-col gap-0.5">
                  {pinned.map((entry) => (
                    <li key={`pin:${entry.path}`}>
                      <NoteRow entry={entry} depth={0} active={entry.path === current} pinned onOpen={() => actions.open(entry.path)} onMenu={menu(() => noteMenu(entry))} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div
              {...dropProps("")}
              className="flex items-center justify-between rounded-lg pe-1"
              style={{
                outline: dropTarget === "" ? "1.5px dashed var(--color-accent)" : undefined,
                background: dropTarget === "" ? "color-mix(in oklch, var(--color-accent) 12%, transparent)" : undefined,
              }}
            >
              <SectionLabel>{t("كل الملاحظات")}</SectionLabel>
              {total > 1 && (
                <button
                  type="button"
                  onClick={changeSort}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
                  style={{ color: "var(--color-ink-muted)" }}
                  title={t("الترتيب")}
                >
                  {sort === "recent" ? <IconClockHour4 size={13} /> : <IconSortAscendingLetters size={13} />}
                  {sort === "recent" ? t("الأحدث") : t("بالاسم")}
                </button>
              )}
            </div>

            {nodes.length === 0 ? (
              <div className="mx-2 mt-2 rounded-2xl px-4 py-6 text-center" style={{ background: "var(--color-surface-2)" }}>
                <p className="text-sm font-semibold">{t("لسا ما في ملاحظات")}</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                  {t("اكتب أول وحدة، أو اعمل مجلد ترتّب فيه.")}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">{renderNodes(nodes, 0)}</ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 text-[11px] font-semibold" style={{ color: "var(--color-ink-muted)" }}>
      {children}
    </p>
  );
}

function NoteRow({
  entry,
  depth,
  active,
  pinned,
  onOpen,
  onMenu,
  drag,
}: {
  entry: NoteEntry;
  depth: number;
  active: boolean;
  pinned: boolean;
  onOpen: () => void;
  onMenu: (event: React.MouseEvent) => void;
  drag?: { draggable: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
}) {
  return (
    <div
      {...drag}
      onContextMenu={onMenu}
      className="group relative flex items-start rounded-xl transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ marginInlineStart: depth * 14, background: active ? "color-mix(in oklch, var(--color-accent) 13%, transparent)" : undefined }}
    >
      {active && <span className="absolute inset-y-2 start-0 w-[3px] rounded-full" style={{ background: "var(--color-accent)" }} />}
      <button type="button" onClick={onOpen} aria-current={active ? "page" : undefined} className="min-w-0 flex-1 py-2 pe-1 ps-3 text-start">
        <span className="flex items-center gap-1.5">
          {pinned && <IconPin size={11} className="shrink-0 opacity-60" />}
          <span className="truncate text-[13.5px]" style={{ fontWeight: active ? 700 : 600 }} dir={textDir(entry.title)}>
            {entry.title}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--color-ink-muted)" }}>
          <span className="shrink-0 tabular-nums">{timeAgo(new Date(entry.mtime * 1000).toISOString())}</span>
          {entry.excerpt && (
            <>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <span className="min-w-0 truncate" dir={textDir(entry.excerpt)}>
                {entry.excerpt}
              </span>
            </>
          )}
        </span>
      </button>
      <span className="me-1 mt-1.5 hidden group-hover:flex">
        <RowButton label={t("خيارات")} onClick={openRowMenu}>
          <IconDots size={15} />
        </RowButton>
      </span>
    </div>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-lg transition-colors hover:bg-[var(--color-surface)]"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {children}
    </button>
  );
}
