/**
 * Edits from the page become JSON Patch operations — the same kind of change the model
 * makes — so every hand edit is a version, shows in the chat, and can be undone.
 */

import { t } from "../../i18n";
import type { MotionTrack } from "./pieces";
import type { AudioTrack, Layer, Scene } from "./engine/types";

export type Op = { op: "add" | "remove" | "replace" | "move" | "copy" | "test"; path: string; value?: unknown; from?: string };

/** JSON Pointer to a layer by id, nested groups included. */
export function layerPath(scene: Scene, id: string): string | null {
  const find = (layers: Layer[], base: string): string | null => {
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].id === id) return `${base}/${i}`;
      if (layers[i].children?.length) {
        const hit = find(layers[i].children!, `${base}/${i}/children`);
        if (hit) return hit;
      }
    }
    return null;
  };
  return find(scene.layers, "/layers");
}

export function findLayer(scene: Scene, id: string): Layer | null {
  const walk = (layers: Layer[]): Layer | null => {
    for (const l of layers) {
      if (l.id === id) return l;
      const hit = l.children ? walk(l.children) : null;
      if (hit) return hit;
    }
    return null;
  };
  return walk(scene.layers);
}

/** Sets one field of a layer (add or replace, whichever applies). */
export function setField(scene: Scene, id: string, field: string, value: unknown): Op[] {
  const path = layerPath(scene, id);
  if (!path) return [];
  const layer = findLayer(scene, id) as Record<string, unknown> | null;
  if (value === undefined) return layer && field in layer ? [{ op: "remove", path: `${path}/${field}` }] : [];
  return [{ op: layer && field in layer ? "replace" : "add", path: `${path}/${field}`, value }];
}

