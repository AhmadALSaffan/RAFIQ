/**
 * The project's files: drop or pick to upload, put one into the scene, make captions from a
 * video's speech, a voice-over from text, or a stock photo (with its credit kept). The
 * outside services only run when the user presses their button, with their own keys.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { fieldDir } from "../../lib/bidi";
import {
  addStock,
  deleteMotionAsset,
  listMotionAssets,
  motionAssetUrl,
  motionMediaKeys,
  searchStock,
  speakMotion,
  transcribeMotionAsset,
  updateMotionAsset,
  uploadMotionAsset,
  type MotionAsset,
  type StockItem,
} from "../../lib/api";
import { BracketLabel } from "../../components/brand";
import { Button } from "../../components/ui";
import { PhotoIcon, SpinnerIcon, TrashIcon, UploadIcon, VolumeIcon } from "../../components/Icons";
import type { Scene } from "./engine/types";
import { VideoClip } from "./engine/video";
import { addAssetOps, addAudioOps, addLayerOps, newLayer, uniqueId, type Op } from "./sceneEdit";

async function probe(file: File): Promise<{ width?: number; height?: number; duration?: number }> {
  try {
    if (file.type.startsWith("image/")) {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height };
    }
    if (file.type.startsWith("audio/")) {
      const buffer = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(await file.arrayBuffer());
      return { duration: buffer.duration };
    }
  } catch {
    /* the engine reads it again when it's used */
  }
  return {};
}

function assetKey(scene: Scene, asset: MotionAsset): string {
  const existing = Object.entries(scene.assets ?? {}).find(([, a]) => a.src === `asset://${asset.id}`);
  if (existing) return existing[0];
  const base = asset.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9]/g, "") || asset.kind;
  let key = /^[A-Za-z]/.test(base) ? base.slice(0, 24) : `${asset.kind}${base}`.slice(0, 24);
  let n = 2;
  while (scene.assets?.[key]) key = `${key.replace(/\d+$/, "")}${n++}`;
  return key;
}

function entry(asset: MotionAsset) {
  return {
    type: asset.kind,
    src: `asset://${asset.id}`,
    name: asset.name,
    ...(asset.credit ? { credit: asset.credit } : {}),
    ...(asset.license ? { license: asset.license } : {}),
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(asset.duration ? { duration: asset.duration } : {}),
  };
}

