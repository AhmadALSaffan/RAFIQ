/**
 * A still of each reel, for its cards outside the project (the motion page, the chat). The
 * engine only runs inside an open project — it's the heaviest thing in the app — so the
 * project saves a small picture of itself while it's open, and the cards show that.
 * Kept in this browser's storage: a few kilobytes each, the newest 60.
 */

const KEY = "rafiq-motion-posters";
const MAX = 60;

type Saved = Record<string, { version: number; url: string; at: number }>;

function read(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Saved;
  } catch {
    return {};
  }
}

export function posterFor(id: string): string | null {
  return read()[id]?.url ?? null;
}

export function posterVersion(id: string): number | null {
  return read()[id]?.version ?? null;
}

export function savePoster(id: string, version: number, url: string): void {
  const all = read();
  all[id] = { version, url, at: Date.now() };
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // storage full or off: the cards show their plain face instead
  }
}

export function forgetPoster(id: string): void {
  const all = read();
  if (!(id in all)) return;
  delete all[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* nothing to undo */
  }
}

/** A frame as a small JPEG data URL (a PNG of a reel is several times bigger). */
export async function posterFrom(png: Blob, maxSide = 360): Promise<string> {
  const bitmap = await createImageBitmap(png);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.78);
}
