/**
 * Home: today's morning radio. Play reads the show out loud; "ask about it" opens the episode
 * as a chat with the voice conversation already listening.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { getRadioToday, makeRadioEpisode, markRadioHeard, radioChat, type RadioEpisode } from "../../lib/api";
import { speakReply, stopSpeaking, useSpeaking } from "../../lib/speech";
import { notify } from "../../lib/toast";
import { messageDir } from "../../lib/bidi";
import { HeadphonesIcon, PlayIcon, RadioIcon, SpinnerIcon, StopIcon } from "../../components/Icons";
import { Button } from "../../components/ui";
import { t } from "../../i18n";

/** What went wrong, in words: the two the agent names, or its own message. */
export function radioError(error: string): string {
  if (error === "no_model") return t("ضيف نموذج أول، عشان رفيق يكتب الحلقة.");
  if (error === "empty") return t("النموذج رجّع نص فاضي — جرّب كمان مرة.");
  return error;
}

export function RadioCard() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);
  const [episode, setEpisode] = useState<RadioEpisode | null>(null);
  const [making, setMaking] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const speaking = useSpeaking();
  const voiceId = episode ? `radio-${episode.id}` : "";
  const playing = Boolean(episode) && speaking === voiceId;

  useEffect(() => {
    getRadioToday()
      .then((today) => {
        setEnabled(today.enabled);
        setEpisode(today.episode);
      })
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => () => {
    if (speakingIsRadio()) stopSpeaking();
  }, []);

  if (!enabled) return null;

  async function make() {
    setMaking(true);
    try {
      setEpisode(await makeRadioEpisode());
    } catch (e) {
      notify({ type: "error", title: e instanceof Error ? e.message : String(e) });
    } finally {
      setMaking(false);
    }
  }

  function play() {
    if (!episode) return;
    if (playing) {
      stopSpeaking();
      return;
    }
    radioPlaying = true;
    speakReply(voiceId, episode.script)
      .catch((e) => notify({ type: "error", title: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        radioPlaying = false;
      });
    if (!episode.heard_at) {
      void markRadioHeard(episode.id).catch(() => undefined);
      setEpisode({ ...episode, heard_at: new Date().toISOString() });
    }
  }

  async function ask() {
    if (!episode) return;
    stopSpeaking();
    try {
      navigate(`/chat/${await radioChat(episode.id)}?voice=1`);
    } catch (e) {
      notify({ type: "error", title: e instanceof Error ? e.message : String(e) });
    }
  }

  const muted = { color: "var(--color-ink-muted)" };
  const ready = Boolean(episode?.script);

  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: "var(--color-surface)" }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "color-mix(in oklch, var(--color-accent) 16%, transparent)", color: "var(--color-accent)" }}>
          <RadioIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("راديو الصبح")}</p>
          <p className="truncate text-xs" style={episode?.error ? { color: "var(--color-danger)" } : muted} role={episode?.error ? "alert" : undefined}>
            {episode?.error ? radioError(episode.error) : ready ? t("حلقة اليوم جاهزة") : t("الحلقة بتطلع بوقتها، أو اعملها هلأ")}
          </p>
        </div>
        {playing && (
          <span className="flex h-6 items-center gap-0.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.i key={i} className="block w-1 rounded-full" style={{ background: "var(--color-accent)", height: 22 }} animate={{ scaleY: [0.3, 1, 0.45, 0.8, 0.3] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.12 }} />
            ))}
          </span>
        )}
        {ready ? (
          <>
            <Button variant="accent" onClick={play}>
              <span className="flex items-center gap-1.5">
                {playing ? <StopIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                {playing ? t("وقّف") : t("اسمع")}
              </span>
            </Button>
            <Button variant="ghost" onClick={() => void ask()}>
              <span className="flex items-center gap-1.5">
                <HeadphonesIcon className="h-4 w-4" />
                {t("اسأله عنها")}
              </span>
            </Button>
            <Button variant="ghost" onClick={() => setShowScript((v) => !v)}>
              {showScript ? t("خبّي النص") : t("النص")}
            </Button>
          </>
        ) : (
          <Button onClick={() => void make()} disabled={making}>
            <span className="flex items-center gap-1.5">
              {making && <SpinnerIcon className="h-4 w-4" />}
              {making ? t("عم يكتب الحلقة…") : t("اعمل حلقة اليوم")}
            </span>
          </Button>
        )}
      </div>
      {showScript && ready && (
        <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm leading-relaxed" style={{ borderColor: "var(--color-border)" }} dir={messageDir(episode?.script ?? "")}>
          {episode?.script}
        </p>
      )}
    </div>
  );
}

/** Leaving the page ends the show (a voice nobody can stop would be strange). */
let radioPlaying = false;
function speakingIsRadio() {
  return radioPlaying;
}
