// Lint rules for the desktop app.
//
// Deliberately narrow: TypeScript already catches types, so these rules are about the
// things it can't see — stale hook dependencies, unused code, accidental `any`, and
// controls a keyboard or a screen reader can't reach (jsx-a11y).

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Focus goes straight to the field in search boxes, palettes and rename boxes the
      // user just opened — that's where they're about to type.
      "jsx-a11y/no-autofocus": "off",
      // A scrolling region has to take focus so the arrow keys can scroll it.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region"], allowExpressionValues: true }],
      // The two classic hook rules. The newer compiler-era rules (purity,
      // set-state-in-effect) are left off: this app doesn't run React Compiler, and they
      // flag patterns we use deliberately, like resetting state when a route param changes.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  // Arc UI (vendored, MIT): kept close to upstream so it can be updated. Its widgets handle
  // keyboard and focus their own way (a focusable code region, a pointer-driven meter, an
  // editor that manages its own caret), and it carries Next.js lint comments.
  {
    files: ["src/components/arc/**/*.{ts,tsx}"],
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      "jsx-a11y/no-noninteractive-tabindex": "off",
      "jsx-a11y/anchor-has-content": "off",
      "jsx-a11y/aria-activedescendant-has-tabindex": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "no-control-regex": "off",
      "no-useless-assignment": "off",
    },
  },
  // The end-to-end test and its pretend model run in Node, not the browser.
  {
    files: ["e2e/**/*.{ts,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },
);
