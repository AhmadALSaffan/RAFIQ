/**
 * The rendered note, with the same direction rules as the editor (lib/noteBidi.ts): every
 * paragraph, heading, list item and table cell takes its direction from its own words, a
 * list or table from most of its items, and each phrase in the other language becomes an
 * isolated <bdi> inside it. Headings also get ids (`h-0`, `h-1`…) for the outline.
 *
 * Works on the HTML tree react-markdown builds (hast), typed loosely here.
 */

import { isolatedRuns, wordsDir, type Dir } from "./noteBidi";

interface HText {
  type: "text";
  value: string;
}
interface HElement {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HNode[];
}
type HNode = HText | HElement | { type: "comment" | "raw" | "doctype"; value?: string };
interface HRoot {
  type: "root";
  children: HNode[];
}

const TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "dt", "dd", "summary", "figcaption"]);
const CONTAINERS = new Set(["ul", "ol", "blockquote", "table", "dl", "details"]);
const BLOCK_CHILDREN = new Set(["p", "ul", "ol", "blockquote", "pre", "table", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "dl", "details"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const isElement = (n: HNode): n is HElement => n.type === "element";

function textOf(node: HNode, skipBlocks = false): string {
  if (node.type === "text") return node.value;
  if (!isElement(node)) return "";
  if (node.tagName === "pre" || node.tagName === "code") return " ";
  if (node.tagName === "br") return "\n";
  if (skipBlocks && BLOCK_CHILDREN.has(node.tagName)) return " ";
  return node.children.map((c) => textOf(c, false)).join("");
}

/** The direction most of a container's blocks ended up with. */
function majority(node: HElement, fallback: Dir): Dir {
  let rtl = 0;
  let ltr = 0;
  const count = (n: HNode) => {
    if (!isElement(n)) return;
    if (TEXT_BLOCKS.has(n.tagName) && n.properties.dir) {
      if (n.properties.dir === "rtl") rtl += 1;
      else ltr += 1;
      return;
    }
    n.children.forEach(count);
  };
  node.children.forEach(count);
  if (!rtl && !ltr) return fallback;
  return rtl >= ltr ? "rtl" : "ltr";
}

function walk(node: HElement | HRoot, inherited: Dir, headingIndex: { n: number }): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    const tag = child.tagName;
    if (tag === "pre" || tag === "code") {
      child.properties.dir = "ltr";
      continue;
    }
    if (TEXT_BLOCKS.has(tag)) {
      if (HEADINGS.has(tag)) child.properties.id = `h-${headingIndex.n++}`;
      // A note shows every line as it was written, each in its own direction — the editor
      // does too — not lines joined into one paragraph the way Markdown would.
      const lines = splitLines(child);
      if (lines) {
        const dirs: Dir[] = [];
        let previous = inherited;
        child.children = lines.map((nodes) => {
          const dir = wordsDir(nodes.map((n) => textOf(n)).join("")) ?? previous;
          previous = dir;
          dirs.push(dir);
          const line: HElement = { type: "element", tagName: "span", properties: { dir, className: ["note-line"] }, children: nodes };
          isolateInline(line, dir);
          return line;
        });
        child.properties.dir = dirs[0];
        continue;
      }
      // Its own words, not those of a paragraph or list nested in it (a list item's).
      const dir = wordsDir(child.children.map((c) => textOf(c, true)).join("")) ?? inherited;
      child.properties.dir = dir;
      isolateInline(child, dir);
      // A list item can hold paragraphs and nested lists.
      walk(child, dir, headingIndex);
      continue;
    }
    if (CONTAINERS.has(tag)) {
      walk(child, inherited, headingIndex);
      child.properties.dir = majority(child, inherited);
      continue;
    }
    walk(child, inherited, headingIndex);
  }
}

/**
 * A block's inline content cut at its line breaks (soft ones in the text, and <br>), or
 * null when it's one line or holds blocks of its own (a list item with a nested list).
 */
function splitLines(block: HElement): HNode[][] | null {
  if (block.children.some((c) => isElement(c) && BLOCK_CHILDREN.has(c.tagName))) return null;
  const lines: HNode[][] = [[]];
  for (const child of block.children) {
    if (child.type === "text" && child.value.includes("\n")) {
      child.value.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ type: "text", value: part });
      });
    } else if (isElement(child) && child.tagName === "br") {
      lines.push([]);
    } else {
      lines[lines.length - 1].push(child);
    }
  }
  const kept = lines.filter((line) => line.some((n) => textOf(n).trim() || (isElement(n) && n.tagName !== "br")));
  return kept.length > 1 ? kept : null;
}