export function uniqueId(scene: Scene, base: string): string {
  const taken = new Set<string>();
  const walk = (layers: Layer[]) => layers.forEach((l) => (taken.add(l.id), l.children && walk(l.children)));
  walk(scene.layers);
  (scene.audio ?? []).forEach((a) => taken.add(a.id));
  let clean = base.replace(/[^A-Za-z0-9_-]/g, "") || "layer";
  if (!/^[A-Za-z]/.test(clean)) clean = `l${clean}`;
  let out = clean.slice(0, 30);
  let n = 2;
  while (taken.has(out)) out = `${clean.slice(0, 28)}${n++}`;
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

/** What a layer is called in lists: its name, else its text, else what it shows. */
export function layerLabel(layer: Layer): string {
  return String(layer.name ?? layer.text ?? layer.icon?.replace(/^(tabler|si):/, "") ?? layer.chart ?? layer.shape ?? layer.asset ?? layer.type).slice(0, 40);
}

/** The timeline's rows: the picture's layers front first (the way a layer list reads —
 * the top row is drawn on top), groups' children under them, then every audio track. */
export function tracksFromScene(scene: Scene): MotionTrack[] {
  const rows: MotionTrack[] = [];
  const walk = (layers: Layer[], depth: number) => {
    for (const layer of [...layers].reverse()) {
      const label = layerLabel(layer);
      rows.push({
        id: layer.id,
        name: layer.name ?? layer.id,
        type: layer.type,
        hidden: layer.hidden,
        locked: layer.locked,
        depth,
        kind: layer.type === "video" ? "video" : "layer",
        clips: [{ id: layer.id, start: layer.start, end: layer.end, label: String(label).slice(0, 40) }],
        keyframes: [
          ...new Set([
            ...(layer.animate ?? []).map((a) => round(a.at)),
            ...Object.values(layer.keyframes ?? {}).flatMap((keys) => (keys ?? []).map((k) => round(k.t))),
          ]),
        ].filter((x) => x >= layer.start && x <= layer.end),
      });
      if (layer.children?.length) walk(layer.children, depth + 1);
    }
  };
  walk(scene.layers, 0);
  const d = scene.composition.duration;
  for (const track of scene.audio ?? []) {
    const start = track.at ?? 0;
    const end = track.end ?? (track.source === "sfx" ? Math.min(d, start + 0.6) : d);
    const beats: number[] = [];
    if (track.source === "procedural") {
      const beat = 60 / (track.tempo ?? 96);
      for (let x = start; x < end; x += beat * 4) beats.push(round(x));
    }
    rows.push({
      id: `audio:${track.id}`,
      name: track.id,
      kind: "audio",
      type: track.source,
      clips: [{ id: `audio:${track.id}`, start, end: Math.max(start + 0.1, end), label: track.pattern ?? track.kind ?? track.asset ?? track.source }],
      beats,
    });
  }
  return rows;
}

/** A clip moved or trimmed on the timeline → the patch that says so. */
export function clipPatch(scene: Scene, trackId: string, start: number, end: number): { ops: Op[]; summary: string } {
  const s = round(start);
  const e = round(end);
  if (trackId.startsWith("audio:")) {
    const id = trackId.slice(6);
    const index = (scene.audio ?? []).findIndex((a) => a.id === id);
    if (index < 0) return { ops: [], summary: "" };
    const track = scene.audio![index];
    const ops: Op[] = [{ op: track.at === undefined ? "add" : "replace", path: `/audio/${index}/at`, value: s }];
    if (track.source !== "sfx") ops.push({ op: track.end === undefined ? "add" : "replace", path: `/audio/${index}/end`, value: e });
    return { ops, summary: t("حرّكت الصوت {id} لـ {s}–{e} ث", { id, s, e }) };
  }
  const layer = findLayer(scene, trackId);
  const path = layerPath(scene, trackId);
  if (!layer || !path) return { ops: [], summary: "" };
  const shift = s - layer.start;
  const ops: Op[] = [
    { op: "replace", path: `${path}/start`, value: s },
    { op: "replace", path: `${path}/end`, value: e },
  ];
  // A move carries the animations with it; a trim leaves them where they are.
  const moved = Math.abs(e - layer.end - shift) < 1e-6 && Math.abs(shift) > 1e-6;
  if (moved && layer.animate?.length) {
    ops.push({ op: "replace", path: `${path}/animate`, value: layer.animate.map((a) => ({ ...a, at: round(a.at + shift) })) });
  }
  return { ops, summary: moved ? t("حرّكت {id} لـ {s} ث", { id: trackId, s }) : t("غيّرت مدة {id} ({s}–{e} ث)", { id: trackId, s, e }) };
}

/** A new layer from the add menu, placed in the middle of the scene's current moment. */
export function newLayer(scene: Scene, kind: "text" | "shape" | "icon" | "image" | "video" | "chart" | "captions", at: number, extra: Partial<Layer> = {}): Layer {
  const d = scene.composition.duration;
  const start = round(Math.min(Math.max(0, at), Math.max(0, d - 1)));
  const end = round(Math.min(d, start + 3));
  const base = { id: uniqueId(scene, kind), start, end };
  switch (kind) {
    case "text":
      return { ...base, type: "text", text: t("نص جديد"), style: "headline", layout: { anchor: "center" }, animate: [{ preset: "fadeUp", at: start }], ...extra };
    case "shape":
      return { ...base, type: "shape", shape: "rect", fill: "brand.primary", radius: 2, layout: { anchor: "center", width: 24, height: 24 }, animate: [{ preset: "scaleIn", at: start }], ...extra };
    case "icon":
      return { ...base, type: "icon", icon: "tabler:sparkles", color: "brand.primary", layout: { anchor: "center", width: 16, height: 16 }, animate: [{ preset: "pop", at: start }], ...extra };
    case "chart":
      return { ...base, type: "chart", chart: "bar", color: "brand.primary", data: { labels: ["A", "B", "C"], values: [3, 5, 8] }, layout: { anchor: "center", width: 80, height: 48 }, ...extra };
    case "captions":
      return { ...base, start: 0, end: d, type: "captions", style: "title", captionStyle: "pop", maxWords: 4, layout: { anchor: "bottom", y: -24 }, ...extra };
    default:
      return { ...base, start: 0, end: d, type: kind, fit: "cover", ...extra } as Layer;
  }
}

export function addLayerOps(_scene: Scene, layer: Layer): Op[] {
  return [{ op: "add", path: "/layers/-", value: layer }];
}

export function addAudioOps(scene: Scene, track: AudioTrack): Op[] {
  return scene.audio ? [{ op: "add", path: "/audio/-", value: track }] : [{ op: "add", path: "/audio", value: [track] }];
}

export function addAssetOps(scene: Scene, key: string, value: unknown): Op[] {
  return scene.assets ? [{ op: "add", path: `/assets/${key}`, value }] : [{ op: "add", path: "/assets", value: { [key]: value } }];
}

/** Applies ops locally (optimistic UI) — the agent validates the real thing. */
export function applyOps(scene: Scene, ops: Op[]): Scene {
  const doc = structuredClone(scene) as unknown as Record<string, unknown>;
  const tokens = (p: string) => p.split("/").slice(1).map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"));
  const parentOf = (path: string): [Record<string, unknown> | unknown[], string] => {
    const parts = tokens(path);
    let node: unknown = doc;
    for (const k of parts.slice(0, -1)) node = (node as Record<string, unknown>)[k];
    return [node as Record<string, unknown> | unknown[], parts[parts.length - 1]];
  };
  for (const op of ops) {
    const [parent, key] = parentOf(op.path);
    if (op.op === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
    } else if (op.op === "add") {
      if (Array.isArray(parent)) parent.splice(key === "-" ? parent.length : Number(key), 0, structuredClone(op.value));
      else parent[key] = structuredClone(op.value);
    } else if (op.op === "replace") {
      if (Array.isArray(parent)) parent[Number(key)] = structuredClone(op.value);
      else parent[key] = structuredClone(op.value);
    } else if (op.op === "move" && op.from) {
      const [source, from] = parentOf(op.from);
      const value = Array.isArray(source) ? source.splice(Number(from), 1)[0] : source[from];
      if (!Array.isArray(source)) delete source[from];
      const [target, to] = parentOf(op.path);
      if (Array.isArray(target)) target.splice(to === "-" ? target.length : Number(to), 0, value);
      else target[to] = value;
    }
  }
  return doc as unknown as Scene;
}

/** The moments worth looking at in a review: just after each part comes in, the busiest
 * moment (most layers on screen), and the last frame — at most six, none closer than 0.3 s. */
export function reviewTimes(scene: Scene, max = 6): number[] {
  const d = scene.composition.duration;
  const clamp = (t: number) => Math.min(d - 0.05, Math.max(0, t));
  const layers = scene.layers;
  const on = (t: number) => layers.filter((l) => l.start <= t && t < l.end).length;
  let busiest = 0;
  let most = -1;
  for (let t = 0; t < d; t += 0.25) {
    const n = on(t);
    if (n > most) {
      most = n;
      busiest = t;
    }
  }
  const entries = [...new Set(layers.map((l) => l.start))].sort((a, b) => a - b).map((s) => clamp(s + 0.8));
  const picked: number[] = [];
  for (const t of [clamp(busiest + 0.5), d - 0.05, ...entries]) {
    if (picked.length >= max) break;
    if (picked.every((p) => Math.abs(p - t) >= 0.3)) picked.push(Math.round(t * 100) / 100);
  }
  return picked.sort((a, b) => a - b);
}

/** Where a layer sits: its list's pointer, its index, and the list. */
export function layerSlot(scene: Scene, id: string): { list: Layer[]; base: string; index: number } | null {
  const find = (layers: Layer[], base: string): { list: Layer[]; base: string; index: number } | null => {
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].id === id) return { list: layers, base, index: i };
      if (layers[i].children?.length) {
        const hit = find(layers[i].children!, `${base}/${i}/children`);
        if (hit) return hit;
      }
    }
    return null;
  };
  return find(scene.layers, "/layers");
}

