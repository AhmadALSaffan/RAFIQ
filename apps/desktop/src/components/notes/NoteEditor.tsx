/**
 * Writing a note: the Markdown source in CodeMirror, with each line laid out in its own
 * direction and every phrase in the other language kept whole as it's typed — the same
 * rules the rendered note uses (lib/noteBidi.ts). Pictures pasted or dropped in are saved
 * next to the note and linked; the toolbar and Ctrl+B/I/K format the selection.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorSelection, EditorState, RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, Direction, EditorView, keymap, placeholder as placeholderExt, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { isolatedRuns, lineDirs, type Dir } from "../../lib/noteBidi";

export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "codeblock"
  | "table"
  | "divider";

export interface NoteEditorHandle {
  format: (command: FormatCommand) => void;
  insert: (text: string) => void;
  /** The selected text, or "" when nothing is selected. */
  selection: () => string;
  /** Everything up to the cursor, for "continue writing". */
  beforeCursor: () => string;
  replaceSelection: (text: string) => void;
  insertAfterSelection: (text: string) => void;
  scrollToLine: (line: number) => void;
  focus: () => void;
}

interface Props {
  /** Changing it starts the editor over on `value` (another note, or a reload). */
  docKey: string;
  value: string;
  onChange: (text: string) => void;
  onImage: (file: File) => Promise<string | null>;
  placeholder: string;
  fallback: Dir;
  tableTemplate: string;
}

// ── Direction ─────────────────────────────────────────────────────────────────────────────

interface BidiDecorations {
  all: DecorationSet;
  runs: DecorationSet;
}

function bidiDecorations(state: EditorState, fallback: Dir): BidiDecorations {
  const all = new RangeSetBuilder<Decoration>();
  const runs = new RangeSetBuilder<Decoration>();
  const lines: string[] = [];
  for (let iter = state.doc.iterLines(); !iter.next().done; ) lines.push(iter.value);
  const dirs = lineDirs(lines, fallback);
  let fence = false;
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    const dir = dirs[n - 1];
    all.add(line.from, line.from, Decoration.line({ attributes: { dir } }));
    const isFence = /^\s{0,3}(```|~~~)/.test(line.text);
    if (isFence) fence = !fence;
    if (fence || isFence) continue;
    for (const run of isolatedRuns(line.text, dir)) {
      const mark = Decoration.mark({
        class: "cm-bidi-run",
        attributes: { dir: run.dir },
        bidiIsolate: run.dir === "ltr" ? Direction.LTR : Direction.RTL,
      });
      all.add(line.from + run.from, line.from + run.to, mark);
      runs.add(line.from + run.from, line.from + run.to, mark);
    }
  }
  return { all: all.finish(), runs: runs.finish() };
}

function bidiField(fallback: Dir): Extension {
  const field = StateField.define<BidiDecorations>({
    create: (state) => bidiDecorations(state, fallback),
    update: (value, tr) => (tr.docChanged ? bidiDecorations(tr.state, fallback) : value),
    provide: (f) => [EditorView.decorations.from(f, (v) => v.all), EditorView.bidiIsolatedRanges.from(f, (v) => v.runs)],
  });
  return [field, EditorView.perLineTextDirection.of(true)];
}

// ── Look ──────────────────────────────────────────────────────────────────────────────────

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.55em", fontWeight: "700", lineHeight: "1.5" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.12em", fontWeight: "650" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "650" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--color-accent)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  { tag: tags.quote, color: "var(--color-ink-muted)" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.labelName], color: "var(--color-ink-subtle, var(--color-ink-muted))", opacity: "0.75" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", background: "transparent", color: "var(--color-ink)", fontSize: "1rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.9", overflow: "auto" },
  ".cm-content": { padding: "28px 0 40vh", caretColor: "var(--color-accent)", maxWidth: "760px", margin: "0 auto" },
  ".cm-line": { padding: "0 32px" },
  ".cm-cursor, .cm-dropCursor": { borderInlineStartColor: "var(--color-accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    background: "color-mix(in oklch, var(--color-accent) 26%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--color-ink-muted)" },
  ".cm-bidi-run": { background: "color-mix(in oklch, var(--color-accent) 9%, transparent)", borderRadius: "4px", padding: "0 1px" },
});

// ── Formatting ────────────────────────────────────────────────────────────────────────────

function wrap(view: EditorView, mark: string): void {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const before = state.sliceDoc(range.from - mark.length, range.from);
      const after = state.sliceDoc(range.to, range.to + mark.length);
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        };
      }
      return {
        changes: { from: range.from, to: range.to, insert: `${mark}${text}${mark}` },
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      };
    }),
  );
}

const LINE_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/;

function prefixLines(view: EditorView, make: (index: number) => string): void {
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n += 1) lines.add(n);
  }
  const numbers = [...lines].sort((a, b) => a - b);
  const wanted = numbers.map((_, i) => make(i));
  const all = numbers.every((n, i) => state.doc.line(n).text.replace(/^\s*/, "").startsWith(wanted[i].trimEnd()));
  const changes = numbers.map((n, i) => {
    const line = state.doc.line(n);
    const match = LINE_PREFIX.exec(line.text)!;
    const from = line.from + match[1].length;
    const to = from + (match[2]?.length ?? 0);
    return { from, to, insert: all ? "" : wanted[i] };
  });
  view.dispatch({ changes });
}

function insertBlock(view: EditorView, block: string): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.to);
  const lead = line.length ? "\n\n" : "";
  const insert = `${lead}${block}\n`;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length } });
}

function run(view: EditorView, command: FormatCommand, tableTemplate: string): void {
  switch (command) {
    case "bold":
      return wrap(view, "**");
    case "italic":
      return wrap(view, "*");
    case "strike":
      return wrap(view, "~~");
    case "code":
      return wrap(view, "`");
    case "link": {
      const range = view.state.selection.main;
      const text = view.state.sliceDoc(range.from, range.to) || "link";
      const insert = `[${text}](https://)`;
      const urlFrom = range.from + text.length + 3;
      view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: { anchor: urlFrom, head: urlFrom + 8 } });
      return;
    }
    case "h1":
    case "h2":
    case "h3":
      return prefixLines(view, () => `${"#".repeat(Number(command[1]))} `);
    case "bullet":
      return prefixLines(view, () => "- ");
    case "numbered":
      return prefixLines(view, (i) => `${i + 1}. `);
    case "task":
      return prefixLines(view, () => "- [ ] ");
    case "quote":
      return prefixLines(view, () => "> ");
    case "codeblock": {
      const range = view.state.selection.main;
      const text = view.state.sliceDoc(range.from, range.to);
      if (text) {
        view.dispatch({ changes: { from: range.from, to: range.to, insert: `\`\`\`\n${text}\n\`\`\`` } });
        return;
      }
      return insertBlock(view, "```\n\n```");
    }
    case "table":
      return insertBlock(view, tableTemplate);
    case "divider":
      return insertBlock(view, "---");
  }
}

