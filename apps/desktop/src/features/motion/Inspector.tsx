/**
 * The selected layer's properties, in sections a video editor would have: content, type,
 * shape, look (opacity, blend, shadow, glow), position, time, motion. Every change is a patch
 * on the scene (and a line in the chat), never a private copy: text and numbers commit when
 * the field is left, choices at once.
 */

import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { fieldDir } from "../../lib/bidi";
import { BracketLabel } from "../../components/brand";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CopyIcon, EyeIcon, EyeOffIcon, LockIcon, TrashIcon, UnlockIcon } from "../../components/Icons";
import { loadIcons, searchIcons } from "./engine/icons";
import { IconPreview } from "./IconPreview";
import type { Animation, BrandKit, Layer, PresetName, Scene, ShadowSpec } from "./engine/types";
import { ColorField, SolidPicker } from "./ColorField";
import { duplicateLayerOps, layerLabel, moveLayerOps, removeLayerOps, setField, type Op } from "./sceneEdit";
import { roving } from "../../lib/keyboard";

export const PRESET_GROUPS: { label: string; presets: PresetName[] }[] = [
  { label: t("دخول"), presets: ["fadeIn", "fadeUp", "fadeDown", "slideIn", "scaleIn", "pop", "bounceIn", "blurIn", "rotateIn", "maskReveal", "wipe", "drawOn"] },
  { label: t("نص"), presets: ["typewriter", "wordPop", "lineReveal", "countUp"] },
  { label: t("تأكيد"), presets: ["zoomPunch", "pulse", "shake", "float", "spin", "kenBurns"] },
  { label: t("خروج"), presets: ["fadeOut", "slideOut", "scaleOut"] },
];
const PRESETS: PresetName[] = PRESET_GROUPS.flatMap((g) => g.presets);
const EASES = ["outExpo", "inOut", "linear", "outBack", "spring", "in", "out", "brand"];
const ANCHORS = [
  ["topStart", "top", "topEnd"],
  ["start", "center", "end"],
  ["bottomStart", "bottom", "bottomEnd"],
] as const;
const STYLES = ["display", "headline", "title", "body", "caption"] as const;
const SHAPES = ["rect", "circle", "triangle", "polygon", "star", "line", "arrow", "ring", "arc", "heart", "path"] as const;

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-ink)" } as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({ title, children, open: initial = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between" aria-expanded={open}>
        <BracketLabel>{title}</BracketLabel>
        <ChevronDownIcon className="h-3.5 w-3.5 transition-transform" style={{ transform: open ? undefined : "rotate(90deg)", color: "var(--color-ink-muted)" }} />
      </button>
      {open && <div className="mt-2.5 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

function NumberInput({ value, onCommit, step = 1, min, max, integer = false }: { value: number | undefined; onCommit: (v: number | undefined) => void; step?: number; min?: number; max?: number; integer?: boolean }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    if (text.trim() === "") return onCommit(undefined);
    let n = Number(text);
    if (!Number.isFinite(n)) return setText(value === undefined ? "" : String(value));
    if (integer) n = Math.round(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onCommit(n);
    else setText(String(n));
  };
  return (
    <input
      type="number"
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className="num w-full rounded-lg border px-2 py-1 text-xs outline-none"
      style={inputStyle}
      dir="ltr"
    />
  );
}

/** A slider that saves once, when it's let go. */
function Slider({ value, min, max, step, onCommit, format }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void; format?: (v: number) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== value && onCommit(v)}
        onKeyUp={() => v !== value && onCommit(v)}
        className="min-w-0 flex-1 accent-[var(--color-ink)]"
        dir="ltr"
      />
      <span className="num w-10 shrink-0 text-end text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
        {format ? format(v) : v}
      </span>
    </div>
  );
}

