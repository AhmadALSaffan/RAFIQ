/** "Listen" on a reply: reads it out loud, and turns into "stop" while it does. */

import { useId } from "react";
import { speakReply, stopSpeaking, useSpeaking } from "../../lib/speech";
import { notify } from "../../lib/toast";
import { StopIcon, VolumeIcon } from "../../components/Icons";
import { t } from "../../i18n";

export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const id = useId();
  const speaking = useSpeaking() === id;
  return (
    <button
      onClick={() => {
        if (speaking) stopSpeaking();
        else speakReply(id, text).catch((e) => notify({ type: "error", title: e instanceof Error ? e.message : String(e) }));
      }}
      aria-label={speaking ? t("وقّف القراءة") : t("اسمع الرد")}
      title={speaking ? t("وقّف القراءة") : t("اسمع الرد")}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-opacity hover:bg-[var(--color-surface-2)] ${speaking ? "opacity-100" : (className ?? "")}`}
      style={{ color: speaking ? "var(--color-accent)" : "var(--color-ink-muted)" }}
    >
      {speaking ? <StopIcon className="h-3.5 w-3.5" /> : <VolumeIcon className="h-3.5 w-3.5" />}
      {speaking ? t("وقّف") : t("اسمع")}
    </button>
  );
}
