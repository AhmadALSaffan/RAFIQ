/** Settings → General: who reads replies out loud, and with which voice. */

import { useEffect, useState } from "react";
import type { AppSettings } from "../../lib/types";
import { speak, stopSpeaking, windowsVoices, type SpeakProvider } from "../../lib/speech";
import { Card, Hint, Section, SelectRow } from "./controls";
import { Button } from "../../components/ui";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;


export function VoiceSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const provider = settings.speak_provider ?? "system";
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    if (provider === "system") void windowsVoices().then(setVoices);
  }, [provider]);

  const arabic = voices.filter((v) => v.lang.toLowerCase().startsWith("ar"));

  async function tryIt() {
    setError(null);
    if (trying) {
      stopSpeaking();
      return;
    }
    setTrying(true);
    try {
      await speak("settings-sample", t("أهلا، أنا رفيق. هيك بيطلع صوتي لما إقرالك الردود."), provider, settings.speak_voice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrying(false);
    }
  }

  return (
    <Section title={t("الصوت")}>
      <SelectRow
        label={t("مين بيقرأ الردود")}
        hint={t("زر «اسمع» تحت كل رد، والمحادثة الصوتية (زر السماعات جنب المايك). أصوات ويندوز مجانية وما بيطلع شي من جهازك.")}
        value={provider}
        options={[
          { value: "system", label: t("أصوات ويندوز") },
          { value: "openai", label: "OpenAI" },
          { value: "elevenlabs", label: "ElevenLabs" },
          { value: "azure", label: "Azure Speech" },
          { value: "local", label: t("الصوت المحلي (من إعدادات الفيديو)") },
        ]}
        onChange={(v) => persist({ ...settings, speak_provider: v as SpeakProvider, speak_voice: null })}
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("الصوت العربي")}</p>
            <Hint>
              {provider === "system"
                ? arabic.length
                  ? t("الردود الإنجليزية والروسية بتنقرأ بصوت ويندوز اللي بلغتها.")
                  : t("ما في صوت عربي على ويندوز، فالعربي بينقرأ بالصوت المحلي (إعدادات الفيديو) أو بصوت OpenAI إذا عندك نموذج منه. أو نزّل صوت من إعدادات ويندوز ← الوقت واللغة ← الكلام.")
                : t("اسم الصوت عند المزوّد (فاضي = الافتراضي).")}
            </Hint>
          </div>
          <div className="flex items-center gap-2">
            {provider === "system" ? (
              <select
                value={settings.speak_voice ?? ""}
                onChange={(e) => persist({ ...settings, speak_voice: e.currentTarget.value || null })}
                aria-label={t("الصوت العربي")}
                className="input max-w-56 py-1.5 text-sm"
                disabled={!arabic.length}
              >
                <option value="">{t("تلقائي")}</option>
                {arabic.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                defaultValue={settings.speak_voice ?? ""}
                onBlur={(e) => persist({ ...settings, speak_voice: e.currentTarget.value.trim() || null })}
                aria-label={t("الصوت العربي")}
                placeholder={provider === "openai" ? "alloy" : provider === "azure" ? "ar-SA-HamedNeural" : ""}
                className="input max-w-56 py-1.5 text-sm"
                dir="ltr"
              />
            )}
            <Button variant="ghost" onClick={() => void tryIt()}>
              {trying ? t("وقّف") : t("جرّب الصوت")}
            </Button>
          </div>
        </div>
        {error && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }} role="alert">
            {error}
          </p>
        )}
      </Card>
    </Section>
  );
}
