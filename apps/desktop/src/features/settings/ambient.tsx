/** Settings → General: the morning radio and pattern noticing. */

import { useState } from "react";
import type { AppSettings } from "../../lib/types";
import { makeRadioEpisode, refreshSuggestions } from "../../lib/api";
import { Card, Hint, Section, ToggleRow } from "./controls";
import { Button } from "../../components/ui";
import { fieldDir } from "../../lib/bidi";
import { radioError } from "../ambient/RadioCard";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

export function AmbientSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const radio = settings.radio_enabled ?? false;
  const [making, setMaking] = useState(false);
  const [madeNote, setMadeNote] = useState<string | null>(null);
  const [topics, setTopics] = useState(settings.radio_topics ?? "");

  async function makeNow() {
    setMaking(true);
    setMadeNote(null);
    try {
      const episode = await makeRadioEpisode();
      setMadeNote(episode.error ? radioError(episode.error) : t("حلقة اليوم جاهزة على الصفحة الرئيسية."));
    } catch (e) {
      setMadeNote(e instanceof Error ? e.message : String(e));
    } finally {
      setMaking(false);
    }
  }

  return (
    <Section title={t("رفيق بيبادر")}>
      <ToggleRow
        label={t("راديو الصبح")}
        hint={t("كل صبح حلقة صوتية قصيرة عن يومك: شو خلص، شو عندك اليوم، الملفات اللي تغيّرت، وأخبار مجالك. بيكتبها النموذج المساعد، وبتنقرأ بالصوت اللي اخترته فوق.")}
        checked={radio}
        onChange={(on) => persist({ ...settings, radio_enabled: on })}
      />
      {radio && (
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {t("الساعة")}
              <input type="time" value={settings.radio_time ?? "08:00"} onChange={(e) => persist({ ...settings, radio_time: e.target.value })} className="input w-32" dir="ltr" />
            </label>
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
              {t("مواضيع الأخبار (اختياري)")}
              <input
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                onBlur={() => persist({ ...settings, radio_topics: topics.trim() || null })}
                maxLength={200}
                className="input"
                dir={fieldDir(topics)}
                placeholder={t("مثلاً: الذكاء الاصطناعي، التجارة الإلكترونية")}
              />
            </label>
            <Button variant="ghost" onClick={() => void makeNow()} disabled={making}>
              {making ? t("عم يكتب الحلقة…") : t("جرّبها هلأ")}
            </Button>
          </div>
          <Hint>{t("الأخبار بدها خدمة بحث من إعدادات الويب. كتابة الحلقة بتكلّف طلب واحد للنموذج كل يوم، والصوت بينحسب بس لما تسمعها.")}</Hint>
          {madeNote && (
            <p className="mt-2 text-xs" role="status">
              {madeNote}
            </p>
          )}
        </Card>
      )}
      <ToggleRow
        label={t("خلّي رفيق يلاحظ اللي بتكرره")}
        hint={t("إذا طلبت نفس الشي كل أسبوع، أو نقلت نفس نوع الملفات لنفس المجلد، بيقترح يعمله عنك. كله عدّ على جهازك: ما في أي نموذج، وما بيطلع شي، وما بيعمل شي من غير موافقتك.")}
        checked={settings.notice_patterns ?? false}
        onChange={(on) => {
          persist({ ...settings, notice_patterns: on });
          if (on) window.setTimeout(() => void refreshSuggestions().catch(() => 0), 600);
        }}
      />
    </Section>
  );
}