function Chips<T extends string>({ items, value, onPick, label = (x: T) => x }: { items: readonly T[]; value: T | undefined; onPick: (v: T) => void; label?: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => {
        const on = item === value;
        return (
          <button
            key={item}
            type="button"
            onClick={() => onPick(item)}
            className="rounded-full border px-2.5 py-1 text-[11px]"
            style={{ borderColor: on ? "var(--color-inverse)" : "var(--color-border)", background: on ? "var(--color-inverse)" : "transparent", color: on ? "var(--color-on-inverse)" : "var(--color-ink)" }}
          >
            {label(item)}
          </button>
        );
      })}
    </div>
  );
}

export function Inspector({
  scene,
  kit,
  layer,
  time,
  onChange,
  onSelect,
}: {
  scene: Scene;
  kit: BrandKit;
  layer: Layer;
  time: number;
  onChange: (ops: Op[], summary: string) => void;
  onSelect: (id: string | null) => void;
}) {
  const set = (field: string, value: unknown, summary: string) => onChange(setField(scene, layer.id, field, value), summary);
  const [text, setText] = useState(layer.text ?? "");
  const [name, setName] = useState(layer.name ?? "");
  const [iconQuery, setIconQuery] = useState("");
  const [iconHits, setIconHits] = useState<string[]>([]);
  useEffect(() => setText(layer.text ?? ""), [layer.id, layer.text]);
  useEffect(() => setName(layer.name ?? ""), [layer.id, layer.name]);
  useEffect(() => {
    if (layer.type !== "icon" || !iconQuery.trim()) return setIconHits([]);
    let alive = true;
    void searchIcons(iconQuery, 40).then(async (hits) => {
      await loadIcons(hits);
      if (alive) setIconHits(hits);
    });
    return () => {
      alive = false;
    };
  }, [iconQuery, layer.type]);

  const id = layer.id;
  const layout = layer.layout ?? {};
  const setLayout = (key: string, value: unknown, summary: string) => {
    const next = { ...layout, [key]: value };
    if (value === undefined) delete (next as Record<string, unknown>)[key];
    set("layout", Object.keys(next).length ? next : undefined, summary);
  };
  const animations = layer.animate ?? [];
  const setAnimations = (next: Animation[], summary: string) => set("animate", next.length ? next : undefined, summary);
  const shadow: ShadowSpec | null = layer.shadow === true ? { color: "#000000", blur: 3, y: 0.8, opacity: 0.45 } : layer.shadow ? layer.shadow : null;
  const others = scene.layers.filter((l) => l.id !== id);
  const textual = layer.type === "text" || layer.type === "captions";
  const picture = layer.type === "video" || layer.type === "image";

  const iconButton = "rounded-full p-1.5 hover:bg-[var(--color-surface-2)]";
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <BracketLabel>{layer.type}</BracketLabel>
          <span className="truncate font-mono text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
            {id}
          </span>
        </div>
        <input
          value={name}
          placeholder={layerLabel(layer)}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== (layer.name ?? "") && set("name", name.trim() || undefined, t("سمّيت {id}", { id }))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="rounded-lg border px-2 py-1 text-sm font-semibold outline-none"
          style={inputStyle}
          dir={fieldDir(name)}
          aria-label={t("اسم الطبقة")}
        />
        <div className="flex flex-wrap gap-0.5">
          <button type="button" title={layer.hidden ? t("أظهر") : t("أخفِ")} aria-label={layer.hidden ? t("أظهر") : t("أخفِ")} className={iconButton} onClick={() => set("hidden", layer.hidden ? undefined : true, layer.hidden ? t("أظهرت {id}", { id }) : t("أخفيت {id}", { id }))}>
            {layer.hidden ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
          <button type="button" title={layer.locked ? t("فك القفل") : t("اقفل")} aria-label={layer.locked ? t("فك القفل") : t("اقفل")} className={iconButton} onClick={() => set("locked", layer.locked ? undefined : true, layer.locked ? t("فكّيت قفل {id}", { id }) : t("قفلت {id}", { id }))}>
            {layer.locked ? <LockIcon className="h-4 w-4" /> : <UnlockIcon className="h-4 w-4" />}
          </button>
          <button type="button" title={t("لقدّام")} aria-label={t("لقدّام")} className={iconButton} onClick={() => onChange(moveLayerOps(scene, id, "up"), t("قدّمت {id}", { id }))}>
            <ArrowUpIcon className="h-4 w-4" />
          </button>
          <button type="button" title={t("لورا")} aria-label={t("لورا")} className={iconButton} onClick={() => onChange(moveLayerOps(scene, id, "down"), t("رجّعت {id} لورا", { id }))}>
            <ArrowDownIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("كرّر")}
            aria-label={t("كرّر")}
            className={iconButton}
            onClick={() => {
              const dup = duplicateLayerOps(scene, id);
              if (!dup) return;
              onChange(dup.ops, t("كرّرت {id}", { id }));
              onSelect(dup.id);
            }}
          >
            <CopyIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("احذف")}
            aria-label={t("احذف")}
            className={iconButton}
            style={{ color: "var(--color-danger)" }}
            onClick={() => {
              onChange(removeLayerOps(scene, id), t("حذفت {id}", { id }));
              onSelect(null);
            }}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {textual && (
        <Section title={t("النص")}>
          {layer.type === "text" && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => text !== (layer.text ?? "") && set("text", text, t("غيّرت نص {id}", { id }))}
              rows={3}
              dir={fieldDir(text)}
              className="resize-y rounded-lg border px-2 py-1.5 text-sm outline-none"
              style={inputStyle}
            />
          )}
          <Field label={t("الستايل")}>
            <Chips items={STYLES} value={layer.style ?? "body"} onPick={(s) => set("style", s, t("غيّرت ستايل {id} لـ {s}", { id, s }))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("الوزن")}>
              <select value={layer.weight ?? ""} onChange={(e) => set("weight", e.target.value ? Number(e.target.value) : undefined, t("غيّرت وزن {id}", { id }))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                <option value="">{t("تلقائي")}</option>
                {[400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("محاذاة")}>
              <select value={layer.align ?? ""} onChange={(e) => set("align", e.target.value || undefined, t("غيّرت محاذاة {id}", { id }))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                <option value="">{t("تلقائي")}</option>
                <option value="start">{t("البداية")}</option>
                <option value="center">{t("الوسط")}</option>
                <option value="end">{t("النهاية")}</option>
              </select>
            </Field>
            <Field label={t("الخط")}>
              <select value={layer.font ?? ""} onChange={(e) => set("font", e.target.value || undefined, t("غيّرت خط {id}", { id }))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                <option value="">{t("حسب الستايل")}</option>
                <option value="display">{kit.fonts.display}</option>
                <option value="body">{kit.fonts.body}</option>
                <option value="latin">{kit.fonts.latin}</option>
                <option value="mono">{kit.fonts.mono ?? "IBM Plex Mono"}</option>
              </select>
            </Field>
          </div>
          <Field label={t("لون النص")}>
            <ColorField kit={kit} value={layer.color ?? "brand.onSurface"} onCommit={(c) => set("color", c, t("غيّرت لون {id}", { id }))} />
          </Field>
          <Field label={t("إطار حول الحروف")}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => set("outline", layer.outline ? undefined : { color: "#000000", width: 0.6 }, t("إطار نص {id}", { id }))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                {layer.outline ? t("مفعّل") : t("بدون")}
              </button>
              {layer.outline && (
                <div className="min-w-0 flex-1">
                  <Slider value={layer.outline.width ?? 0.6} min={0.1} max={4} step={0.1} onCommit={(w) => set("outline", { ...layer.outline, width: w }, t("إطار نص {id}", { id }))} />
                </div>
              )}
            </div>
            {layer.outline && <SolidPicker kit={kit} value={layer.outline.color} onPick={(c) => set("outline", { ...layer.outline, color: c }, t("إطار نص {id}", { id }))} />}
          </Field>
          <Field label={t("خلفية للنص")}>
            <button
              type="button"
              onClick={() => set("background", layer.background ? undefined : { color: "brand.surface2", padding: 2, radius: 2 }, t("خلفية نص {id}", { id }))}
              className="self-start rounded-lg border px-2 py-1 text-xs"
              style={inputStyle}
            >
              {layer.background ? t("مفعّلة") : t("بدون")}
            </button>
            {layer.background && (
              <>
                <ColorField kit={kit} value={layer.background.color ?? "brand.surface2"} onCommit={(c) => set("background", { ...layer.background, color: c }, t("خلفية نص {id}", { id }))} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("الحشوة")}>
                    <NumberInput value={layer.background.padding ?? 2} min={0} max={12} onCommit={(v) => set("background", { ...layer.background, padding: v }, t("خلفية نص {id}", { id }))} />
                  </Field>
                  <Field label={t("الحواف")}>
                    <NumberInput value={layer.background.radius ?? 2} min={0} max={3} integer onCommit={(v) => set("background", { ...layer.background, radius: v }, t("خلفية نص {id}", { id }))} />
                  </Field>
                </div>
              </>
            )}
          </Field>
          {layer.type === "captions" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("شكل الكابشن")}>
                <select value={layer.captionStyle ?? "pop"} onChange={(e) => set("captionStyle", e.target.value, t("غيّرت شكل الكابشن"))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                  <option value="pop">pop</option>
                  <option value="highlight">highlight</option>
                  <option value="karaoke">karaoke</option>
                </select>
              </Field>
              <Field label={t("كلمات بالسطر")}>
                <NumberInput value={layer.maxWords ?? 4} min={1} max={12} integer onCommit={(v) => set("maxWords", v, t("غيّرت عدد كلمات الكابشن"))} />
              </Field>
            </div>
          )}
        </Section>
      )}

      {layer.type === "shape" && (
        <Section title={t("الشكل")}>
          <Chips items={SHAPES} value={layer.shape ?? "rect"} onPick={(s) => set("shape", s, t("غيّرت شكل {id}", { id }))} />
          {(layer.shape === "polygon" || layer.shape === "star") && (
            <Field label={layer.shape === "star" ? t("عدد الرؤوس") : t("عدد الأضلاع")}>
              <Slider value={layer.points ?? (layer.shape === "star" ? 5 : 6)} min={3} max={24} step={1} onCommit={(n) => set("points", n, t("غيّرت شكل {id}", { id }))} />
            </Field>
          )}
          {(layer.shape === "ring" || layer.shape === "arc") && (
            <Field label={t("السماكة")}>
              <Slider value={layer.thickness ?? 3} min={0.5} max={30} step={0.5} onCommit={(n) => set("thickness", n, t("غيّرت شكل {id}", { id }))} />
            </Field>
          )}
          {layer.shape === "arc" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("من (درجة)")}>
                <NumberInput value={layer.arc?.from ?? 0} min={-360} max={720} onCommit={(v) => set("arc", { from: v ?? 0, to: layer.arc?.to ?? 270 }, t("غيّرت القوس"))} />
              </Field>
              <Field label={t("لـ (درجة)")}>
                <NumberInput value={layer.arc?.to ?? 270} min={-360} max={720} onCommit={(v) => set("arc", { from: layer.arc?.from ?? 0, to: v ?? 270 }, t("غيّرت القوس"))} />
              </Field>
            </div>
          )}
          {layer.shape === "arrow" && (
            <Field label={t("الاتجاه")}>
              <Chips items={["end", "start"] as const} value={layer.pointing ?? "end"} label={(v) => (v === "end" ? t("لقدّام") : t("لورا"))} onPick={(v) => set("pointing", v, t("غيّرت اتجاه السهم"))} />
            </Field>
          )}
          {layer.shape !== "line" && (
            <Field label={t("التعبئة")}>
              <ColorField kit={kit} value={layer.fill ?? "brand.primary"} allowTransparent onCommit={(c) => set("fill", c, t("غيّرت لون {id}", { id }))} />
            </Field>
          )}
          <Field label={t("الحد")}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => set("stroke", layer.stroke ? undefined : "brand.onSurface", t("حد {id}", { id }))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
                {layer.stroke ? t("مفعّل") : t("بدون")}
              </button>
              {(layer.stroke || layer.shape === "line") && (
                <div className="min-w-0 flex-1">
                  <Slider value={layer.strokeWidth ?? (layer.shape === "line" ? 2 : 1)} min={0.5} max={20} step={0.5} onCommit={(w) => set("strokeWidth", w, t("سماكة حد {id}", { id }))} />
                </div>
              )}
            </div>
            {(layer.stroke || layer.shape === "line") && (
              <>
                <SolidPicker kit={kit} value={layer.stroke ?? (typeof layer.fill === "string" ? layer.fill : "brand.primary")} onPick={(c) => set("stroke", c, t("حد {id}", { id }))} />
                <label className="flex items-center gap-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  <input type="checkbox" checked={!!layer.dash} onChange={(e) => set("dash", e.target.checked ? [2, 1] : undefined, t("خط متقطّع {id}", { id }))} />
                  {t("متقطّع")}
                </label>
              </>
            )}
          </Field>
          {(layer.shape ?? "rect") === "rect" && (
            <Field label={t("الحواف (من سلّم الـ kit)")}>
              <div className="flex gap-1">
                {kit.radius.map((r, i) => (
                  <button key={i} type="button" onClick={() => set("radius", i, t("غيّرت حواف {id}", { id }))} className="num rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: (layer.radius ?? 0) === i ? "var(--color-inverse)" : "var(--color-border)" }}>
                    {r >= 999 ? "◯" : r}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </Section>
      )}

      {layer.type === "icon" && (
        <Section title={t("الأيقونة")}>
          <input value={iconQuery} onChange={(e) => setIconQuery(e.target.value)} placeholder={layer.icon} className="rounded-lg border px-2 py-1 text-xs outline-none" style={inputStyle} dir="ltr" />
          {iconHits.length > 0 && (
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {iconHits.map((n) => (
                <button key={n} type="button" title={n} onClick={() => set("icon", n, t("غيّرت الأيقونة لـ {n}", { n }))} className="flex h-10 w-10 items-center justify-center rounded-md border" style={inputStyle}>
                  <IconPreview name={n} />
                </button>
              ))}
            </div>
          )}
          <Field label={t("اللون")}>
            <ColorField kit={kit} value={layer.color ?? "brand.onSurface"} onCommit={(c) => set("color", c, t("غيّرت لون {id}", { id }))} />
          </Field>
        </Section>
      )}

      {picture && (
        <Section title={t("الصورة والفيديو")}>
          {layer.type === "video" && (
            <div className="grid grid-cols-3 gap-2">
              <Field label={t("من (ث)")}>
                <NumberInput value={layer.in ?? 0} step={0.1} min={0} onCommit={(v) => set("in", v, t("قصّيت بداية {id}", { id }))} />
              </Field>
              <Field label={t("السرعة")}>
                <NumberInput value={layer.speed ?? 1} step={0.25} min={0.1} max={16} onCommit={(v) => set("speed", v, t("غيّرت سرعة {id}", { id }))} />
              </Field>
              <Field label={t("الصوت")}>
                <NumberInput value={layer.volume ?? 1} step={0.1} min={0} max={2} onCommit={(v) => set("volume", v, t("غيّرت صوت {id}", { id }))} />
              </Field>
            </div>
          )}
          <Field label={t("الملاءمة")}>
            <div className="flex flex-wrap gap-1">
              <Chips items={["cover", "contain"] as const} value={layer.fit ?? "cover"} onPick={(f) => set("fit", f, t("غيّرت ملاءمة {id}", { id }))} />
              {scene.composition.width < scene.composition.height && (
                <button type="button" onClick={() => set("crop", { x: 0.34, y: 0, w: 0.32, h: 1 }, t("قصّيت {id} لـ 9:16", { id }))} className="rounded-full border px-2.5 py-1 text-[11px]" style={inputStyle}>
                  {t("قص لـ 9:16")}
                </button>
              )}
            </div>
          </Field>
          {(["brightness", "contrast", "saturation", "warmth", "vignette"] as const).map((k) => (
            <Field key={k} label={k}>
              <Slider
                value={layer.filters?.[k] ?? (k === "warmth" || k === "vignette" ? 0 : 1)}
                min={k === "warmth" ? -1 : 0}
                max={k === "warmth" || k === "vignette" ? 1 : 2}
                step={0.05}
                onCommit={(v) => set("filters", { ...layer.filters, [k]: v }, t("ظبطت ألوان {id}", { id }))}
              />
            </Field>
          ))}
        </Section>
      )}

      {layer.type === "chart" && (
        <Section title={t("الرسم البياني")}>
          <Chips items={["bar", "line", "pie", "number"] as const} value={layer.chart ?? "bar"} onPick={(c) => set("chart", c, t("غيّرت نوع الرسم"))} />
          <Field label={t("القيم (مفصولة بفاصلة)")}>
            <input
              defaultValue={(layer.data?.values ?? []).join(", ")}
              onBlur={(e) => {
                const values = e.target.value.split(/[,،]/).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
                if (values.length) set("data", { ...layer.data, values }, t("غيّرت قيم الرسم"));
              }}
              className="num rounded-lg border px-2 py-1 text-xs outline-none"
              style={inputStyle}
              dir="ltr"
            />
          </Field>
          <Field label={t("العناوين (مفصولة بفاصلة)")}>
            <input
              defaultValue={(layer.data?.labels ?? []).join(t("، "))}
              onBlur={(e) => {
                const labels = e.target.value.split(/[,،]/).map((v) => v.trim()).filter(Boolean);
                set("data", { ...layer.data, values: layer.data?.values ?? [], labels }, t("غيّرت عناوين الرسم"));
              }}
              className="rounded-lg border px-2 py-1 text-xs outline-none"
              style={inputStyle}
              dir="auto"
            />
          </Field>
          <Field label={t("اللون")}>
            <SolidPicker kit={kit} value={typeof layer.color === "string" ? layer.color : "brand.primary"} onPick={(c) => set("color", c, t("غيّرت لون {id}", { id }))} />
          </Field>
        </Section>
      )}

      <Section title={t("المظهر")}>
        <Field label={t("الشفافية")}>
          <Slider value={layer.opacity ?? 1} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set("opacity", v >= 1 ? undefined : v, t("غيّرت شفافية {id}", { id }))} />
        </Field>
        <Field label={t("الدمج")}>
          <Chips items={["normal", "multiply", "screen", "overlay"] as const} value={layer.blend ?? "normal"} onPick={(b) => set("blend", b === "normal" ? undefined : b, t("غيّرت دمج {id}", { id }))} />
        </Field>
        <Field label={t("الظل")}>
          <button type="button" onClick={() => set("shadow", shadow ? undefined : { color: "#000000", blur: 3, y: 0.8, opacity: 0.45 }, t("ظل {id}", { id }))} className="self-start rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
            {shadow ? t("مفعّل") : t("بدون")}
          </button>
          {shadow && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Field label={t("النعومة")}>
                  <NumberInput value={shadow.blur ?? 3} min={0} max={40} step={0.5} onCommit={(v) => set("shadow", { ...shadow, blur: v }, t("ظل {id}", { id }))} />
                </Field>
                <Field label="x">
                  <NumberInput value={shadow.x ?? 0} min={-20} max={20} step={0.5} onCommit={(v) => set("shadow", { ...shadow, x: v }, t("ظل {id}", { id }))} />
                </Field>
                <Field label="y">
                  <NumberInput value={shadow.y ?? 0.8} min={-20} max={20} step={0.5} onCommit={(v) => set("shadow", { ...shadow, y: v }, t("ظل {id}", { id }))} />
                </Field>
              </div>
              <Slider value={shadow.opacity ?? 0.45} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => set("shadow", { ...shadow, opacity: v }, t("ظل {id}", { id }))} />
              <SolidPicker kit={kit} value={shadow.color ?? "#000000"} onPick={(c) => set("shadow", { ...shadow, color: c }, t("ظل {id}", { id }))} />
            </>
          )}
        </Field>
        <Field label={t("توهّج")}>
          <button type="button" onClick={() => set("glow", layer.glow ? undefined : { color: "brand.primary", size: 4 }, t("توهّج {id}", { id }))} className="self-start rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
            {layer.glow ? t("مفعّل") : t("بدون")}
          </button>
          {layer.glow && (
            <>
              <Slider value={layer.glow.size ?? 4} min={0.5} max={30} step={0.5} onCommit={(v) => set("glow", { ...layer.glow, size: v }, t("توهّج {id}", { id }))} />
              <SolidPicker kit={kit} value={layer.glow.color ?? "brand.primary"} onPick={(c) => set("glow", { ...layer.glow, color: c }, t("توهّج {id}", { id }))} />
            </>
          )}
        </Field>
      </Section>

      <Section title={t("المكان")}>
        <div className="flex gap-3">
          <div ref={roving} className="grid shrink-0 grid-cols-3 gap-1" role="radiogroup" aria-label={t("المرساة")}>
            {ANCHORS.flat().map((a) => {
              const on = (layout.anchor ?? "center") === a && !layout.below && !layout.above && !layout.beside;
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={a}
                  onClick={() => set("layout", { ...layout, anchor: a, below: undefined, above: undefined, beside: undefined }, t("غيّرت مكان {id}", { id }))}
                  className="h-6 w-6 rounded-md border"
                  style={{ borderColor: on ? "var(--color-accent)" : "var(--color-border)", background: on ? "var(--color-accent)" : "var(--color-surface-2)" }}
                />
              );
            })}
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
            <Field label={t("x (وحدات)")}>
              <NumberInput value={layout.x} integer onCommit={(v) => setLayout("x", v, t("حرّكت {id}", { id }))} />
            </Field>
            <Field label={t("y (وحدات)")}>
              <NumberInput value={layout.y} integer onCommit={(v) => setLayout("y", v, t("حرّكت {id}", { id }))} />
            </Field>
            <Field label={t("العرض")}>
              <NumberInput value={layout.width} integer min={1} onCommit={(v) => setLayout("width", v, t("غيّرت عرض {id}", { id }))} />
            </Field>
            <Field label={t("الارتفاع")}>
              <NumberInput value={layout.height} integer min={1} onCommit={(v) => setLayout("height", v, t("غيّرت ارتفاع {id}", { id }))} />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("تحت طبقة")}>
            <select value={layout.below ?? ""} onChange={(e) => set("layout", { ...layout, below: e.target.value || undefined, above: undefined }, t("غيّرت مكان {id}", { id }))} className="rounded-lg border px-2 py-1 text-xs" style={inputStyle}>
              <option value="">—</option>
              {others.map((l) => (
                <option key={l.id} value={l.id}>
                  {layerLabel(l)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="gap">
            <NumberInput value={layout.gap} integer min={0} onCommit={(v) => setLayout("gap", v, t("غيّرت المسافة"))} />
          </Field>
        </div>
      </Section>

      <Section title={t("الوقت")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("يبلّش (ث)")}>
            <NumberInput value={layer.start} step={0.1} min={0} onCommit={(v) => v !== undefined && v < layer.end && set("start", v, t("غيّرت بداية {id}", { id }))} />
          </Field>
          <Field label={t("يخلص (ث)")}>
            <NumberInput value={layer.end} step={0.1} min={0.1} onCommit={(v) => v !== undefined && v > layer.start && set("end", v, t("غيّرت نهاية {id}", { id }))} />
          </Field>
        </div>
      </Section>

      <Section title={t("الحركة")}>
        <AnimationList layer={layer} time={time} onChange={setAnimations} />
        {animations.length === 0 && (
          <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {t("ما في حركة — ضيف من فوق أو من تبويب «حركة».")}
          </p>
        )}
      </Section>
    </div>
  );
}

/** The layer's animations: add from a list, then tune each one. */
export function AnimationList({ layer, time, onChange }: { layer: Layer; time: number; onChange: (next: Animation[], summary: string) => void }) {
  const animations = layer.animate ?? [];
  const id = layer.id;
  const at = Math.round(Math.max(layer.start, Math.min(time, layer.end - 0.3)) * 10) / 10;
  return (
    <div className="flex flex-col gap-2">
      <select
        value=""
        onChange={(e) => e.target.value && onChange([...animations, { preset: e.target.value as PresetName, at }], t("ضفت حركة لـ {id}", { id }))}
        className="rounded-lg border px-2 py-1 text-xs"
        style={inputStyle}
        aria-label={t("+ حركة")}
      >
        <option value="">{t("+ حركة عند {s} ث", { s: at })}</option>
        {PRESET_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {animations.map((a, i) => (
        <div key={i} className="grid grid-cols-[1fr_60px_60px_24px] items-end gap-1.5 rounded-lg p-2" style={{ background: "var(--color-surface-2)" }}>
          <Field label="preset">
            <select value={a.preset} onChange={(e) => onChange(animations.map((x, j) => (j === i ? { ...x, preset: e.target.value as PresetName } : x)), t("غيّرت حركة {id}", { id }))} className="rounded-md border px-1 py-1 text-[11px]" style={inputStyle}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="at">
            <NumberInput value={a.at} step={0.1} min={0} onCommit={(v) => v !== undefined && onChange(animations.map((x, j) => (j === i ? { ...x, at: v } : x)), t("غيّرت توقيت حركة {id}", { id }))} />
          </Field>
          <Field label={t("المدة")}>
            <NumberInput value={a.duration} step={0.1} min={0.05} onCommit={(v) => onChange(animations.map((x, j) => (j === i ? { ...x, duration: v } : x)), t("غيّرت مدة حركة {id}", { id }))} />
          </Field>
          <button type="button" aria-label={t("احذف")} className="mb-1 rounded-full p-1 hover:bg-[var(--color-surface)]" onClick={() => onChange(animations.filter((_, j) => j !== i), t("شلت حركة من {id}", { id }))}>
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
          <div className="col-span-4 grid grid-cols-2 gap-1.5">
            <select value={a.ease ?? ""} onChange={(e) => onChange(animations.map((x, j) => (j === i ? { ...x, ease: e.target.value || undefined } : x)), t("غيّرت easing {id}", { id }))} className="rounded-md border px-1 py-0.5 text-[10px]" style={inputStyle}>
              <option value="">{t("easing الـ kit")}</option>
              {EASES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            {["slideIn", "slideOut", "maskReveal", "wipe", "rotateIn", "spin"].includes(a.preset) ? (
              <select value={a.dir ?? ""} onChange={(e) => onChange(animations.map((x, j) => (j === i ? { ...x, dir: (e.target.value || undefined) as Animation["dir"] } : x)), t("غيّرت اتجاه حركة {id}", { id }))} className="rounded-md border px-1 py-0.5 text-[10px]" style={inputStyle}>
                <option value="">{t("الاتجاه")}</option>
                <option value="start">{t("البداية")}</option>
                <option value="end">{t("النهاية")}</option>
                <option value="up">{t("فوق")}</option>
                <option value="down">{t("تحت")}</option>
              </select>
            ) : (
              <span />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
