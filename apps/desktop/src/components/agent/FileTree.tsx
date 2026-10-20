/**
 * Files and folders as a tree, each file with the icon its default app shows in Explorer, the
 * current path highlighted, folders folding open. (After the "File Tree" component on
 * 21st.dev, written for Rafiq.)
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { systemFileIcon } from "../../lib/fileIcons";

/** Extension → [badge text, colour]: the fallback where the OS has no icon (the Vite preview). */
const KINDS: Record<string, [string, string]> = {
  ts: ["TS", "#3178c6"],
  tsx: ["TSX", "#3178c6"],
  js: ["JS", "#e3b341"],
  jsx: ["JSX", "#e3b341"],
  mjs: ["JS", "#e3b341"],
  cjs: ["JS", "#e3b341"],
  json: ["{ }", "#a1a1aa"],
  py: ["PY", "#3b82c4"],
  rs: ["RS", "#dea584"],
  go: ["GO", "#00add8"],
  java: ["JV", "#e76f00"],
  kt: ["KT", "#a97bff"],
  swift: ["SW", "#f05138"],
  cs: ["C#", "#68217a"],
  cpp: ["C++", "#00599c"],
  c: ["C", "#555555"],
  rb: ["RB", "#cc342d"],
  php: ["PHP", "#777bb4"],
  html: ["<>", "#e34c26"],
  css: ["CSS", "#2965f1"],
  scss: ["SCSS", "#c6538c"],
  md: ["MD", "#7d8590"],
  yml: ["YML", "#cb171e"],
  yaml: ["YML", "#cb171e"],
  toml: ["TOML", "#9c4221"],
  sql: ["SQL", "#e38c00"],
  sh: ["SH", "#4eaa25"],
  ps1: ["PS", "#5391fe"],
  svg: ["SVG", "#ffb13b"],
  png: ["IMG", "#a855f7"],
  jpg: ["IMG", "#a855f7"],
  jpeg: ["IMG", "#a855f7"],
  webp: ["IMG", "#a855f7"],
  gif: ["IMG", "#a855f7"],
  pdf: ["PDF", "#d93025"],
  docx: ["DOC", "#2b579a"],
  xlsx: ["XLS", "#217346"],
  pptx: ["PPT", "#d24726"],
  csv: ["CSV", "#217346"],
  txt: ["TXT", "#7d8590"],
  lock: ["LCK", "#7d8590"],
};

export function FileGlyph({ name, folder = false, open = false }: { name: string; folder?: boolean; open?: boolean }) {
  if (folder) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden fill={open ? "var(--color-accent)" : "none"} stroke="var(--color-accent)" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fillOpacity={open ? 0.25 : 0} />
      </svg>
    );
  }
  return <SystemIcon name={name} />;
}

/** The icon of the file's default app, as Explorer shows it; a language badge until it loads. */
function SystemIcon({ name }: { name: string }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setIcon(null);
    systemFileIcon(name).then((url) => alive && setIcon(url));
    return () => {
      alive = false;
    };
  }, [name]);
  if (icon) return <img src={icon} alt="" className="h-4 w-4 shrink-0" draggable={false} />;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const [text, color] = KINDS[ext] ?? ["·", "#7d8590"];
  return (
    <span
      aria-hidden
      className="inline-grid h-4 min-w-4 shrink-0 place-items-center rounded px-0.5 font-mono text-[7.5px] font-bold leading-none text-white"
      style={{ background: color }}
    >
      {text}
    </span>
  );
}

interface Node {
  name: string;
  path: string;
  children?: Node[];
}

/** Paths ("src/app/main.ts") → a tree, folders first, then files, each by name. */
export function buildTree(paths: string[]): Node[] {
  const root: Node = { name: "", path: "", children: [] };
  for (const full of paths) {
    const parts = full.replace(/\\/g, "/").split("/").filter(Boolean);
    let at = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const leaf = i === parts.length - 1 && !full.endsWith("/");
      let next = at.children!.find((c) => c.name === part);
      if (!next) {
        next = { name: part, path, children: leaf ? undefined : [] };
        at.children!.push(next);
      }
      at = next;
    });
  }
  const sort = (nodes: Node[]): Node[] =>
    nodes
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name));
  return sort(root.children!);
}

/** The files in the order the tree shows them (folders first, then by name). */
export function treeOrder(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (nodes: Node[]) => nodes.forEach((n) => (n.children ? walk(n.children) : out.push(n.path)));
  walk(buildTree(paths));
  return out;
}

/**
 * `paths` are the files to show (folders come from them). `selected` is highlighted with
 * the folders on its way open; `onPick` makes files clickable.
 */
export function FileTree({ paths, selected, onPick, openDepth = 1 }: { paths: string[]; selected?: string | null; onPick?: (path: string) => void; openDepth?: number }) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const onWay = (path: string) => Boolean(selected && (selected === path || selected.startsWith(`${path}/`)));

  function render(nodes: Node[], depth: number) {
    return nodes.map((n) => {
      const isFolder = Boolean(n.children);
      const defaultOpen = depth < openDepth || onWay(n.path);
      const open = toggled.has(n.path) ? !defaultOpen : defaultOpen;
      const active = selected === n.path;
      return (
        <li key={n.path}>
          <button
            type="button"
            onClick={() =>
              isFolder ? setToggled((s) => (s.has(n.path) ? new Set([...s].filter((x) => x !== n.path)) : new Set([...s, n.path]))) : onPick?.(n.path)
            }
            aria-expanded={isFolder ? open : undefined}
            aria-current={active ? "true" : undefined}
            disabled={!isFolder && !onPick}
            className="flex w-full items-center gap-1.5 rounded-md py-1 pe-2 text-start font-mono text-xs transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-default"
            style={{
              paddingInlineStart: 6 + depth * 14,
              background: active ? "color-mix(in oklch, var(--color-accent) 16%, transparent)" : undefined,
              color: active ? "var(--color-ink)" : isFolder ? "var(--color-ink)" : "var(--color-ink-muted)",
            }}
          >
            {isFolder ? (
              <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="w-2.5 text-[8px]">
                ▶
              </motion.span>
            ) : (
              <span className="w-2.5" />
            )}
            <FileGlyph name={n.name} folder={isFolder} open={open} />
            <span className="min-w-0 truncate">{n.name}</span>
          </button>
          {isFolder && (
            <AnimatePresence initial={false}>
              {open && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  {render(n.children!, depth + 1)}
                </motion.ul>
              )}
            </AnimatePresence>
          )}
        </li>
      );
    });
  }

  return (
    <ul role="tree" dir="ltr" className="flex flex-col">
      {render(tree, 0)}
    </ul>
  );
}
