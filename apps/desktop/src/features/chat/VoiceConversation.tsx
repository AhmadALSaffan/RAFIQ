/**
 * The voice conversation: talk, Rafiq answers out loud, and it listens again — no typing,
 * no buttons in between. It listens until the user stops talking, sends what they said as
 * an ordinary message, reads the reply when it's done, and goes back to listening. The
 * whole conversation stays in the chat as text.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { transcribe } from "../../lib/api";
import { listenOnce } from "../../lib/voiceInput";
import { speakReply, stopSpeaking } from "../../lib/speech";
import { HeadphonesIcon, XIcon } from "../../components/Icons";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";

type Phase = "listening" | "understanding" | "thinking" | "speaking";

export function VoiceConversation({
  streaming,
  lastReply,
  onSend,
  onClose,
}: {
  streaming: boolean;
  /** The newest reply in the chat (its id and text), to read once it's finished. */
  lastReply: { id: string; text: string } | null;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  // The reply that was newest when the message went out: the answer is the next one.
  const before = useRef<string | null>(lastReply?.id ?? null);
  const listening = useRef<AbortController | null>(null);
  const alive = useRef(true);

  async function listen() {
    setPhase("listening");
    const controller = new AbortController();
    listening.current = controller;
    try {
      const recording = await listenOnce(controller.signal, setLevel);
      if (!alive.current || controller.signal.aborted) return;
      if (!recording) return void listen();
      setPhase("understanding");
      const text = (await transcribe(recording)).trim();
      if (!alive.current) return;
      if (!text) return void listen();
      setError(null);
      before.current = lastReplyRef.current?.id ?? null;
      setPhase("thinking");
      onSend(text);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? t("ما قدرت أفتح المايك — تأكد إنه مسموح للتطبيق.") : e instanceof Error ? e.message : String(e));
    }
  }

  const lastReplyRef = useRef(lastReply);
  lastReplyRef.current = lastReply;

  useEffect(() => {
    alive.current = true;
    void listen();
    return () => {
      alive.current = false;
      listening.current?.abort();
      stopSpeaking();
    };
    // Starts once, when the conversation opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The answer has finished arriving: read it, then listen again.
  useEffect(() => {
    if (phase !== "thinking" || streaming || !lastReply || lastReply.id === before.current) return;
    setPhase("speaking");
    speakReply(`voice-${lastReply.id}`, lastReply.text)
      .catch((e) => alive.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive.current && void listen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, streaming, lastReply]);

  const label = {
    listening: t("عم بسمعك… احكي"),
    understanding: t("عم بفهم شو قلت…"),
    thinking: t("عم يفكّر…"),
    speaking: t("عم يحكي…"),
  }[phase];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.22, ease: easeOutExpo }}
      className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-3 rounded-2xl border px-4 py-2.5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--color-surface-2)", color: "var(--color-accent)" }}>
        <HeadphonesIcon className="h-4 w-4" />
        {phase === "listening" && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ border: "2px solid var(--color-accent)" }}
            animate={{ scale: 1 + Math.min(level * 12, 0.5), opacity: 0.35 + Math.min(level * 10, 0.6) }}
            transition={{ duration: 0.08 }}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {label}
        </p>
        {error && (
          <p className="truncate text-xs" style={{ color: "var(--color-danger)" }} role="alert" title={error}>
            {error}
          </p>
        )}
      </div>
      {phase === "speaking" && (
        <button
          onClick={() => stopSpeaking()}
          className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("قاطعه")}
        </button>
      )}
      {error && phase === "listening" && (
        <button
          onClick={() => void listen()}
          className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
          style={{ color: "var(--color-ink-muted)" }}
        >
          {t("جرّب كمان مرة")}
        </button>
      )}
      <button
        onClick={onClose}
        aria-label={t("خلّص المحادثة الصوتية")}
        title={t("خلّص المحادثة الصوتية")}
        className="rounded-md p-1.5 transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: "var(--color-ink-muted)" }}
      >
        <XIcon className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
