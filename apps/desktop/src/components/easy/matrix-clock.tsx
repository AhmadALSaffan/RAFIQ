/* EasyUI (airport-matrix-clock) by Suraj Maurya, MIT — adapted for Rafiq (Arabic city names beside the dot-matrix time, cities of the region, theme tokens, RTL, language). See THIRD_PARTY_NOTICES.md. */
import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { t } from "../../i18n";

/** The cities on offer: the region first, then the places people work with. */
export const CLOCK_CITIES = {
  riyadh: { name: t("الرياض"), zone: "Asia/Riyadh" },
  dubai: { name: t("دبي"), zone: "Asia/Dubai" },
  cairo: { name: t("القاهرة"), zone: "Africa/Cairo" },
  amman: { name: t("عمّان"), zone: "Asia/Amman" },
  beirut: { name: t("بيروت"), zone: "Asia/Beirut" },
  damascus: { name: t("دمشق"), zone: "Asia/Damascus" },
  baghdad: { name: t("بغداد"), zone: "Asia/Baghdad" },
  istanbul: { name: t("إسطنبول"), zone: "Europe/Istanbul" },
  moscow: { name: t("موسكو"), zone: "Europe/Moscow" },
  london: { name: t("لندن"), zone: "Europe/London" },
  berlin: { name: t("برلين"), zone: "Europe/Berlin" },
  new_york: { name: t("نيويورك"), zone: "America/New_York" },
  san_francisco: { name: t("سان فرانسيسكو"), zone: "America/Los_Angeles" },
  delhi: { name: t("دلهي"), zone: "Asia/Kolkata" },
  tokyo: { name: t("طوكيو"), zone: "Asia/Tokyo" },
} as const;
export type ClockCity = keyof typeof CLOCK_CITIES;
export const MAX_CLOCK_CITIES = 3;

// 5×7 dots per character: digits and the colon are all a clock needs.
const GLYPHS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
const DOTS = Array.from({ length: 35 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5) }));
const R = 0.4;
const path = (char: string | null) =>
  DOTS.filter(({ x, y }) => char === null || GLYPHS[char][y][x] === "1")
    .map(({ x, y }) => `M${x - R},${y}a${R},${R} 0 1,0 ${R * 2},0a${R},${R} 0 1,0 ${-R * 2},0`)
    .join("");
const OFF = path(null);
const ON = Object.fromEntries(Object.keys(GLYPHS).map((c) => [c, path(c)])) as Record<string, string>;

const Glyph = memo(function Glyph({ char, size }: { char: string; size: number }) {
  return (
    <svg aria-hidden viewBox="-0.5 -0.5 5 7" className="block overflow-visible" style={{ width: size, height: (size * 7) / 5 }}>
      <path d={OFF} fill="currentColor" opacity="0.12" />
      <path d={ON[char] ?? ON[" "]} fill="currentColor" />
    </svg>
  );
});

/** One character that flips to its new value like a departures board. */
const Cell = memo(function Cell({ char, index, size, flip, reduced }: { char: string; index: number; size: number; flip: number; reduced: boolean }) {
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden" style={{ width: size, height: (size * 7) / 5 }} aria-hidden>
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={`${char}-${flip}`}
          initial={reduced ? false : { y: "72%", opacity: 0.4 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: "-72%", opacity: 0.4 }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30, mass: 0.5, delay: Math.min(index * 0.015, 0.09) }}
          className="absolute inset-0"
        >
          <Glyph char={char} size={size} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
});

function timeIn(zone: string, now: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour").padStart(2, "0")}:${part("minute")}`;
}

/** How far a zone is from the user's own clock, in hours ("+3", "−5", or nothing). */
function offsetFrom(zone: string, now: number): string {
  const at = (z?: string) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: z, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
    const v = (type: string) => Number(p.find((x) => x.type === type)?.value ?? 0);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"));
  };
  const hours = Math.round(((at(zone) - at(undefined)) / 3_600_000) * 2) / 2;
  if (!hours) return "";
  return `${hours > 0 ? "+" : "−"}${Math.abs(hours)}`;
}

function Row({ label, sub, zone, now, size, onRemove, reduced }: { label: string; sub?: string; zone?: string; now: number; size: number; onRemove?: () => void; reduced: boolean }) {
  const [flip, setFlip] = useState(0);
  const time = timeIn(zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, now);
  return (
    <li
      onPointerEnter={(e) => e.pointerType !== "touch" && setFlip((f) => f + 1)}
      className="group flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
      style={{ borderColor: "color-mix(in oklch, currentColor 14%, transparent)" }}
      aria-label={`${label} ${time}`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{label}</p>
        {sub && (
          <p className="num text-[11px] opacity-60">
            <bdi dir={/^[+−]/.test(sub) ? "ltr" : undefined}>{sub}</bdi>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("شيل {0}", { 0: label })}
            className="grid h-6 w-6 place-items-center rounded-md text-sm opacity-0 transition-opacity hover:bg-[color-mix(in_oklch,currentColor_12%,transparent)] focus-visible:opacity-100 group-hover:opacity-70"
          >
            ×
          </button>
        )}
        <span dir="ltr" className="flex gap-[2px]">
          {Array.from(time).map((c, i) => (
            <Cell key={i} char={c} index={i} size={size} flip={flip} reduced={reduced} />
          ))}
        </span>
      </div>
    </li>
  );
}

/**
 * The time where you are — set big in dots, like an airport departures board — and in up
 * to three other cities, each with how many hours it is ahead or behind. Hovering a row
 * flips its digits.
 */
export function MatrixClock({ cities, onChange }: { cities: ClockCity[]; onChange: (cities: ClockCity[]) => void }) {
  const reduced = useReducedMotion() ?? false;
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // Ticks on the minute, so the board changes exactly when the clock does.
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 20);
    };
    id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 20);
    return () => clearTimeout(id);
  }, []);

  const free = useMemo(() => (Object.keys(CLOCK_CITIES) as ClockCity[]).filter((c) => !cities.includes(c)), [cities]);
  const today = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date(now));

  return (
    <div>
      <ul className="m-0 list-none p-0">
        <Row label={t("هون")} sub={today} now={now} size={20} reduced={reduced} />
        {cities.map((id) => (
          <Row
            key={id}
            label={CLOCK_CITIES[id].name}
            sub={offsetFrom(CLOCK_CITIES[id].zone, now) || t("نفس الوقت")}
            zone={CLOCK_CITIES[id].zone}
            now={now}
            size={12}
            reduced={reduced}
            onRemove={() => onChange(cities.filter((c) => c !== id))}
          />
        ))}
      </ul>
      {cities.length < MAX_CLOCK_CITIES &&
        (adding ? (
          <select
            autoFocus
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onChange([...cities, e.target.value as ClockCity]);
              setAdding(false);
            }}
            onBlur={() => setAdding(false)}
            aria-label={t("زيد مدينة")}
            className="mt-2 w-full rounded-lg border bg-transparent px-2 py-1.5 text-xs"
            style={{ borderColor: "color-mix(in oklch, currentColor 20%, transparent)", color: "inherit" }}
          >
            <option value="" disabled>
              {t("اختار مدينة")}
            </option>
            {free.map((id) => (
              <option key={id} value={id} style={{ color: "#121212" }}>
                {CLOCK_CITIES[id].name}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-2 text-xs opacity-60 transition-opacity hover:opacity-100">
            {t("+ زيد مدينة")}
          </button>
        ))}
    </div>
  );
}
