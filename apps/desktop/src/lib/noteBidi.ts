/**
 * Arabic and English in one note, each read the way it's written.
 *
 * The browser's own rules go wrong in two places, and both scramble mixed text:
 *
 * 1. A paragraph's direction comes from its *first* letter (`dir="auto"`), so an Arabic
 *    sentence that starts with "React" is laid out left to right and reads backwards.
 *    Here a line's direction comes from its words: Arabic unless English words outnumber
 *    the Arabic ones more than two to one ("Next.js بيشتغل مع React" is an Arabic sentence).
 *
 * 2. Inside an Arabic line, the punctuation and numbers around an English phrase attach to
 *    the wrong side: "C++" shows as "++C", "Tauri (beta)" loses a bracket to the far end,
 *    "**React** Native" flips around. Every English phrase in an Arabic line (and every
 *    Arabic phrase in an English one) becomes an isolated run — one block, laid out on its
 *    own, that the sentence around it treats like a single word.
 */

export type Dir = "rtl" | "ltr";

// The tatweel (ـ, as in «الـ API») belongs to no script in Unicode, but it's Arabic writing.
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\u0640]/u;
// Letters written left to right (Latin, Greek, Cyrillic, CJK…): a letter of a script.
const LTR_LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Thai}]/u;
const DIGIT = /[\p{Nd}]/u;
const SPACE = /\s/u;
// Attached to a word without a space — "@user", "#tag", "C++", "~/src", "**bold**".
const ATTACHED = /[@#$%&*+\-_/\\~^=|`.'’:]/u;
// Ends a sentence or a clause: belongs to the sentence around a phrase, not to the phrase.
const CLAUSE_END = /[.,;:!?،؛؟…]/u;
const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function isRtl(ch: string): boolean {
  return RTL_LETTER.test(ch);
}

function isLtrLetter(ch: string): boolean {
  return LTR_LETTER.test(ch);
}

/** Code, links and markup say nothing about the language a line is written in. */
function prose(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/** The direction a line's words ask for, or null when it has none (a blank or a symbol). */
export function wordsDir(text: string): Dir | null {
  let rtl = 0;
  let ltr = 0;
  for (const word of prose(text).split(/\s+/)) {
    if (!word) continue;
    if ([...word].some(isRtl)) rtl += 1;
    else if ([...word].some(isLtrLetter)) ltr += 1;
  }
  if (!rtl && !ltr) return null;
  return rtl > 0 && rtl * 2 >= ltr ? "rtl" : "ltr";
}

/**
 * A direction for every line of a Markdown note. Code blocks are left to right; a line
 * without words (a blank, `---`) keeps the direction of the line above, so the caret on
 * an empty line after Arabic text waits on the right.
 */
export function lineDirs(lines: string[], fallback: Dir): Dir[] {
  const out: Dir[] = [];
  let previous: Dir = fallback;
  let fence: string | null = null;
  for (const line of lines) {
    const marker = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (fence) {
      out.push("ltr");
      if (marker === fence) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push("ltr");
      continue;
    }
    const dir = wordsDir(line) ?? previous;
    out.push(dir);
    previous = dir;
  }
  return out;
}

export interface Run {
  from: number;
  to: number;
  dir: Dir;
}

/**
 * The phrases in `text` written in the other direction than `dir`, as ranges to isolate.
 * A phrase runs from its first letter to its last letter or digit, across the spaces,
 * digits and punctuation between its words, and stops at the first letter of the line's
 * own script. Symbols stuck to it ("@", "++", "**") come along; a clause's closing
 * punctuation and a bracket it didn't open stay with the sentence.
 */
export function isolatedRuns(text: string, dir: Dir): Run[] {
  const chars = [...text];
  // Offsets in UTF-16 units, which is what the DOM and the editor count in.
  const offset: number[] = [];
  let at = 0;
  for (const ch of chars) {
    offset.push(at);
    at += ch.length;
  }
  offset.push(at);

  const own = dir === "rtl" ? isRtl : isLtrLetter;
  const other = dir === "rtl" ? isLtrLetter : isRtl;
  const runs: Run[] = [];
  let i = 0;
  while (i < chars.length) {
    if (!other(chars[i])) {
      i += 1;
      continue;
    }
    // Forward to the line's own script; the phrase ends at its last letter or digit.
    let j = i;
    let last = i;
    while (j < chars.length && !own(chars[j])) {
      if (other(chars[j]) || DIGIT.test(chars[j])) last = j;
      j += 1;
    }
    let start = i;
    let end = last + 1;
    // Symbols stuck to its end ("C++", "C#"), but not the clause's own punctuation.
    while (end < chars.length && !SPACE.test(chars[end]) && !own(chars[end]) && !CLAUSE_END.test(chars[end]) && (ATTACHED.test(chars[end]) || closes(chars, start, end))) {
      end += 1;
    }
    // …and to its start ("@user", "#tag", "3D", "**bold").
    while (start > 0 && !SPACE.test(chars[start - 1]) && !own(chars[start - 1]) && (ATTACHED.test(chars[start - 1]) || DIGIT.test(chars[start - 1]))) {
      start -= 1;
    }
    // A number just before it belongs to it ("8 MB", "3 iPhones").
    {
      let k = start - 1;
      while (k >= 0 && chars[k] === " ") k -= 1;
      let digits = k;
      while (digits >= 0 && (DIGIT.test(chars[digits]) || ((chars[digits] === "." || chars[digits] === ",") && digits > 0 && DIGIT.test(chars[digits - 1])))) digits -= 1;
      if (k >= 0 && DIGIT.test(chars[k]) && digits < k && start - k <= 2 && (digits < 0 || SPACE.test(chars[digits]))) start = digits + 1;
    }
    // A bracket closed inside the phrase whose opener sits just before it comes along.
    const unmatched = unmatchedClosers(chars, start, end);
    if (unmatched.length && start > 0 && chars[start - 1] === CLOSERS[unmatched[0]]) start -= 1;
    // A trailing opener with nothing closed after it belongs to the sentence.
    while (end - 1 > start && OPENERS[chars[end - 1]]) end -= 1;
    runs.push({ from: offset[start], to: offset[end], dir: dir === "rtl" ? "ltr" : "rtl" });
    i = Math.max(j, end);
  }
  return runs;
}

/** Whether `chars[end]` closes a bracket opened inside start..end. */
function closes(chars: string[], start: number, end: number): boolean {
  const opener = CLOSERS[chars[end]];
  if (!opener) return false;
  let depth = 0;
  for (let k = start; k < end; k += 1) {
    if (chars[k] === opener) depth += 1;
    else if (chars[k] === chars[end]) depth -= 1;
  }
  return depth > 0;
}

function unmatchedClosers(chars: string[], start: number, end: number): string[] {
  const stack: string[] = [];
  const lonely: string[] = [];
  for (let k = start; k < end; k += 1) {
    const ch = chars[k];
    if (OPENERS[ch]) stack.push(ch);
    else if (CLOSERS[ch]) {
      if (stack[stack.length - 1] === CLOSERS[ch]) stack.pop();
      else lonely.push(ch);
    }
  }
  return lonely;
}

/** The note's outline: each heading outside code, with its line (0-based) and level. */
export function noteHeadings(text: string): { line: number; level: number; text: string }[] {
  const out: { line: number; level: number; text: string }[] = [];
  let fence = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) out.push({ line: index, level: match[1].length, text: match[2].replace(/[*_`]/g, "") });
  });
  return out;
}
