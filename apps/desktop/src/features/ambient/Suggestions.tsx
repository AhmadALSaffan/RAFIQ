/**
 * "I see you do this every week. Shall I?" The offers Rafiq makes from what it noticed, each
 * shown once: yes makes it real, no and it never comes back.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { acceptSuggestion, dismissSuggestion, getSettings, listSuggestions, updateSettings, refreshSuggestions, type Suggestion } from "../../lib/api";
import { notify } from "../../lib/toast";
import { easeOutExpo } from "../../lib/motion";
import { messageDir } from "../../lib/bidi";
import { BulbIcon } from "../../components/Icons";
import { Button } from "../../components/ui";
import { intlLocale, t } from "../../i18n";

function weekdayName(index: number): string {
  // 2024-01-01 was a Monday, and the agent counts from Monday.
  return new Intl.DateTimeFormat(intlLocale(), { weekday: "long" }).format(new Date(2024, 0, 1 + index));
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function folderName(path: string | undefined): string {
  return (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** The sentence for an offer, from its numbers, in the app's language. */
export function offerText(s: Pick<Suggestion, "kind" | "draft">): string {
  const d = s.draft;
  if (s.kind === "folder") {
    return t("نقلت {0} ملفات {1} من {2} لـ {3} بإيدك. أنقلها عنك كل ما ينزل واحد؟", {
      0: d.count,
      1: (d.watch_filter ?? "").replace("*.", ""),
      2: folderName(d.watch),
      3: folderName(d.to_dir),
    });
  }
  if (s.kind === "template") return t("طلبت هاد {0} مرات. أحفظه كقالب بتشغّله بكبسة؟", { 0: d.count });
  if (d.kind === "daily") return t("طلبت هاد {0} مرات، تقريباً كل يوم الساعة {1}. أعمله عنك كل يوم؟", { 0: d.count, 1: hourLabel(d.hour ?? 9) });
  return t("طلبت هاد {0} مرات، وأغلبها يوم {1} الساعة {2}. أعمله عنك كل أسبوع؟", { 0: d.count, 1: weekdayName(d.weekday ?? 0), 2: hourLabel(d.hour ?? 9) });
}

export function Suggestions({ onAccepted }: { onAccepted?: () => void }) {
  const [offers, setOffers] = useState<Suggestion[]>([]);

  useEffect(() => {
    listSuggestions().then(setOffers).catch(() => setOffers([]));
  }, []);

  async function yes(offer: Suggestion) {
    try {
      await acceptSuggestion(offer.id);
      setOffers((all) => all.filter((o) => o.id !== offer.id));
      notify({ type: "success", title: offer.kind === "template" ? t("انحفظ كقالب") : t("صارت مهمة بتشتغل لحالها") });
      onAccepted?.();
    } catch (e) {
      notify({ type: "error", title: e instanceof Error ? e.message : String(e) });
    }
  }

  function no(offer: Suggestion) {
    setOffers((all) => all.filter((o) => o.id !== offer.id));
    void dismissSuggestion(offer.id).catch(() => undefined);
  }

  return (
    <AnimatePresence initial={false}>
      {offers.map((offer) => (
        <motion.div
          key={offer.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: easeOutExpo }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3"
          style={{ borderColor: "color-mix(in oklch, var(--color-accent) 40%, transparent)", background: "var(--color-surface)" }}
        >
          <BulbIcon className="h-5 w-5 shrink-0" style={{ color: "var(--color-accent)" }} />
          <div className="min-w-48 flex-1">
            <p className="text-sm font-medium">{offerText(offer)}</p>
            <p className="mt-0.5 truncate text-xs" style={{ color: "var(--color-ink-muted)" }} dir={messageDir(offer.title)} title={offer.draft.prompt}>
              {offer.title}
            </p>
          </div>
          <Button variant="accent" onClick={() => void yes(offer)}>
            {t("أيوه، اعملها")}
          </Button>
          <Button variant="ghost" onClick={() => no(offer)}>
            {t("لأ، شكراً")}
          </Button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

/** Noticing is off until the user says so: this asks, once, where the schedules are. */
export function NoticeInvite({ onOn }: { onOn: () => void }) {
  const [off, setOff] = useState(false);
  const check = useCallback(() => {
    getSettings()
      .then((s) => setOff(!s.notice_patterns))
      .catch(() => setOff(false));
  }, []);
  useEffect(check, [check]);

  async function turnOn() {
    const settings = await getSettings();
    await updateSettings({ ...settings, notice_patterns: true });
    setOff(false);
    const added = await refreshSuggestions().catch(() => 0);
    notify({ type: "info", title: added ? t("لقيت {0} شي ممكن أعمله عنك", { 0: added }) : t("لسا ما لاحظت شي بيتكرر. رح أخبرك لما ألاحظ."), description: t("كله على جهازك، وبدون أي نموذج.") });
    onOn();
  }

  if (!off) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "var(--color-surface)" }}>
      <BulbIcon className="h-5 w-5 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
      <p className="min-w-48 flex-1 text-sm">{t("خلّي رفيق يلاحظ اللي بتكرره بإيدك ويقترح يعمله عنك. كله على جهازك، وبدون أي نموذج.")}</p>
      <Button variant="ghost" onClick={() => void turnOn()}>
        {t("شغّل الملاحظة")}
      </Button>
    </div>
  );
}
