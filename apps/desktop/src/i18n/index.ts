/**
 * Rafiq's UI language: Arabic (the source language), English, Russian.
 *
 * Keys are the Arabic text itself — the UI reads exactly as before in Arabic, and each
 * other language is a plain dictionary from that text to its translation. `{name}` marks
 * a value filled in at runtime; a translation that depends on a count is a plural object
 * picked with Intl.PluralRules (Russian needs three forms, English two).
 *
 * The locale is read once at startup and switching reloads the window, so everything —
 * including module-level constants and the page direction — comes up in the new language.
 * `src/i18n/coverage.test.ts` fails the build if any Arabic text in the UI isn't wrapped in
 * `t()` or is missing from a dictionary.
 */

import { en } from "./en";
import { ru } from "./ru";

export type Locale = "ar" | "en" | "ru";
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Dictionary = Record<string, string | Plural>;

export const LOCALES: { id: Locale; name: string; dir: "rtl" | "ltr" }[] = [
  { id: "ar", name: "العربية", dir: "rtl" },
  { id: "en", name: "English", dir: "ltr" },
  { id: "ru", name: "Русский", dir: "ltr" },
];

const DICTIONARIES: Record<Exclude<Locale, "ar">, Dictionary> = { en, ru };
const STORAGE_KEY = "rafiq-locale";

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ar" || saved === "en" || saved === "ru") return saved;
  } catch {
    // storage unavailable — fall back to Arabic
  }
  return "ar";
}

const current: Locale = readLocale();

export function locale(): Locale {
  return current;
}

export function direction(l: Locale = current): "rtl" | "ltr" {
  return LOCALES.find((x) => x.id === l)?.dir ?? "rtl";
}

/** The BCP 47 tag for Intl formatters (dates, relative times, plurals). */
export function intlLocale(): string {
  return current;
}

/** Applies the language to the document before the first paint (and to the window title). */
export function applyDocumentLocale(): void {
  document.documentElement.lang = current;
  document.documentElement.dir = direction();
  document.title = t("رفيق");
  void import("@tauri-apps/api/core").then(async ({ isTauri }) => {
    if (!isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()
      .setTitle(t("رفيق"))
      .catch(() => undefined);
  });
}

/** Saves the choice and reloads so the whole app — direction included — switches at once. */
export function setLocale(next: Locale): void {
  if (next === current) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    return;
  }
  window.location.reload();
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

function pickPlural(entry: Plural, vars?: Record<string, string | number>): string {
  const count = vars ? Object.values(vars).find((v) => typeof v === "number") : undefined;
  if (typeof count !== "number") return entry.other;
  const rule = new Intl.PluralRules(current).select(count);
  return entry[rule] ?? entry.other;
}

/** Translates Arabic source text into the current language. */
export function t(key: string, vars?: Record<string, string | number>): string {
  if (current === "ar") return fill(key, vars);
  const entry = DICTIONARIES[current][key];
  if (entry === undefined) return fill(key, vars);
  return fill(typeof entry === "string" ? entry : pickPlural(entry, vars), vars);
}

/** Direct lookup for tests and tooling. */
export function dictionary(l: Exclude<Locale, "ar">): Dictionary {
  return DICTIONARIES[l];
}