/** One stretch of inline content (text and inline elements between block children). */
function isolateInline(parent: HElement, dir: Dir): void {
  const out: HNode[] = [];
  let stretch: HNode[] = [];
  const flush = () => {
    out.push(...isolateStretch(stretch, dir));
    stretch = [];
  };
  for (const child of parent.children) {
    if (isElement(child) && BLOCK_CHILDREN.has(child.tagName)) {
      flush();
      out.push(child);
    } else {
      stretch.push(child);
    }
  }
  flush();
  parent.children = out;
}

function isolateStretch(nodes: HNode[], dir: Dir): HNode[] {
  if (!nodes.length) return nodes;
  const texts = nodes.map((n) => textOf(n));
  const joined = texts.join("");
  const runs = isolatedRuns(joined, dir);
  if (!runs.length) return nodes;

  // Where each node starts in the joined text.
  const starts: number[] = [];
  let at = 0;
  for (const t of texts) {
    starts.push(at);
    at += t.length;
  }
  const locate = (pos: number, end: boolean) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const from = starts[i];
      const to = from + texts[i].length;
      if (end ? pos > from && pos <= to : pos >= from && pos < to) return { index: i, offset: pos - from };
    }
    return null;
  };

  // Work from the last run back, so earlier offsets stay valid.
  let list = [...nodes];
  let listTexts = [...texts];
  const untouchable = new Set<HNode>();
  for (const run of [...runs].reverse()) {
    const a = locate(run.from, false);
    const b = locate(run.to, true);
    if (!a || !b) continue;
    const first = list[a.index];
    const last = list[b.index];
    const cutsIntoFirst = first.type !== "text" && a.offset > 0;
    const cutsIntoLast = last.type !== "text" && b.offset < listTexts[b.index].length;
    if (a.index === b.index && first.type !== "text") {
      // Wholly inside one element: its own pass handles it — unless it is the element.
      if (a.offset === 0 && b.offset === listTexts[a.index].length) {
        list[a.index] = bdi(run.dir, [first]);
        untouchable.add(list[a.index]);
      }
      continue;
    }
    if (cutsIntoFirst || cutsIntoLast) {
      // The phrase starts or ends halfway through bold text, say: leave it to the browser,
      // and don't isolate the part inside the element either (that would split it).
      if (cutsIntoFirst) untouchable.add(first);
      if (cutsIntoLast) untouchable.add(last);
      continue;
    }
    // Split the text nodes at the edges and wrap everything between.
    const before: HNode[] = [];
    const after: HNode[] = [];
    const middle: HNode[] = [];
    for (let i = a.index; i <= b.index; i += 1) {
      const node = list[i];
      if (node.type !== "text") {
        middle.push(node);
        continue;
      }
      const from = i === a.index ? a.offset : 0;
      const to = i === b.index ? b.offset : node.value.length;
      if (from > 0) before.push({ type: "text", value: node.value.slice(0, from) });
      middle.push({ type: "text", value: node.value.slice(from, to) });
      if (to < node.value.length) after.push({ type: "text", value: node.value.slice(to) });
    }
    const wrapped = bdi(run.dir, middle);
    untouchable.add(wrapped);
    const replacement = [...before, wrapped, ...after];
    list = [...list.slice(0, a.index), ...replacement, ...list.slice(b.index + 1)];
    listTexts = [...listTexts.slice(0, a.index), ...replacement.map((n) => textOf(n)), ...listTexts.slice(b.index + 1)];
  }
  // Inline elements no phrase crossed get their own pass (a phrase inside bold text).
  for (const node of list) {
    if (isElement(node) && !untouchable.has(node) && node.tagName !== "code") isolateInline(node, dir);
  }
  return list;
}

function bdi(dir: Dir, children: HNode[]): HElement {
  return { type: "element", tagName: "bdi", properties: { dir, className: ["bidi-run"] }, children };
}

/** The rehype plugin: `fallback` is the direction of a note with no words at all. */
export function rehypeNoteBidi(options: { fallback: Dir }) {
  return (tree: HRoot) => {
    walk(tree, options.fallback, { n: 0 });
  };
}

/** `[[Note name]]` → a link the note view opens inside Rafiq. Code stays untouched. */
export function wikiLinks(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_, target: string, label?: string) => `[${(label ?? target).trim()}](<note:${target.trim()}>)`)))
    .join("");
}