// ── The editor ────────────────────────────────────────────────────────────────────────────

function readImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  { docKey, value, onChange, onImage, placeholder, fallback, tableTemplate },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest callbacks, for extensions built once per document.
  const latest = useRef({ onChange, onImage, tableTemplate });
  latest.current = { onChange, onImage, tableTemplate };

  useEffect(() => {
    if (!host.current) return;
    const addImages = (files: File[], at: number, target: EditorView) => {
      for (const file of files) {
        void latest.current.onImage(file).then((src) => {
          if (!src) return;
          const insert = `![${file.name.replace(/\.[^.]+$/, "")}](${encodeURI(src)})\n`;
          target.dispatch({ changes: { from: at, insert } });
        });
      }
    };
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(highlight),
        theme,
        EditorView.lineWrapping,
        placeholderExt(placeholder),
        bidiField(fallback),
        keymap.of([
          { key: "Mod-b", run: (v) => (run(v, "bold", latest.current.tableTemplate), true) },
          { key: "Mod-i", run: (v) => (run(v, "italic", latest.current.tableTemplate), true) },
          { key: "Mod-k", run: (v) => (run(v, "link", latest.current.tableTemplate), true) },
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste: (event, target) => {
            const files = [...(event.clipboardData?.files ?? [])].filter(readImage);
            if (!files.length) return false;
            event.preventDefault();
            addImages(files, target.state.selection.main.head, target);
            return true;
          },
          drop: (event, target) => {
            const files = [...(event.dataTransfer?.files ?? [])].filter(readImage);
            if (!files.length) return false;
            event.preventDefault();
            const at = target.posAtCoords({ x: event.clientX, y: event.clientY }) ?? target.state.selection.main.head;
            addImages(files, at, target);
            return true;
          },
        }),
      ],
    });
    const created = new EditorView({ state, parent: host.current });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // A new document starts a new editor; typing doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, fallback]);

  useImperativeHandle(
    ref,
    () => ({
      format: (command) => {
        if (!view.current) return;
        run(view.current, command, latest.current.tableTemplate);
        view.current.focus();
      },
      insert: (text) => {
        const v = view.current;
        if (!v) return;
        v.dispatch(v.state.replaceSelection(text));
        v.focus();
      },
      selection: () => {
        const v = view.current;
        if (!v) return "";
        const { from, to } = v.state.selection.main;
        return v.state.sliceDoc(from, to);
      },
      beforeCursor: () => {
        const v = view.current;
        return v ? v.state.sliceDoc(0, v.state.selection.main.head) : "";
      },
      replaceSelection: (text) => {
        const v = view.current;
        if (!v) return;
        v.dispatch(v.state.replaceSelection(text));
      },
      insertAfterSelection: (text) => {
        const v = view.current;
        if (!v) return;
        const at = v.state.selection.main.to;
        v.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
      },
      scrollToLine: (line) => {
        const v = view.current;
        if (!v) return;
        const target = v.state.doc.line(Math.min(Math.max(1, line + 1), v.state.doc.lines));
        v.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: 24 }) });
        v.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return <div ref={host} className="note-editor h-full min-h-0" />;
});
