/**
 * Dictation for the message box.
 *
 * The recording never leaves the machine except as one request to the speech provider of
 * an agent the user already set up; nothing is stored. Press once to start, again to stop
 * — the text lands in the box, where it can still be edited before sending.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { transcribe } from "../../lib/api";
import { MicIcon, SpinnerIcon } from "../../components/Icons";
import { t } from "../../i18n";

type State = "idle" | "recording" | "working";

export function MicButton({ disabled, onText }: { disabled: boolean; onText: (text: string) => void }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      // Leaving the page mid-recording must still release the microphone.
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        chunks.current = [];
        if (blob.size < 1200) {
          setState("idle"); // a tap, not a sentence
          return;
        }
        setState("working");
        try {
          const text = await transcribe(blob);
          if (text) onText(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setState("idle");
        }
      };
      recorder.current = mr;
      mr.start();
      setState("recording");
    } catch {
      setError(t("ما قدرت أفتح المايك — تأكد إنه مسموح للتطبيق."));
      setState("idle");
    }
  }

  function stop() {
    recorder.current?.stop();
    recorder.current = null;
  }

  return (
    <span className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => (state === "recording" ? stop() : state === "idle" ? void start() : undefined)}
        disabled={disabled || state === "working"}
        aria-label={state === "recording" ? t("خلّصت") : t("سجّل صوت")}
        title={state === "recording" ? t("اضغط لتوقف التسجيل") : t("احكي بدل ما تكتب")}
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        style={{ color: state === "recording" ? "var(--color-danger)" : "var(--color-ink-muted)" }}
      >
        {state === "working" ? <SpinnerIcon className="h-4 w-4" /> : <MicIcon className="h-4 w-4" />}
        {state === "recording" && (
          <motion.span
            className="absolute inset-0 rounded-lg"
            style={{ border: "1.5px solid var(--color-danger)" }}
            animate={{ opacity: [0.9, 0.25, 0.9] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
        )}
      </motion.button>
      <AnimatePresence>
        {error && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onAnimationComplete={() => setTimeout(() => setError(null), 4000)}
            className="absolute bottom-full start-0 mb-2 w-56 rounded-lg border px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              zIndex: "var(--z-index-dropdown)" as unknown as number,
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
