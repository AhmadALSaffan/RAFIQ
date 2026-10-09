/**
 * The editor's tool panel: everything a video editor reaches for, one rail away — text,
 * shapes and charts, icons, the project's media, sound, motion presets, the layer list and
 * the selected layer's properties. Every action is the same kind of patch the model makes.
 */

import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n";
import { BracketLabel } from "../../components/brand";
import { AdjustIcon, BoltIcon, IconsIcon, LayersIcon, MusicIcon, PhotoIcon, PlayIcon, PlusIcon, TrashIcon } from "../../components/Icons";
import { arcPath, arrowPath, ellipsePath, heartPath, polygonPath, rectPath, ringPath, starPath, trianglePath, type Polyline } from "./engine/paths";
import { iconNames, loadIcons, searchIcons } from "./engine/icons";
import { ICON_SETS, isColourIcon } from "./engine/iconSets";
import { IconPreview } from "./IconPreview";
import { mixAudio, toAudioBuffer } from "./engine/audio";
import type { AudioTrack, BrandKit, Gradient, Layer, Scene } from "./engine/types";
import { AssetsPane } from "./AssetsPane";
import { AnimationList, Inspector, PRESET_GROUPS } from "./Inspector";
import { AUDIO_TINT, LayersPanel } from "./LayersPanel";
import { SolidPicker } from "./ColorField";
import { addAudioOps, addLayerOps, newLayer, setField, uniqueId, type Op } from "./sceneEdit";
import { roving } from "../../lib/keyboard";

export type PanelTab = "add" | "icons" | "media" | "audio" | "motion" | "layers" | "props";

const TABS: { id: PanelTab; label: string; Icon: typeof PlusIcon }[] = [
  { id: "add", label: t("إضافة"), Icon: PlusIcon },
  { id: "icons", label: t("أيقونات"), Icon: IconsIcon },
  { id: "media", label: t("وسائط"), Icon: PhotoIcon },
  { id: "audio", label: t("صوت"), Icon: MusicIcon },
  { id: "motion", label: t("حركة"), Icon: BoltIcon },
  { id: "layers", label: t("الطبقات"), Icon: LayersIcon },
  { id: "props", label: t("الخصائص"), Icon: AdjustIcon },
];

const tile = "flex flex-col items-center justify-center gap-1 rounded-xl border p-2 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]";
const tileStyle = { borderColor: "var(--color-border)" } as const;
const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-ink)" } as const;

function svgPath(lines: Polyline[]): string {
  return lines.map((l) => l.points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + (l.closed ? " Z" : "")).join(" ");
}

const SHAPE_PREVIEW: Record<string, string> = {
  rect: svgPath(rectPath(3, 6, 18, 12, 2)),
  circle: svgPath(ellipsePath(4, 4, 16, 16)),
  triangle: svgPath(trianglePath(4, 4, 16, 16)),
  polygon: svgPath(polygonPath(3, 3, 18, 18, 6)),
  star: svgPath(starPath(3, 3, 18, 18, 5)),
  arrow: svgPath(arrowPath(2, 7, 20, 10, true)),
  ring: svgPath(ringPath(3, 3, 18, 18, 4)),
  arc: svgPath(arcPath(3, 3, 18, 18, 0, 270, 3)),
  heart: svgPath(heartPath(3, 4, 18, 16)),
  line: "M3 12 L21 12",
};

const SHAPE_NAMES: Record<string, string> = {
  rect: t("مستطيل"),
  circle: t("دائرة"),
  triangle: t("مثلث"),
  polygon: t("مضلّع"),
  star: t("نجمة"),
  arrow: t("سهم"),
  ring: t("حلقة"),
  arc: t("قوس"),
  heart: t("قلب"),
  line: t("خط"),
};