/** Moves a layer within its list. Drawing order: a higher index is drawn later — on top. */
export function moveLayerOps(scene: Scene, id: string, to: "up" | "down" | "front" | "back" | number): Op[] {
  const slot = layerSlot(scene, id);
  if (!slot) return [];
  const last = slot.list.length - 1;
  const target =
    to === "up" ? slot.index + 1 : to === "down" ? slot.index - 1 : to === "front" ? last : to === "back" ? 0 : to;
  const index = Math.max(0, Math.min(last, target));
  if (index === slot.index) return [];
  return [{ op: "move", from: `${slot.base}/${slot.index}`, path: `${slot.base}/${index}` }];
}

export function removeLayerOps(scene: Scene, id: string): Op[] {
  const path = layerPath(scene, id);
  return path ? [{ op: "remove", path }] : [];
}

/** A copy right above the original, with fresh ids (children too). */
export function duplicateLayerOps(scene: Scene, id: string): { ops: Op[]; id: string } | null {
  const slot = layerSlot(scene, id);
  if (!slot) return null;
  const copy = structuredClone(slot.list[slot.index]);
  const working = structuredClone(scene);
  const renew = (layer: Layer) => {
    layer.id = uniqueId(working, layer.id);
    working.layers.push({ ...layer, children: undefined });
    layer.children?.forEach(renew);
  };
  renew(copy);
  return { ops: [{ op: "add", path: `${slot.base}/${slot.index + 1}`, value: copy }], id: copy.id };
}

/** Every layer with its depth, front first — the layer list's rows. */
export function layerRows(scene: Scene): { layer: Layer; depth: number; index: number; count: number }[] {
  const rows: { layer: Layer; depth: number; index: number; count: number }[] = [];
  const walk = (layers: Layer[], depth: number) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      rows.push({ layer: layers[i], depth, index: i, count: layers.length });
      if (layers[i].children?.length) walk(layers[i].children!, depth + 1);
    }
  };
  walk(scene.layers, 0);
  return rows;
}
