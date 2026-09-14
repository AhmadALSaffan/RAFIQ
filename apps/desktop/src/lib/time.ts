/** The backend stores UTC timestamps; SQLite drops the offset, so treat bare ISO strings as UTC. */
export function parseUtc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

export function timeAgo(iso: string): string {
  const seconds = Math.round((parseUtc(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

const dayFormat = new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long" });
const clockFormat = new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" });

/** "اليوم" / "أمس" / "الثلاثاء ١٢ مارس" — the label above a day's first message. */
export function dayLabel(iso: string): string {
  const date = parseUtc(iso);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(date)) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  return dayFormat.format(date);
}

export function clockTime(iso: string): string {
  return clockFormat.format(parseUtc(iso));
}

/** True when this message opens a new calendar day in the transcript. */
export function isNewDay(previousIso: string | undefined, iso: string): boolean {
  if (!previousIso) return true;
  return parseUtc(previousIso).toDateString() !== parseUtc(iso).toDateString();
}