const BACKGROUNDS: { name: string; paint: Gradient }[] = [
  { name: t("غروب"), paint: { type: "linear", angle: 90, stops: [{ at: 0, color: "#ff7a18" }, { at: 1, color: "#af002d" }] } },
  { name: t("محيط"), paint: { type: "linear", angle: 90, stops: [{ at: 0, color: "#0f2027" }, { at: 0.5, color: "#203a43" }, { at: 1, color: "#2c5364" }] } },
  { name: t("نيون"), paint: { type: "linear", angle: 45, stops: [{ at: 0, color: "#7928ca" }, { at: 1, color: "#ff0080" }] } },
  { name: t("ليل"), paint: { type: "radial", stops: [{ at: 0, color: "#232526" }, { at: 1, color: "#0b0b0b" }] } },
  { name: t("نعناع"), paint: { type: "linear", angle: 90, stops: [{ at: 0, color: "#00b09b" }, { at: 1, color: "#96c93d" }] } },
  { name: t("ذهبي"), paint: { type: "linear", angle: 30, stops: [{ at: 0, color: "#f7971e" }, { at: 1, color: "#ffd200" }] } },
];

const gradientCss = (g: Gradient) => {
  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(", ");
  return g.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${(g.angle ?? 0) + 90}deg, ${stops})`;
};

interface PanelProps {
  scene: Scene;
  kit: BrandKit;
  projectId: string;
  time: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (ops: Op[], summary: string) => void;
}

function AddTab({ scene, kit, time, onSelect, onChange }: PanelProps) {
  const add = (layer: Layer, label: string) => {
    onChange(addLayerOps(scene, layer), t("ضفت {k}", { k: label }));
    onSelect(layer.id);
  };
  const texts: { label: string; make: () => Layer }[] = [
    { label: t("عنوان كبير"), make: () => newLayer(scene, "text", time, { text: t("عنوان كبير"), style: "display" }) },
    { label: t("عنوان"), make: () => newLayer(scene, "text", time, { text: t("عنوان"), style: "headline" }) },
    { label: t("عنوان فرعي"), make: () => newLayer(scene, "text", time, { text: t("عنوان فرعي"), style: "title", color: "brand.muted" }) },
    { label: t("نص"), make: () => newLayer(scene, "text", time, { text: t("نص عادي"), style: "body" }) },
    { label: t("زر أو شارة"), make: () => newLayer(scene, "text", time, { text: t("اطلب الآن"), style: "title", color: "brand.onPrimary", background: { color: "brand.primary", padding: 3, radius: 3 }, animate: [{ preset: "pop", at: time }] }) },
    { label: t("رقم يعدّ"), make: () => newLayer(scene, "text", time, { text: "{count}%", style: "display", color: "brand.primary", animate: [{ preset: "countUp", at: time, to: 95 }] }) },
    { label: t("نص متدرّج"), make: () => newLayer(scene, "text", time, { text: t("عنوان ملوّن"), style: "headline", color: { type: "linear", angle: 0, stops: [{ at: 0, color: "brand.primary" }, { at: 1, color: "brand.accent" }] } }) },
    { label: t("نص بإطار"), make: () => newLayer(scene, "text", time, { text: t("واضح فوق أي صورة"), style: "headline", color: "#ffffff", outline: { color: "#000000", width: 0.6 } }) },
  ];
  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <BracketLabel>{t("نص")}</BracketLabel>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {texts.map((x) => (
            <button key={x.label} type="button" className={`${tile} items-start text-start`} style={tileStyle} onClick={() => add(x.make(), x.label)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <BracketLabel>{t("أشكال")}</BracketLabel>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {Object.entries(SHAPE_PREVIEW).map(([shape, d]) => (
            <button
              key={shape}
              type="button"
              className={tile}
              style={tileStyle}
              title={SHAPE_NAMES[shape]}
              onClick={() =>
                add(
                  newLayer(scene, "shape", time, {
                    shape: shape as Layer["shape"],
                    ...(shape === "line" ? { stroke: "brand.primary", strokeWidth: 3, layout: { anchor: "center", width: 40, height: 2 }, animate: [{ preset: "drawOn", at: time }] } : {}),
                    ...(shape === "ring" || shape === "arc" ? { thickness: 3, animate: [{ preset: "drawOn", at: time }] } : {}),
                    ...(shape === "arrow" ? { layout: { anchor: "center", width: 30, height: 12 } } : {}),
                  }),
                  SHAPE_NAMES[shape],
                )
              }
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
                <path d={d} fill={shape === "line" ? "none" : "currentColor"} fillRule="evenodd" stroke={shape === "line" ? "currentColor" : "none"} strokeWidth={2} />
              </svg>
              {SHAPE_NAMES[shape]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <BracketLabel>{t("رسوم بيانية")}</BracketLabel>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(["bar", "line", "pie", "number"] as const).map((chart) => (
            <button key={chart} type="button" className={tile} style={tileStyle} onClick={() => add(newLayer(scene, "chart", time, { chart, ...(chart === "number" ? { data: { values: [42], unit: "%" } } : {}) }), chart)}>
              {chart}
            </button>
          ))}
        </div>
      </div>
      <div>
        <BracketLabel>{t("خلفية الفيديو")}</BracketLabel>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.name}
              type="button"
              className="h-12 rounded-xl border text-[11px] font-semibold text-white"
              style={{ ...tileStyle, background: gradientCss(b.paint), textShadow: "0 1px 2px rgba(0,0,0,.5)" }}
              onClick={() => onChange([{ op: "replace", path: "/composition/background", value: b.paint }], t("غيّرت خلفية الفيديو"))}
            >
              {b.name}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <SolidPicker kit={kit} value={typeof scene.composition.background === "string" ? scene.composition.background : undefined} onPick={(c) => onChange([{ op: "replace", path: "/composition/background", value: c }], t("غيّرت خلفية الفيديو"))} />
        </div>
      </div>
    </div>
  );
}

function IconsTab({ scene, time, onSelect, onChange }: PanelProps) {
  const [query, setQuery] = useState("");
  const [set, setSet] = useState<string>("");
  const [limit, setLimit] = useState(120);
  const [names, setNames] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [, setReady] = useState(0);
  useEffect(() => {
    void iconNames().then((all) => setCounts(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length]))));
  }, []);
  useEffect(() => setLimit(120), [query, set]);
  useEffect(() => {
    let alive = true;
    const handle = window.setTimeout(async () => {
      const hits = await searchIcons(query, limit, set || undefined);
      await loadIcons(hits);
      if (alive) {
        setNames(hits);
        setReady((n) => n + 1);
      }
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [query, set, limit]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-3 p-3">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("دوّر بالإنجليزي: heart, rocket, github…")} className="rounded-lg border px-2.5 py-1.5 text-xs outline-none" style={inputStyle} dir="ltr" />
      <div className="flex flex-wrap gap-1">
        {[{ prefix: "", name: t("الكل"), colour: false }, ...ICON_SETS].map((s) => {
          const on = set === s.prefix;
          return (
            <button
              key={s.prefix || "all"}
              type="button"
              onClick={() => setSet(s.prefix)}
              className="rounded-full border px-2 py-0.5 text-[10px]"
              style={{ borderColor: on ? "var(--color-inverse)" : "var(--color-border)", background: on ? "var(--color-inverse)" : undefined, color: on ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
              dir="ltr"
              title={s.prefix ? `${counts[s.prefix] ?? ""}` : `${total}`}
            >
              {s.name}
              {s.colour ? " ●" : ""}
            </button>
          );
        })}
      </div>
      <p className="text-[10px]" style={{ color: "var(--color-ink-muted)" }}>
        {t("{n} أيقونة. المعلّمة بـ ● ملوّنة بألوانها (إيموجي، شعارات، أعلام)، والباقي بياخد لون الطبقة.", { n: total.toLocaleString("en") })}
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            className={`${tile} aspect-square`}
            style={tileStyle}
            onClick={() => {
              const layer = newLayer(scene, "icon", time, { icon: name, ...(isColourIcon(name) ? { color: undefined } : {}) });
              onChange(addLayerOps(scene, layer), t("ضفت {k}", { k: name }));
              onSelect(layer.id);
            }}
          >
            <IconPreview name={name} />
          </button>
        ))}
      </div>
      {names.length >= limit && (
        <button type="button" onClick={() => setLimit((l) => l + 120)} className="rounded-full border py-1 text-xs" style={tileStyle}>
          {t("أكتر")}
        </button>
      )}
      {!names.length && (
        <p className="py-4 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("ما في أيقونة بهالاسم — جرّب كلمة تانية بالإنجليزي.")}
        </p>
      )}
    </div>
  );
}

const PATTERN_LIST: { id: string; label: string }[] = [
  { id: "warm-lofi", label: t("لوفاي دافئ") },
  { id: "upbeat", label: t("حماسي") },
  { id: "cinematic", label: t("سينمائي") },
  { id: "minimal", label: t("هادئ") },
  { id: "corporate", label: t("شركات") },
];
const SFX_LIST = ["whoosh", "swoosh", "pop", "click", "tick", "ding", "riser", "impact", "typing"] as const;

let previewCtx: AudioContext | null = null;
async function playPreview(track: AudioTrack, seconds: number) {
  const scene = { version: 1, composition: { width: 16, height: 16, fps: 30, duration: seconds }, layers: [], audio: [{ ...track, at: 0 }] } as unknown as Scene;
  const mix = await mixAudio({ scene, open: async () => null });
  previewCtx ??= new AudioContext({ sampleRate: 48000 });
  await previewCtx.resume();
  const src = previewCtx.createBufferSource();
  src.buffer = toAudioBuffer(mix.channels);
  src.connect(previewCtx.destination);
  src.start();
}

function AudioTab({ scene, time, selected, onSelect, onChange }: PanelProps) {
  const tracks = scene.audio ?? [];
  const index = tracks.findIndex((a) => `audio:${a.id}` === selected);
  const current = index >= 0 ? tracks[index] : null;
  const setTrack = (field: keyof AudioTrack, value: unknown, summary: string) => {
    if (!current) return;
    const has = field in current;
    if (value === undefined) {
      if (has) onChange([{ op: "remove", path: `/audio/${index}/${field}` }], summary);
      return;
    }
    onChange([{ op: has ? "replace" : "add", path: `/audio/${index}/${field}`, value }], summary);
  };
  const addTrack = (track: AudioTrack, label: string) => {
    onChange(addAudioOps(scene, track), t("ضفت {k}", { k: label }));
    onSelect(`audio:${track.id}`);
  };
  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <BracketLabel>{t("موسيقى")}</BracketLabel>
        <div className="mt-2 flex flex-col gap-1">
          {PATTERN_LIST.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs" style={tileStyle}>
              <button type="button" className="rounded-full p-1 hover:bg-[var(--color-surface-2)]" aria-label={t("اسمع")} title={t("اسمع")} onClick={() => void playPreview({ id: "p", source: "procedural", pattern: p.id, gain: -6 }, 6)}>
                <PlayIcon className="h-3.5 w-3.5" />
              </button>
              <span className="flex-1">{p.label}</span>
              <button type="button" className="rounded-full border px-2 py-0.5 text-[11px]" style={tileStyle} onClick={() => addTrack({ id: uniqueId(scene, "music"), source: "procedural", pattern: p.id, gain: -10, fadeIn: 0.5, fadeOut: 1.2 }, p.label)}>
                {t("ضيف")}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <BracketLabel>{t("مؤثرات عند {s} ث", { s: Math.round(time * 10) / 10 })}</BracketLabel>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {SFX_LIST.map((kind) => (
            <div key={kind} className="flex items-center rounded-xl border text-[11px]" style={tileStyle}>
              <button type="button" className="rounded-full p-1.5" aria-label={t("اسمع")} title={t("اسمع")} onClick={() => void playPreview({ id: "s", source: "sfx", kind }, 1.5)}>
                <PlayIcon className="h-3 w-3" />
              </button>
              <button type="button" className="flex-1 py-1.5 text-start" dir="ltr" onClick={() => addTrack({ id: uniqueId(scene, kind), source: "sfx", kind, at: Math.round(time * 100) / 100, gain: -6 }, kind)}>
                {kind}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <BracketLabel>{t("المسارات")}</BracketLabel>
        <div className="mt-2 flex flex-col gap-1">
          {tracks.length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("ما في صوت لسا. ضيف موسيقى أو مؤثر، أو ارفع ملف من «وسائط».")}
            </p>
          )}
          {tracks.map((tr) => {
            const on = `audio:${tr.id}` === selected;
            return (
              <button key={tr.id} type="button" onClick={() => onSelect(`audio:${tr.id}`)} className="flex items-center gap-2 rounded-lg px-2 py-1 text-start text-xs" style={{ background: on ? "var(--color-surface-2)" : undefined, boxShadow: on ? `inset 0 0 0 1px ${AUDIO_TINT}` : undefined }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AUDIO_TINT }} />
                <span className="min-w-0 flex-1 truncate" dir="ltr">
                  {tr.id}
                </span>
                <span className="text-[10px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                  {tr.pattern ?? tr.kind ?? tr.source}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {current && (
        <div className="flex flex-col gap-2 rounded-xl p-2.5" style={{ background: "var(--color-surface-2)" }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs" dir="ltr">
              {current.id}
            </span>
            <button type="button" className="rounded-full p-1" style={{ color: "var(--color-danger)" }} aria-label={t("احذف")} title={t("احذف")} onClick={() => (onChange([{ op: "remove", path: `/audio/${index}` }], t("حذفت {id}", { id: current.id })), onSelect(null))}>
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <AudioSlider label={t("الصوت (dB)")} value={current.gain ?? 0} min={-40} max={6} step={1} onCommit={(v) => setTrack("gain", v, t("غيّرت صوت {id}", { id: current.id }))} />
          <AudioSlider label={t("يمين / يسار")} value={current.pan ?? 0} min={-1} max={1} step={0.1} onCommit={(v) => setTrack("pan", v || undefined, t("غيّرت توازن {id}", { id: current.id }))} />
          {current.source !== "sfx" && (
            <>
              <AudioSlider label={t("ظهور تدريجي (ث)")} value={current.fadeIn ?? 0} min={0} max={5} step={0.1} onCommit={(v) => setTrack("fadeIn", v || undefined, t("غيّرت ظهور {id}", { id: current.id }))} />
              <AudioSlider label={t("اختفاء تدريجي (ث)")} value={current.fadeOut ?? 0} min={0} max={5} step={0.1} onCommit={(v) => setTrack("fadeOut", v || undefined, t("غيّرت اختفاء {id}", { id: current.id }))} />
              <label className="flex items-center gap-2 text-[11px]">
                <input type="checkbox" checked={!!current.loop} onChange={(e) => setTrack("loop", e.target.checked || undefined, t("تكرار {id}", { id: current.id }))} />
                {t("كرّر للآخر")}
              </label>
            </>
          )}
          {current.source !== "procedural" && current.source !== "sfx" && (
            <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("وطّي هالمسار لما يحكي")}
              <select value={current.duck ?? ""} onChange={(e) => setTrack("duck", e.target.value || undefined, t("غيّرت التوطية"))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                <option value="">—</option>
                {tracks
                  .filter((x) => x.id !== current.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function AudioSlider({ label, value, min, max, step, onCommit }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="flex flex-col gap-0.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
      <span className="flex justify-between">
        {label}
        <span className="num" dir="ltr">
          {v}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => v !== value && onCommit(v)} onKeyUp={() => v !== value && onCommit(v)} className="accent-[var(--color-ink)]" dir="ltr" />
    </label>
  );
}

function MotionTab({ scene, time, selected, onChange }: PanelProps) {
  const layer = useMemo(() => {
    const walk = (layers: Layer[]): Layer | null => {
      for (const l of layers) {
        if (l.id === selected) return l;
        const hit = l.children ? walk(l.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    return selected ? walk(scene.layers) : null;
  }, [scene, selected]);
  if (!layer) {
    return (
      <p className="p-6 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("اختار طبقة لتضيفلها حركة.")}
      </p>
    );
  }
  const at = Math.round(Math.max(layer.start, Math.min(time, layer.end - 0.3)) * 10) / 10;
  const setAnimations = (next: NonNullable<Layer["animate"]>, summary: string) => onChange(setField(scene, layer.id, "animate", next.length ? next : undefined), summary);
  return (
    <div className="flex flex-col gap-4 p-3">
      {PRESET_GROUPS.map((group) => (
        <div key={group.label}>
          <BracketLabel>{group.label}</BracketLabel>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {group.presets.map((preset) => (
              <button key={preset} type="button" className={tile} style={tileStyle} dir="ltr" onClick={() => setAnimations([...(layer.animate ?? []), { preset, at }], t("ضفت حركة لـ {id}", { id: layer.id }))}>
                {preset}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <BracketLabel>{t("حركات الطبقة")}</BracketLabel>
        <div className="mt-2">
          <AnimationList layer={layer} time={time} onChange={setAnimations} />
        </div>
      </div>
    </div>
  );
}

export function EditorPanel({ tab, onTab, ...props }: PanelProps & { tab: PanelTab; onTab: (tab: PanelTab) => void }) {
  const { scene, kit, projectId, time, selected, onSelect, onChange } = props;
  const selectedLayer = useMemo(() => {
    const walk = (layers: Layer[]): Layer | null => {
      for (const l of layers) {
        if (l.id === selected) return l;
        const hit = l.children ? walk(l.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    return selected && !selected.startsWith("audio:") ? walk(scene.layers) : null;
  }, [scene, selected]);

  return (
    <div className="flex h-full min-h-0">
      <div ref={roving} className="flex w-14 shrink-0 flex-col items-center gap-1 border-e py-2" style={{ borderColor: "var(--color-border)" }} role="tablist" aria-label={t("أدوات")} aria-orientation="vertical">
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTab(id)}
              title={label}
              className="flex w-12 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] transition-colors"
              style={{ background: on ? "var(--color-surface-2)" : undefined, color: on ? "var(--color-ink)" : "var(--color-ink-muted)" }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {tab === "add" && <AddTab {...props} />}
        {tab === "icons" && <IconsTab {...props} />}
        {tab === "media" && <AssetsPane projectId={projectId} scene={scene} time={time} onChange={onChange} />}
        {tab === "audio" && <AudioTab {...props} />}
        {tab === "motion" && <MotionTab {...props} />}
        {tab === "layers" && <LayersPanel scene={scene} selected={selected} onSelect={onSelect} onChange={onChange} />}
        {tab === "props" &&
          (selectedLayer ? (
            <Inspector scene={scene} kit={kit} layer={selectedLayer} time={time} onChange={onChange} onSelect={onSelect} />
          ) : selected?.startsWith("audio:") ? (
            <AudioTab {...props} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
              <LayersIcon className="h-6 w-6" />
              {t("اختار طبقة من المعاينة أو الـ timeline لتعدّلها — أو احكي للموديل بالشات.")}
            </div>
          ))}
      </div>
    </div>
  );
}
