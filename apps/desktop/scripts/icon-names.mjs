// Writes the agent's list of icon names (rafiq_agent/motion/icon_names.txt) from the icon
// packages the app ships, so the model can search and check icons with the app closed.
// Same sets and rules as the `virtual:icon-names` module in vite.config.ts.
// usage: node scripts/icon-names.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => JSON.parse(readFileSync(here(rel), "utf-8"));
const ICONIFY_SETS = ["ph", "lucide", "mdi", "ri", "iconoir", "heroicons", "fluent-emoji-flat", "logos", "circle-flags"];
const COLOUR_SETS = new Set(["fluent-emoji-flat", "logos", "circle-flags"]);
const UNSUPPORTED_SVG = /<mask|<clipPath|<use|Gradient|transform=|<defs|style=/;

const out = [];
for (const n of Object.keys(read("../node_modules/@tabler/icons/tabler-nodes-outline.json"))) out.push(`tabler:${n}`);
for (const f of readdirSync(here("../node_modules/simple-icons/icons/"))) if (f.endsWith(".svg")) out.push(`si:${f.slice(0, -4)}`);
for (const prefix of ICONIFY_SETS) {
  const json = read(`../node_modules/@iconify-json/${prefix}/icons.json`);
  const ok = (name) => COLOUR_SETS.has(prefix) || !UNSUPPORTED_SVG.test(json.icons[name]?.body ?? "");
  for (const name of Object.keys(json.icons)) if (ok(name)) out.push(`${prefix}:${name}`);
  for (const [alias, { parent }] of Object.entries(json.aliases ?? {})) if (json.icons[parent] && ok(parent)) out.push(`${prefix}:${alias}`);
}
const bad = out.filter((n) => !/^[a-z0-9-]+:[a-z0-9-]+$/.test(n));
if (bad.length) console.warn("names outside the schema pattern:", bad.slice(0, 10));
writeFileSync(here("../../agent/rafiq_agent/motion/icon_names.txt"), out.join("\n") + "\n");
console.log(out.length, "icon names");
