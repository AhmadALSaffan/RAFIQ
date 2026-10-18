/**
 * Picks one of the ~600 Google Fonts the identity builder offers: search, a class filter and
 * an "has Arabic" switch, each family previewed in itself. A family's preview loads only
 * when its row scrolls into view, and only the few letters it shows (css2's `text=`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FontEntry } from "../../lib/types";
import { ChevronDownIcon, SearchIcon } from "../../components/Icons";
import { t } from "../../i18n";

type FontClass = FontEntry["class"] | "all";

const CLASSES: [FontClass, string][] = [
  ["all", t("الكل")],
  ["sans", t("حديث")],
  ["serif", t("كلاسيكي")],
  ["display", t("للعناوين")],
  ["handwriting", t("خط يد")],
  ["mono", t("برمجي")],
];

const loaded = new Set<string>();

/** Loads just enough of `name` to draw `sample` (once per family and sample). */
function loadPreview(name: string, sample: string) {
  const key = `${name}|${sample}`;
  if (loaded.has(key)) return;
  loaded.add(key);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}&text=${encodeURIComponent(sample)}&display=swap`;
  document.head.appendChild(link);
}

function sampleFor(font: FontEntry): string {
  return font.arabic ? t("هويتك Aa") : "Aa Gg 123";
}

function FontRow({ font, selected, onPick }: { font: FontEntry; selected: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const sample = sampleFor(font);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loadPreview(font.name, sample + font.name);
          io.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [font.name, sample]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-[var(--color-surface-2)]"
      style={{ background: selected ? "var(--color-surface-2)" : undefined, boxShadow: selected ? "inset 0 0 0 1px var(--color-inverse)" : undefined }}
    >
      <span className="min-w-0 flex-1 truncate text-[19px] leading-tight" style={{ fontFamily: `"${font.name}", var(--font-sans)` }} dir="auto">
        {sample}
      </span>
      <span className="shrink-0 truncate text-[11px]" style={{ color: "var(--color-ink-muted)", fontFamily: `"${font.name}", var(--font-sans)`, maxWidth: "48%" }} dir="ltr">
        {font.name}
      </span>
    </button>
  );
}

export function FontPicker({
  label,
  value,
  fonts,
  arabicFirst,
  onChange,
}: {
  label: string;
  value: string;
  fonts: FontEntry[];
  /** Start with only the families that have Arabic (headings and body of an Arabic page). */
  arabicFirst: boolean;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cls, setCls] = useState<FontClass>("all");
  const [arabicOnly, setArabicOnly] = useState(arabicFirst);
  const current = fonts.find((f) => f.name === value);

  useEffect(() => {
    if (current) loadPreview(current.name, sampleFor(current) + current.name);
  }, [current]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts.filter((f) => (!arabicOnly || f.arabic) && (cls === "all" || f.class === cls) && (!q || f.name.toLowerCase().includes(q)));
  }, [fonts, query, cls, arabicOnly]);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-start text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ borderColor: open ? "var(--color-inverse)" : "var(--color-border)" }}
      >
        <span className="w-20 shrink-0" style={{ color: "var(--color-ink-muted)" }}>
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px]" style={{ fontFamily: `"${value}", var(--font-sans)` }} dir="ltr">
          {value}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined, color: "var(--color-ink-muted)" }} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-xl border p-2" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <label className="flex items-center gap-2 rounded-lg px-2" style={{ background: "var(--color-surface-2)" }}>
            <SearchIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder={t("دوّر على خط…")}
              className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
              dir="auto"
            />
            <span className="text-[10px] tabular-nums" style={{ color: "var(--color-ink-muted)" }}>
              {shown.length}
            </span>
          </label>
          <div className="flex flex-wrap gap-1">
            {CLASSES.map(([key, name]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCls(key)}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: cls === key ? "var(--color-inverse)" : "var(--color-border)",
                  background: cls === key ? "var(--color-inverse)" : "transparent",
                  color: cls === key ? "var(--color-on-inverse)" : "var(--color-ink-muted)",
                }}
              >
                {name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setArabicOnly((v) => !v)}
              aria-pressed={arabicOnly}
              className="rounded-full border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: arabicOnly ? "var(--color-accent)" : "var(--color-border)",
                color: arabicOnly ? "var(--color-ink)" : "var(--color-ink-muted)",
                background: arabicOnly ? "color-mix(in srgb, var(--color-accent) 14%, transparent)" : "transparent",
              }}
            >
              {t("فيه عربي")}
            </button>
          </div>
          <div className="flex max-h-72 flex-col overflow-y-auto">
            {shown.length === 0 && (
              <p className="px-2 py-4 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("ما في خط بهالاسم")}
              </p>
            )}
            {shown.map((font) => (
              <FontRow
                key={font.name}
                font={font}
                selected={font.name === value}
                onPick={() => {
                  onChange(font.name);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
