/**
 * The icon sets the motion engine ships, offline. One-colour sets take the layer's colour
 * (and draw on with `drawOn`, and export to Lottie); colour sets — emoji, logos, flags —
 * keep their own colours and draw as pictures. Every set is MIT, ISC, Apache-2.0 or CC0:
 * nothing is owed on screen. Keep the prefixes in step with ICONIFY_SETS in vite.config.ts
 * and with rafiq_agent/motion/icon_names.txt.
 */

export interface IconSet {
  prefix: string;
  name: string;
  colour: boolean;
  license: string;
}

export const ICON_SETS: IconSet[] = [
  { prefix: "tabler", name: "Tabler", colour: false, license: "MIT" },
  { prefix: "ph", name: "Phosphor", colour: false, license: "MIT" },
  { prefix: "lucide", name: "Lucide", colour: false, license: "ISC" },
  { prefix: "mdi", name: "Material Design", colour: false, license: "Apache-2.0" },
  { prefix: "ri", name: "Remix", colour: false, license: "Apache-2.0" },
  { prefix: "iconoir", name: "Iconoir", colour: false, license: "MIT" },
  { prefix: "heroicons", name: "Heroicons", colour: false, license: "MIT" },
  { prefix: "si", name: "Simple Icons", colour: false, license: "CC0-1.0" },
  { prefix: "fluent-emoji-flat", name: "Fluent Emoji", colour: true, license: "MIT" },
  { prefix: "logos", name: "Logos", colour: true, license: "CC0-1.0" },
  { prefix: "circle-flags", name: "Flags", colour: true, license: "MIT" },
];

export const COLOUR_PREFIXES = new Set(ICON_SETS.filter((s) => s.colour).map((s) => s.prefix));

export function iconPrefix(name: string): string {
  return name.split(":")[0] ?? "";
}

/** A colour icon keeps its own colours: it draws as a picture (and can't go to Lottie). */
export function isColourIcon(name: string | undefined): boolean {
  return !!name && COLOUR_PREFIXES.has(iconPrefix(name));
}
