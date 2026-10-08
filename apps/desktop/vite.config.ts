/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One source of truth for the version the About page shows: package.json.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

/**
 * `virtual:simple-icon-paths`: every simple-icons brand mark as { slug: path }, read from the
 * package's SVG files. The motion engine imports it lazily, so it lands in its own chunk —
 * importing the package's index for this would pull all ~3,500 marks into the main bundle,
 * where the app already imports a few of them by name.
 */
function simpleIconPaths() {
  const id = "virtual:simple-icon-paths";
  return {
    name: "simple-icon-paths",
    resolveId: (source: string) => (source === id ? `\0${id}` : null),
    load(resolved: string) {
      if (resolved !== `\0${id}`) return null;
      const dir = fileURLToPath(new URL("./node_modules/simple-icons/icons/", import.meta.url));
      const paths: Record<string, string> = {};
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".svg")) continue;
        const d = /<path d="([^"]+)"/.exec(readFileSync(dir + file, "utf-8"))?.[1];
        if (d) paths[file.slice(0, -4)] = d;
      }
      return `export default ${JSON.stringify(paths)};`;
    },
  };
}

/** The Iconify sets the motion engine ships (all MIT, ISC, Apache-2.0 or CC0 — no attribution
 * owed in the video). Keep in step with ICON_SETS in src/features/motion/engine/iconSets.ts. */
const ICONIFY_SETS = ["ph", "lucide", "mdi", "ri", "iconoir", "heroicons", "fluent-emoji-flat", "logos", "circle-flags"];
/** SVG the engine doesn't turn into paths (and so doesn't offer for one-colour sets). */
const UNSUPPORTED_SVG = /<mask|<clipPath|<use|Gradient|transform=|<defs|style=/;
const COLOUR_SETS = new Set(["fluent-emoji-flat", "logos", "circle-flags"]);

/**
 * `virtual:icon-names`: every icon name the engine can draw, by set — what search reads,
 * without loading ~30 MB of icon data to find a name.
 */
function iconNames() {
  const id = "virtual:icon-names";
  return {
    name: "icon-names",
    resolveId: (source: string) => (source === id ? `\0${id}` : null),
    load(resolved: string) {
      if (resolved !== `\0${id}`) return null;
      const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8"));
      const sets: Record<string, string[]> = {};
      sets.tabler = Object.keys(read("./node_modules/@tabler/icons/tabler-nodes-outline.json"));
      sets.si = readdirSync(fileURLToPath(new URL("./node_modules/simple-icons/icons/", import.meta.url)))
        .filter((f) => f.endsWith(".svg"))
        .map((f) => f.slice(0, -4));
      for (const prefix of ICONIFY_SETS) {
        const json = read(`./node_modules/@iconify-json/${prefix}/icons.json`) as { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> };
        const ok = (name: string) => COLOUR_SETS.has(prefix) || !UNSUPPORTED_SVG.test(json.icons[name]?.body ?? "");
        const names = Object.keys(json.icons).filter(ok);
        for (const [alias, { parent }] of Object.entries(json.aliases ?? {})) if (json.icons[parent] && ok(parent)) names.push(alias);
        sets[prefix] = names;
      }
      return `export default ${JSON.stringify(sets)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), simpleIconPaths(), iconNames()],
  resolve: {
    alias: {
      // The motion engine's icon library: every Tabler outline icon as SVG nodes, loaded
      // only when a scene uses an icon (the package's own exports don't expose this file).
      "tabler-nodes-outline": fileURLToPath(new URL("./node_modules/@tabler/icons/tabler-nodes-outline.json", import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  // WebView2 is current Chromium: modern syntax in pre-bundled dependencies too.
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
  test: {
    // Unit tests cover the pure logic — reducers, bidi, layout, time — not the pixels.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
