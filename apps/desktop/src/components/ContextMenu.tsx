import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { easeOutExpo } from "../lib/motion";

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  Icon?: (props: { className?: string; style?: React.CSSProperties }) => React.ReactElement;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** Draws a divider between groups. */
export const SEPARATOR = "separator" as const;
export type MenuEntry = MenuItem | typeof SEPARATOR;

interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

interface ContextMenuApi {
  /** An element contributes its own items for the right-click happening right now. */
  contribute: (entries: MenuEntry[]) => void;
  setPageEntries: (entries: MenuEntry[]) => void;
}

const Api = createContext<ContextMenuApi | null>(null);

const isItem = (entry: MenuEntry): entry is MenuItem => entry !== SEPARATOR;

/** Clipboard actions, so replacing the native menu doesn't take copy/paste away. */
function editingEntries(target: HTMLElement | null, selection: string): MenuEntry[] {
  const field = target?.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
  const entries: MenuEntry[] = [];

  if (selection) {
    entries.push({
      id: "copy",
      label: "نسخ",
      hint: "Ctrl+C",
      onSelect: () => void navigator.clipboard.writeText(selection),
    });
  }
  if (field && !field.readOnly) {
    if (selection) {
      entries.push({
        id: "cut",
        label: "قص",
        hint: "Ctrl+X",
        onSelect: () => {
          void navigator.clipboard.writeText(selection);
          field.focus();
          document.execCommand("delete");
        },
      });
    }
    entries.push({
      id: "paste",
      label: "لصق",
      hint: "Ctrl+V",
      onSelect: async () => {
        const text = await navigator.clipboard.readText().catch(() => "");
        if (!text) return;
        field.focus();
        document.execCommand("insertText", false, text);
      },
    });
  }
  if (field) {
    entries.push({
      id: "select-all",
      label: "اختيار الكل",
      hint: "Ctrl+A",
      onSelect: () => {
        field.focus();
        field.select();
      },
    });
  }
  return entries;
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pageEntries = useRef<MenuEntry[]>([]);
  const pending = useRef<MenuEntry[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const contribute = useCallback((entries: MenuEntry[]) => {
    pending.current = entries;
  }, []);
  const setPageEntries = useCallback((entries: MenuEntry[]) => {
    pageEntries.current = entries;
  }, []);
  const api = useMemo(() => ({ contribute, setPageEntries }), [contribute, setPageEntries]);

  // One handler for the whole window: it suppresses the webview's own menu (so no
  // "Inspect") and assembles ours from the element's items, the clipboard items, and
  // whatever the current page registered.
  useEffect(() => {
    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const selection = window.getSelection()?.toString().trim() ?? "";
      const fromElement = pending.current;
      pending.current = [];

      const entries: MenuEntry[] = [];
      for (const group of [fromElement, editingEntries(target, selection), pageEntries.current]) {
        if (!group.length) continue;
        if (entries.length) entries.push(SEPARATOR);
        entries.push(...group);
      }
      if (!entries.length) return;
      setActive(0);
      setOffset({ x: 0, y: 0 });
      setMenu({ x: event.clientX, y: event.clientY, entries });
    }

    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const items = menu.entries.filter(isItem).filter((e) => !e.disabled);
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[active]?.onSelect();
        close();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, active]);

  // Keep the menu inside the window.
  useEffect(() => {
    if (!menu || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const overflowX = menu.x + box.width - window.innerWidth + 8;
    const overflowY = menu.y + box.height - window.innerHeight + 8;
    setOffset({ x: overflowX > 0 ? -box.width : 0, y: overflowY > 0 ? -box.height : 0 });
  }, [menu]);

  let index = -1;

  return (
    <Api.Provider value={api}>
      {children}
      {createPortal(
        <AnimatePresence>
          {menu && (
            <motion.div
              ref={ref}
              role="menu"
              initial={{ opacity: 0, scale: 0.97, y: -2 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14, ease: easeOutExpo }}
              onMouseDown={(e) => e.stopPropagation()}
              className="fixed min-w-44 max-w-72 overflow-hidden rounded-xl border p-1 shadow-2xl"
              style={{
                left: menu.x + offset.x,
                top: menu.y + offset.y,
                zIndex: "var(--z-index-modal)" as unknown as number,
                borderColor: "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              {menu.entries.map((entry, i) => {
                if (!isItem(entry)) {
                  return <span key={`sep-${i}`} className="my-1 block h-px" style={{ background: "var(--color-border)" }} />;
                }
                if (!entry.disabled) index += 1;
                const current = index;
                return (
                  <button
                    key={entry.id}
                    role="menuitem"
                    disabled={entry.disabled}
                    onMouseEnter={() => !entry.disabled && setActive(current)}
                    onClick={() => {
                      entry.onSelect();
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm transition-colors disabled:opacity-40"
                    style={{
                      background: current === active && !entry.disabled ? "var(--color-surface-2)" : "transparent",
                      color: entry.danger ? "var(--color-danger)" : "var(--color-ink)",
                    }}
                  >
                    {entry.Icon && <entry.Icon className="h-4 w-4 shrink-0" style={{ color: entry.danger ? "var(--color-danger)" : "var(--color-ink-muted)" }} />}
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.hint && (
                      <span className="shrink-0 font-mono text-[10px]" dir="ltr" style={{ color: "var(--color-ink-muted)" }}>
                        {entry.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </Api.Provider>
  );
}

/** Items for the page the user is on; they sit under the element's own items. */
export function usePageMenu(build: () => MenuEntry[]): void {
  const api = useContext(Api);
  const latest = useRef(build);
  latest.current = build;

  useEffect(() => {
    api?.setPageEntries(latest.current());
  });

  useEffect(() => () => api?.setPageEntries([]), [api]);
}

/**
 * Items for one element. Attach the returned handler:
 * `<li onContextMenu={menu(() => [...])}>` — the global handler merges them with the
 * clipboard and page items.
 */
export function useElementMenu(): (build: () => MenuEntry[]) => (event: React.MouseEvent) => void {
  const api = useContext(Api);
  return useCallback(
    (build: () => MenuEntry[]) => (event: React.MouseEvent) => {
      // Deliberately no stopPropagation — the window handler still runs and adds the
      // clipboard and page groups on top of these.
      void event;
      api?.contribute(build());
    },
    [api],
  );
}
