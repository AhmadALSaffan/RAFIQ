/**
 * A colour for a layer: the kit's colours one click away, any colour by picker or hex, or a
 * gradient (linear or radial, its angle and stops). The kit keeps a video on brand; it
 * doesn't fence the user in.
 */

import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { isGradient, paintColor, resolveColor } from "./engine/brand";
import type { BrandKit, Gradient, Paint } from "./engine/types";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-ink)" } as const;

/** One colour: swatches, the system picker and a hex field. */
export function SolidPicker({ kit, value, onPick, allowTransparent = false }: { kit: BrandKit; value: string | undefined; onPick: (color: string) => void; allowTransparent?: boolean }) {
  const resolved = value ? resolveColor(kit, value) : "#ffffff";
  const [hex, setHex] = useState(value?.startsWith("#") ? value : resolved);
  useEffect(() => setHex(value?.startsWith("#") ? value : resolved), [value, resolved]);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(kit.colors).map(([role, color]) => {
          const token = `brand.${role}`;
          return (
            <button
              key={role}
              type="button"
              onClick={() => onPick(token)}
              title={token}
              aria-label={token}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{ background: color, borderColor: value === token ? "var(--color-accent)" : "var(--color-border)" }}
            />
          );
        })}
        {allowTransparent && (
          <button
            type="button"
            onClick={() => onPick("transparent")}
            title={t("شفاف")}
            aria-label={t("شفاف")}
            className="h-6 w-6 rounded-full border-2"
            style={{
              borderColor: value === "transparent" ? "var(--color-accent)" : "var(--color-border)",
              background: "repeating-conic-gradient(#999 0 25%, #eee 0 50%) 50% / 8px 8px",
            }}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={HEX.test(hex) && hex.length === 7 ? hex : resolved.slice(0, 7)}
          onChange={(e) => setHex(e.target.value)}
          onBlur={(e) => e.target.value !== resolved && onPick(e.target.value)}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label={t("اختار لون")}
        />
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value.trim())}
          onBlur={() => HEX.test(hex) && hex !== value && onPick(hex.toLowerCase())}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-24 rounded-lg border px-2 py-1 font-mono text-xs outline-none"
          style={{ ...inputStyle, borderColor: HEX.test(hex) ? "var(--color-border)" : "var(--color-danger)" }}
          dir="ltr"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

const css = (kit: BrandKit, g: Gradient) => {
  const stops = g.stops.map((s) => `${resolveColor(kit, s.color)} ${Math.round(s.at * 100)}%`).join(", ");
  return g.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${(g.angle ?? 0) + 90}deg, ${stops})`;
};

/** A paint: solid or gradient, with a preview strip. */
export function ColorField({ kit, value, onCommit, allowTransparent = false }: { kit: BrandKit; value: Paint | undefined; onCommit: (paint: Paint) => void; allowTransparent?: boolean }) {
  const gradient = isGradient(value) ? value : null;
  const [stop, setStop] = useState(0);
  const toGradient = () => {
    const base = paintColor(kit, value);
    onCommit({ type: "linear", angle: 90, stops: [{ at: 0, color: base }, { at: 1, color: "brand.accent" }] });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 rounded-full p-0.5 text-[11px]" style={{ background: "var(--color-surface-2)" }}>
        {(["solid", "gradient"] as const).map((mode) => {
          const on = mode === (gradient ? "gradient" : "solid");
          return (
            <button
              key={mode}
              type="button"
              onClick={() => (mode === "gradient" ? !gradient && toGradient() : gradient && onCommit(paintColor(kit, gradient)))}
              className="flex-1 rounded-full px-2 py-0.5"
              style={{ background: on ? "var(--color-inverse)" : undefined, color: on ? "var(--color-on-inverse)" : "var(--color-ink-muted)" }}
            >
              {mode === "solid" ? t("لون") : t("تدرّج")}
            </button>
          );
        })}
      </div>
      {!gradient ? (
        <SolidPicker kit={kit} value={typeof value === "string" ? value : undefined} onPick={onCommit} allowTransparent={allowTransparent} />
      ) : (
        <>
          <div className="relative h-6 rounded-md" style={{ background: css(kit, gradient) }}>
            {gradient.stops.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStop(i)}
                aria-label={t("نقطة {n}", { n: i + 1 })}
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                style={{ left: `${s.at * 100}%`, background: resolveColor(kit, s.color), borderColor: stop === i ? "var(--color-accent)" : "#fff" }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            <label className="flex flex-col gap-0.5">
              {t("النوع")}
              <select
                value={gradient.type}
                onChange={(e) => onCommit({ ...gradient, type: e.target.value as Gradient["type"] })}
                className="rounded-lg border px-1.5 py-1 text-xs"
                style={inputStyle}
              >
                <option value="linear">{t("خطّي")}</option>
                <option value="radial">{t("دائري")}</option>
              </select>
            </label>
            {gradient.type === "linear" && (
              <label className="flex flex-col gap-0.5">
                {t("الزاوية")} <span className="num" dir="ltr">{gradient.angle ?? 0}°</span>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={15}
                  defaultValue={gradient.angle ?? 0}
                  onPointerUp={(e) => onCommit({ ...gradient, angle: Number((e.target as HTMLInputElement).value) })}
                  className="accent-[var(--color-ink)]"
                  dir="ltr"
                />
              </label>
            )}
          </div>
          <SolidPicker
            kit={kit}
            value={gradient.stops[stop]?.color}
            onPick={(color) => onCommit({ ...gradient, stops: gradient.stops.map((s, i) => (i === stop ? { ...s, color } : s)) })}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={gradient.stops.length >= 8}
              onClick={() => {
                const stops = [...gradient.stops, { at: 0.5, color: gradient.stops[stop]?.color ?? "brand.primary" }].sort((a, b) => a.at - b.at);
                onCommit({ ...gradient, stops });
              }}
              className="rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-40"
              style={inputStyle}
            >
              {t("+ نقطة")}
            </button>
            <button
              type="button"
              disabled={gradient.stops.length <= 2}
              onClick={() => {
                onCommit({ ...gradient, stops: gradient.stops.filter((_, i) => i !== stop) });
                setStop(0);
              }}
              className="rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-40"
              style={inputStyle}
            >
              {t("شيل النقطة")}
            </button>
            <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("مكانها")}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                key={`${stop}-${gradient.stops[stop]?.at}`}
                defaultValue={gradient.stops[stop]?.at ?? 0}
                onPointerUp={(e) => onCommit({ ...gradient, stops: gradient.stops.map((s, i) => (i === stop ? { ...s, at: Number((e.target as HTMLInputElement).value) } : s)) })}
                className="w-20 accent-[var(--color-ink)]"
                dir="ltr"
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
