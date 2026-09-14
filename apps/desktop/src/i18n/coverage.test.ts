/**
 * Every piece of Arabic UI text must (1) go through `t()` and (2) exist in the English and
 * Russian dictionaries. This walks the real TypeScript AST of `src/`, so a new string that
 * skips translation fails the suite instead of shipping half-translated.
 */

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ru } from "./ru";

const ARABIC = /[؀-ۿ]/;
// Every source file under src/, as text (Vite reads them — no Node APIs needed).
const SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.d.ts", "!./en.ts", "!./ru.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function isTCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t";
}

function scan() {
  const untranslated: string[] = [];
  const keys = new Map<string, string>();
  for (const [file, source] of Object.entries(SOURCES)) {
    // Glob keys are relative to this folder: "../features/…" or "./index.ts".
    const rel = file.replace(/^\.\.\//, "").replace(/^\.\//, "i18n/");
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind);
    const where = (node: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

    const visit = (node: ts.Node) => {
      if (isTCall(node)) {
        // The key is a literal — or a choice between literals (`n === 1 ? "…" : "…"`).
        const collect = (arg: ts.Expression | undefined) => {
          if (!arg) return;
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            if (ARABIC.test(arg.text)) keys.set(arg.text, where(arg));
          } else if (ts.isConditionalExpression(arg)) {
            visit(arg.condition);
            collect(arg.whenTrue);
            collect(arg.whenFalse);
          } else if (ts.isParenthesizedExpression(arg)) {
            collect(arg.expression);
          } else {
            visit(arg);
          }
        };
        collect(node.arguments[0]);
        node.arguments.slice(1).forEach(visit);
        return;
      }
      // A template's own text counts; Arabic inside a nested t() within it is fine.
      const text =
        ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
          ? node.text
          : ts.isTemplateExpression(node)
            ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("")
            : null;
      // Names written in their own script on purpose: the language picker's autonym, and
      // the developer's name shown in Arabic under its translation.
      const isAutonym =
        ts.isStringLiteral(node) &&
        ((rel === "i18n/index.ts" && node.text === "العربية") ||
          (rel === "routes/AboutPage.tsx" && node.text === "أحمد عليوي السفان"));
      if (text !== null && ARABIC.test(text) && !isAutonym) {
        untranslated.push(`${where(node)}  ${text.trim().slice(0, 60)}`);
        return;
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return { untranslated, keys };
}

const { untranslated, keys } = scan();

describe("i18n coverage", () => {
  it("wraps every Arabic string in t()", () => {
    expect(untranslated).toEqual([]);
  });

  it.each([
    ["en", en],
    ["ru", ru],
  ] as const)("has a %s translation for every key", (_name, dict) => {
    const missing = [...keys.keys()].filter((key) => !(key in dict)).map((key) => `${keys.get(key)}  ${key}`);
    expect(missing).toEqual([]);
  });

  it.each([
    ["en", en],
    ["ru", ru],
  ] as const)("keeps every {placeholder} in %s", (_name, dict) => {
    const names = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join(" ");
    const broken: string[] = [];
    for (const key of keys.keys()) {
      const entry = dict[key];
      if (entry === undefined) continue;
      const forms = typeof entry === "string" ? [entry] : Object.values(entry);
      for (const form of forms) if (form !== undefined && names(form) !== names(key)) broken.push(`${key} → ${form}`);
    }
    expect(broken).toEqual([]);
  });

  it("has no translations for keys the app no longer uses", () => {
    const stale = [...new Set([...Object.keys(en), ...Object.keys(ru)])].filter((key) => !keys.has(key));
    expect(stale).toEqual([]);
  });
});
