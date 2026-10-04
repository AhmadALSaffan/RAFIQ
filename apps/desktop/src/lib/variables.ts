/**
 * `{{name}}` blanks in reusable text — saved prompts and task templates. The same rule as
 * the agent (api/automation.py): letters (Arabic included), digits, _ and -, with spaces
 * allowed inside but not at the ends.
 */

const VARIABLE = /\{\{\s*([\p{L}\p{N}\p{M}_-](?:[\p{L}\p{N}\p{M}_\- ]{0,58}[\p{L}\p{N}\p{M}_-])?)\s*\}\}/gu;

/** The `{{name}}` parts, each once, in the order they first appear (across all texts). */
export function variablesOf(...texts: string[]): string[] {
  const seen: string[] = [];
  for (const text of texts) for (const m of text.matchAll(VARIABLE)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** The text with every `{{name}}` replaced; a name left empty stays as it was. */
export function fillPrompt(body: string, values: Record<string, string>): string {
  return body.replace(VARIABLE, (whole, name: string) => (values[name]?.trim() ? values[name] : whole));
}

// Names that mean the same thing whatever language they're written in.
const FOLDER = /^(folder|dir|directory|path|project|workdir|(ال)?مجلد|(ال)?مسار|(ال)?مشروع)$/u;
const BRANCH = /^(branch|git branch|(ال)?فرع|(ال)?برانش)$/u;
const DATE = /^(date|today|(ال)?تاريخ|اليوم)$/u;

export interface FillContext {
  folder?: string | null;
  branch?: string | null;
  /** YYYY-MM-DD */
  today: string;
}

/** What a well-known blank starts out as: the task's folder, its git branch, today's
 *  date. Anything else starts empty for the user to fill. */
export function defaultFor(name: string, ctx: FillContext): string {
  const key = name.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (FOLDER.test(key)) return ctx.folder ?? "";
  if (BRANCH.test(key)) return ctx.branch ?? "";
  if (DATE.test(key)) return ctx.today;
  return "";
}

/** Today in the user's time zone, as YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
