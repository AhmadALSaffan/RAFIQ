/**
 * Latin mentions inside Arabic text (`@src/lib/api.ts`, `#RAF-12`) get reordered by the
 * bidi algorithm — the `@` jumps to the wrong side and the sentence reads scrambled.
 * The fix is to isolate every mention: real isolate characters in the composer's value
 * (so the caret and the highlight layer agree on one layout) and `<bdi>` when we render
 * stored text, which never carries them.
 */

/** U+2066 LEFT-TO-RIGHT ISOLATE */
export const LRI = "\u2066";
/** U+2069 POP DIRECTIONAL ISOLATE */
export const PDI = "\u2069";

// Isolates, embeddings/overrides, and the plain LRM/RLM marks.
const BIDI_CONTROLS = /[\u2066-\u2069\u202a-\u202e\u200e\u200f]/g;

/** A mention token, together with its isolate characters when they're present. */
export const TOKEN_RE = /(^\/[^\s]*|[\u2066-\u2068]?[@#][^\s@#\u2066-\u2069]+\u2069?)/gm;

/** Wraps a mention so it lays out left-to-right inside an Arabic line. */
export function isolate(token: string): string {
  return `${LRI}${token}${PDI}`;
}

/** Drops the invisible control characters before the text leaves the app. */
export function stripBidi(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}

export interface TextChunk {
  text: string;
  token: boolean;
}

/** Splits text into plain chunks and mention tokens, in order. */
export function splitTokens(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > at) chunks.push({ text: text.slice(at, start), token: false });
    chunks.push({ text: match[0], token: true });
    at = start + match[0].length;
  }
  if (at < text.length) chunks.push({ text: text.slice(at), token: false });
  return chunks;
}

// Fenced blocks and inline code are left alone: their text is meant to be copied verbatim,
// and it already renders left-to-right.
const CODE_SPANS = /(```[\s\S]*?```|`[^`\n]*`)/g;
const BARE_MENTION = /(?<![\u2066-\u2069\w])([@#][^\s@#\u2066-\u2069]+)/g;

/**
 * Adds isolate characters around mentions in Markdown text, so a Latin `@path` can't
 * reorder the Arabic sentence it sits in. Code stays untouched.
 */
export function isolateMentions(markdown: string): string {
  return markdown
    .split(CODE_SPANS)
    .map((part, i) => (i % 2 ? part : part.replace(BARE_MENTION, (m) => isolate(m))))
    .join("");
}

/**
 * Direction for a text field. `dir="auto"` looks at the *value*, so an empty field falls
 * back to left-to-right and the Arabic placeholder lands on the wrong side. Empty means
 * RTL here (the app's language); once there's text, let the text decide.
 */
export function fieldDir(value: string | null | undefined): "rtl" | "auto" {
  return value && value.trim() ? "auto" : "rtl";
}
