/** Small pure pieces of the skill editor, kept apart so they can be tested. */

import { t } from "../../i18n";

/** The markdown under the front matter — what the preview shows. */
export function bodyOf(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

export type NewFileKind = "reference" | "command";

/** "My Notes" → "My-Notes.md"; a command lands in commands/. Null when nothing usable is left. */
export function newFilePath(kind: NewFileKind, raw: string): string | null {
  const stem = raw
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!stem) return null;
  return kind === "command" ? `commands/${stem.toLowerCase()}.md` : `${stem}.md`;
}

/** What a new file starts with, so the user sees the expected shape. */
export function fileTemplate(kind: NewFileKind): string {
  return kind === "command"
    ? `# ${t("شو بيعمل هالأمر (سطر واحد)")}\n\n${t("التعليمات اللي بتنبعت للنموذج لما تكتب الأمر.")}\n`
    : `# ${t("عنوان الملف")}\n\n${t("تفاصيل بيرجعلها النموذج لما يحتاجها.")}\n`;
}

/** A new skill's first draft: a valid header and a nudge for the body. */
export function skillTemplate(): string {
  return `---
name: my-skill
description: ${t("متى لازم النموذج يستعمل هالمهارة — جملة أو جملتين.")}
---

# ${t("اسم المهارة")}

${t("اكتب التعليمات خطوة خطوة: شو يعمل، بأي ترتيب، وشو لازم يتجنّب.")}
`;
}

/** Character offsets of a 1-based line, to select it in the textarea. */
export function lineRange(text: string, line: number): [number, number] {
  const lines = text.split("\n");
  const index = Math.min(Math.max(1, line), lines.length) - 1;
  const start = lines.slice(0, index).reduce((sum, l) => sum + l.length + 1, 0);
  return [start, start + lines[index].length];
}
