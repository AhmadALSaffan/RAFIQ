/**
 * The kit's fonts, by the names a kit uses, and the CSS families they're registered under.
 * All ship with the app (OFL); the ones the rest of the UI doesn't use load on demand.
 * Nothing is drawn until the scene's fonts are in — never a fallback face (doc: «ممنوعات»).
 */

export const FONT_FAMILIES: Record<string, string> = {
  "IBM Plex Sans Arabic": "IBM Plex Sans Arabic",
  Alexandria: "Alexandria Variable",
  Cairo: "Cairo Variable",
  Tajawal: "Tajawal",
  "Readex Pro": "Readex Pro Variable",
  "Noto Kufi Arabic": "Noto Kufi Arabic Variable",
  Inter: "Inter Variable",
  "Space Grotesk": "Space Grotesk Variable",
  "IBM Plex Mono": "IBM Plex Mono",
};

const LOADERS: Record<string, () => Promise<unknown>> = {
  Cairo: () => import("@fontsource-variable/cairo"),
  Tajawal: async () => {
    await Promise.all([
      import("@fontsource/tajawal/400.css"),
      import("@fontsource/tajawal/500.css"),
      import("@fontsource/tajawal/700.css"),
      import("@fontsource/tajawal/800.css"),
    ]);
  },
  "Readex Pro": () => import("@fontsource-variable/readex-pro"),
  "Noto Kufi Arabic": () => import("@fontsource-variable/noto-kufi-arabic"),
  Inter: () => import("@fontsource-variable/inter"),
  "IBM Plex Mono": async () => {
    await Promise.all([import("@fontsource/ibm-plex-mono/400.css"), import("@fontsource/ibm-plex-mono/500.css")]);
  },
};

export function cssFamily(name: string): string {
  return FONT_FAMILIES[name] ?? name;
}

const loaded = new Set<string>();

/**
 * Loads the CSS for these kit fonts and waits until the browser has the faces for both
 * scripts, so the first frame measures and draws with the real font.
 */
/** A few Arabic letters, so the Arabic subset of a face is the one that loads. */
const ARABIC_PROBE = String.fromCodePoint(0x631, 0x641, 0x64a, 0x642);

export async function ensureFonts(names: string[], weights: number[] = [400, 500, 700, 800]): Promise<string[]> {
  const missing: string[] = [];
  for (const name of new Set(names)) {
    if (loaded.has(name)) continue;
    await LOADERS[name]?.().catch(() => undefined);
    const family = cssFamily(name);
    if (typeof document !== "undefined" && document.fonts) {
      const results = await Promise.all(
        weights.flatMap((w) => [
          document.fonts.load(`${w} 32px "${family}"`, ARABIC_PROBE),
          document.fonts.load(`${w} 32px "${family}"`, "Rafiq 0123"),
        ]),
      ).catch(() => [] as FontFace[][]);
      if (!results.some((faces) => faces.length)) {
        missing.push(name);
        continue;
      }
    }
    loaded.add(name);
  }
  return missing;
}
