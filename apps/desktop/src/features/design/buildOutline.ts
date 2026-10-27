/**
 * What a design reply has built so far, read from its text as it streams: the documents it
 * finished, and the parts (header, sections, footer) of the one it's writing now — so the
 * preview can show the page assembling instead of a blank wait.
 */

export interface BuildPart {
  label: string;
  /** Its closing tag has arrived. */
  done: boolean;
}

export interface BuildOutline {
  /** Documents whose block closed, by name (null for an unnamed one). */
  finished: (string | null)[];
  /** The document being written now, if a block is open. */
  current: { name: string | null; parts: BuildPart[] } | null;
}

const PARTS = /<(header|nav|section|footer|article|aside)\b([^>]*)>/gi;
const BLOCK = /```html[ \t]*([^\n]*)\n/gi;

function nameOf(fence: string, body: string): string | null {
  const word = fence.trim().split(/\s+/)[0];
  if (word) return word.replace(/\.html?$/i, "");
  return /^\s*<!--\s*file:\s*([\w-]+)/i.exec(body)?.[1] ?? null;
}

function labelOf(tag: string, attrs: string, after: string): string {
  const id = /\b(?:id|aria-label)\s*=\s*["']([^"']{1,40})["']/i.exec(attrs)?.[1];
  if (id) return id.replace(/[-_]+/g, " ");
  // The first heading inside, when it has already arrived.
  const heading = /<h[1-3]\b[^>]*>([\s\S]{1,160}?)<\/h[1-3]>/i.exec(after.slice(0, 1600))?.[1];
  const text = heading?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 40) : tag;
}

export function buildOutline(text: string): BuildOutline | null {
  const finished: (string | null)[] = [];
  let current: BuildOutline["current"] = null;
  BLOCK.lastIndex = 0;
  for (let m = BLOCK.exec(text); m; m = BLOCK.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf("```", start);
    const body = end >= 0 ? text.slice(start, end) : text.slice(start);
    const name = nameOf(m[1], body);
    if (end >= 0) {
      finished.push(name);
      BLOCK.lastIndex = end + 3;
      continue;
    }
    const parts: BuildPart[] = [];
    PARTS.lastIndex = 0;
    for (let p = PARTS.exec(body); p; p = PARTS.exec(body)) {
      const tag = p[1].toLowerCase();
      const after = body.slice(p.index + p[0].length);
      parts.push({ label: labelOf(tag, p[2], after), done: new RegExp(`</${tag}>`, "i").test(after) });
    }
    current = { name, parts };
    break;
  }
  return finished.length || current ? { finished, current } : null;
}