export function AssetsPane({ projectId, scene, time, onChange }: { projectId: string; scene: Scene; time: number; onChange: (ops: Op[], summary: string) => void }) {
  const [assets, setAssets] = useState<MotionAsset[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [voText, setVoText] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [stock, setStock] = useState<StockItem[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const list = await listMotionAssets(projectId).catch(() => []);
    setAssets(list);
    const entries = await Promise.all(list.map(async (a) => [a.id, await motionAssetUrl(a.id)] as const));
    setUrls(Object.fromEntries(entries));
  }, [projectId]);

  useEffect(() => {
    void load();
    motionMediaKeys().then(setKeys).catch(() => setKeys({}));
  }, [load]);

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        const meta = await probe(file);
        const asset = await uploadMotionAsset(projectId, file, meta);
        if (asset.kind === "video") {
          // size and length from the file itself
          const clip = new VideoClip(await motionAssetUrl(asset.id));
          try {
            const info = await clip.open();
            await updateMotionAsset(asset.id, { width: info.width, height: info.height, duration: info.duration, meta: { hasAudio: info.hasAudio, codec: info.codec } });
            if (!info.canDecode) setError(t("صيغة الفيديو {n} ما بتنفك هون — رح تنحوّل بـ FFmpeg وقت التصدير", { n: asset.name }));
          } finally {
            clip.dispose();
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    setBusy(null);
    await load();
  }

  function addToScene(asset: MotionAsset) {
    const key = assetKey(scene, asset);
    const ops: Op[] = scene.assets?.[key] ? [] : addAssetOps(scene, key, entry(asset));
    const base = { ...scene, assets: { ...(scene.assets ?? {}), [key]: entry(asset) } } as Scene;
    if (asset.kind === "audio") {
      ops.push(...addAudioOps(base, { id: uniqueId(base, asset.source === "tts" ? "vo" : "music"), source: "asset", asset: key, at: Math.round(time * 10) / 10, gain: asset.source === "tts" ? -6 : -18 }));
    } else {
      const kind = asset.kind === "video" ? "video" : asset.kind === "lottie" ? "image" : "image";
      const layer = newLayer(base, kind, time, { asset: key, ...(asset.kind === "lottie" ? { type: "lottie" } : {}) } as never);
      if (asset.kind === "video" && asset.duration) layer.end = Math.min(scene.composition.duration, layer.start + asset.duration);
      ops.push(...addLayerOps(base, layer));
    }
    onChange(ops, t("ضفت {n} للمشهد", { n: asset.name }));
  }

  async function captions(asset: MotionAsset) {
    setBusy(asset.id);
    setError(null);
    try {
      await transcribeMotionAsset(projectId, asset.id);
      const key = assetKey(scene, asset);
      const ops: Op[] = scene.assets?.[key] ? [] : addAssetOps(scene, key, entry(asset));
      const base = { ...scene, assets: { ...(scene.assets ?? {}), [key]: entry(asset) } } as Scene;
      ops.push(...addLayerOps(base, newLayer(base, "captions", 0, { source: key })));
      onChange(ops, t("ضفت كابشن من كلام {n}", { n: asset.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  async function voiceOver() {
    if (!voText.trim()) return;
    setBusy("tts");
    setError(null);
    try {
      const asset = await speakMotion(projectId, voText.trim());
      await load();
      const key = assetKey(scene, asset);
      const base = { ...scene, assets: { ...(scene.assets ?? {}), [key]: entry(asset) } } as Scene;
      const music = (scene.audio ?? []).find((a) => a.source === "procedural" || /music/i.test(a.id));
      onChange(
        [...addAssetOps(scene, key, entry(asset)), ...addAudioOps(base, { id: uniqueId(base, "vo"), source: "asset", asset: key, at: Math.round(time * 10) / 10, gain: -6, ...(music ? { duck: music.id } : {}) })],
        t("ضفت تعليق صوتي"),
      );
      setVoText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  async function findStock() {
    setBusy("stock");
    setError(null);
    try {
      setStock(await searchStock(keys.unsplash ? "unsplash" : "pexels", stockQuery, scene.composition.height > scene.composition.width ? "portrait" : "landscape"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors"
        style={{ borderColor: drag ? "var(--color-accent)" : "var(--color-border)", color: "var(--color-ink-muted)" }}
      >
        {busy && busy !== "tts" && busy !== "stock" ? <SpinnerIcon className="h-5 w-5" /> : <UploadIcon className="h-5 w-5" />}
        {t("افلت صور، فيديو، صوت أو Lottie هون — أو اضغط تختار")}
        <input ref={input} type="file" multiple accept="image/*,video/*,audio/*,.json,.lottie" className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>

      {error && (
        <p className="rounded-xl px-3 py-2 text-xs" style={{ background: "var(--color-surface-2)", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <BracketLabel>{t("الملفات")}</BracketLabel>
        {assets.length === 0 && (
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("لسا ما في ملفات.")}
          </p>
        )}
        {assets.map((asset) => (
          <div key={asset.id} className="flex items-center gap-3 rounded-xl p-2" style={{ background: "var(--color-surface-2)" }}>
            <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: "var(--color-surface)" }}>
              {asset.kind === "image" && urls[asset.id] ? (
                <img src={urls[asset.id]} alt="" className="h-full w-full object-cover" />
              ) : asset.kind === "video" && urls[asset.id] ? (
                <video src={urls[asset.id]} muted preload="metadata" className="h-full w-full object-cover" />
              ) : asset.kind === "audio" ? (
                <VolumeIcon className="h-5 w-5" />
              ) : (
                <PhotoIcon className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold" dir="auto">
                {asset.name}
              </p>
              <p className="num truncate text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
                {asset.kind}
                {asset.width ? ` · ${asset.width}×${asset.height}` : ""}
                {asset.duration ? ` · ${asset.duration.toFixed(1)}s` : ""}
                {asset.credit ? ` · ${asset.credit}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" onClick={() => addToScene(asset)}>
                {t("للمشهد")}
              </Button>
              {(asset.kind === "video" || asset.kind === "audio") && (
                <Button variant="ghost" onClick={() => void captions(asset)} disabled={busy === asset.id}>
                  {busy === asset.id ? <SpinnerIcon className="h-3.5 w-3.5" /> : t("كابشن")}
                </Button>
              )}
              <button
                aria-label={t("احذف")}
                className="rounded-full p-1.5 hover:bg-[var(--color-surface)]"
                onClick={async () => {
                  await deleteMotionAsset(asset.id);
                  await load();
                }}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <BracketLabel>{t("تعليق صوتي")}</BracketLabel>
        <textarea value={voText} onChange={(e) => setVoText(e.target.value)} rows={3} dir={fieldDir(voText)} placeholder={t("اكتب اللي بدك ينحكى…")} className="resize-none rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("بيتبعت النص لمزوّد الصوت اللي اخترته بالإعدادات.")}
          </p>
          <Button onClick={() => void voiceOver()} disabled={!voText.trim() || busy === "tts"}>
            {busy === "tts" ? <SpinnerIcon className="h-3.5 w-3.5" /> : t("حوّل لصوت")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <BracketLabel>{t("صور مجانية")}</BracketLabel>
        {keys.unsplash || keys.pexels ? (
          <>
            <div className="flex gap-2">
              <input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void findStock()} placeholder={t("دوّر… (بالإنجليزي أفضل)")} className="min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-sm outline-none" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }} dir="auto" />
              <Button onClick={() => void findStock()} disabled={!stockQuery.trim() || busy === "stock"}>
                {busy === "stock" ? <SpinnerIcon className="h-3.5 w-3.5" /> : t("دوّر")}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {stock.map((item) => (
                <button
                  key={`${item.provider}-${item.id}`}
                  title={item.credit}
                  className="group relative aspect-square overflow-hidden rounded-lg"
                  onClick={async () => {
                    setBusy("stock");
                    try {
                      const asset = await addStock(projectId, item);
                      await load();
                      addToScene(asset);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                    setBusy(null);
                  }}
                >
                  <img src={item.thumb} alt={item.alt} className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[9px] text-white opacity-0 group-hover:opacity-100">{item.credit}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("ضيف مفتاح Unsplash أو Pexels من الإعدادات ← الفيديو لتدوّر على صور مجانية (المصدر بينحفظ مع الصورة).")}
          </p>
        )}
      </div>
    </div>
  );
}
