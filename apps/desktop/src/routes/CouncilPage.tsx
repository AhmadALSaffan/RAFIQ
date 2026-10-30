/**
 * The council: one hard question, two or three models. Each answers alone, each then critiques
 * the others under neutral names, and one of them writes the decision, with the disagreements
 * left in view. It ends as an ordinary chat that can be carried on.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { askCouncil, listModels, type CouncilEvent, type CouncilStage } from "../lib/api";
import type { LlmModel } from "../lib/types";
import { useCurrentWorkspaceId } from "../lib/workspace";
import { fieldDir, messageDir } from "../lib/bidi";
import { easeOutExpo } from "../lib/motion";
import { Markdown } from "../components/Markdown";
import { BrandMark } from "../components/BrandMark";
import { Button, EmptyState, ErrorText } from "../components/ui";
import { CouncilIcon } from "../components/Icons";
import { t } from "../i18n";

const PICKED = "rafiq-council-models";
const MAX_SEATS = 3;

type SeatState = { id: string; name: string; answer: string; critique: string; error?: string };

/** The two or three models used last time, or the first that work. */
export function firstSeats(models: Pick<LlmModel, "id">[], saved: string[]): string[] {
  const known = saved.filter((id) => models.some((m) => m.id === id)).slice(0, MAX_SEATS);
  return known.length >= 2 ? known : models.slice(0, MAX_SEATS).map((m) => m.id);
}

function savedSeats(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PICKED) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function CouncilPage() {
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceId();
  const [models, setModels] = useState<LlmModel[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [stage, setStage] = useState<CouncilStage | null>(null);
  const [seats, setSeats] = useState<SeatState[]>([]);
  const [verdict, setVerdict] = useState("");
  const [chairId, setChairId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    listModels()
      .then((list) => {
        const usable = list.filter((m) => m.verify_ok !== false);
        setModels(usable);
        setPicked(firstSeats(usable, savedSeats()));
      })
      .catch(() => setModels([]));
    return () => stop.current?.abort();
  }, []);

  const chairName = useMemo(() => seats.find((s) => s.id === chairId)?.name, [seats, chairId]);

  function toggle(id: string) {
    setPicked((now) => {
      const next = now.includes(id) ? now.filter((x) => x !== id) : now.length < MAX_SEATS ? [...now, id] : now;
      try {
        localStorage.setItem(PICKED, JSON.stringify(next));
      } catch {
        // a convenience only
      }
      return next;
    });
  }

  function onEvent(event: CouncilEvent) {
    if (event.type === "start") setSeats(event.seats.map((s) => ({ ...s, answer: "", critique: "" })));
    else if (event.type === "stage") setStage(event.stage);
    else if (event.type === "chair") {
      setChairId(event.seat);
      setVerdict("");
    } else if (event.type === "delta") {
      if (event.stage === "verdict") setVerdict((v) => v + event.text);
      else setSeats((all) => all.map((s) => (s.id === event.seat ? { ...s, [event.stage]: s[event.stage as "answer" | "critique"] + event.text } : s)));
    } else if (event.type === "error") {
      setSeats((all) => all.map((s) => (s.id === event.seat ? { ...s, error: event.message } : s)));
    } else if (event.type === "failed") setError(t("ولا نموذج قدر يجاوب — شوف الخطأ تحت كل واحد."));
    else if (event.type === "done") setChatId(event.chat_id);
  }

  async function ask() {
    const text = question.trim();
    if (!text || picked.length < 2 || running) return;
    const controller = new AbortController();
    stop.current = controller;
    setAsked(text);
    setQuestion("");
    setSeats([]);
    setVerdict("");
    setChatId(null);
    setChairId(null);
    setError(null);
    setStage(null);
    setRunning(true);
    try {
      await askCouncil(text, picked, workspaceId, onEvent, controller.signal);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setStage(null);
    }
  }

  const muted = { color: "var(--color-ink-muted)" };
  const STAGES: [CouncilStage, string][] = [
    ["answer", t("كل واحد بيجاوب لحاله")],
    ["critique", t("بينتقدوا بعض")],
    ["verdict", t("القرار")],
  ];

  if (models && models.length < 2) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16">
        <EmptyState
          title={t("المجلس بده نموذجين على الأقل")}
          text={t("ضيف نموذج تاني من صفحة النماذج، ويفضل من شركة مختلفة: الاختلاف هو الفايدة.")}
          action={<Button onClick={() => navigate("/models")}>{t("افتح النماذج")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 lg:px-8">
      <header className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--color-surface)", color: "var(--color-accent)" }}>
          <CouncilIcon className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold">{t("مجلس النماذج")}</h1>
          <p className="mt-1 text-sm" style={muted}>
            {t("سؤال صعب؟ كل نموذج بيجاوب لحاله، بينتقدوا بعض بدون ما يعرفوا مين كتب شو، وبيطلع قرار واحد مع نقاط الخلاف.")}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("اختار النماذج")}>
          {(models ?? []).map((m) => {
            const on = picked.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                aria-pressed={on}
                disabled={running || (!on && picked.length >= MAX_SEATS)}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
                style={{ borderColor: on ? "var(--color-accent)" : "var(--color-border)", background: on ? "color-mix(in oklch, var(--color-accent) 14%, transparent)" : "transparent" }}
              >
                <BrandMark provider={m.provider} className="h-3.5 w-3.5" />
                {m.name}
              </button>
            );
          })}
          <span className="text-xs" style={muted}>
            {t("اختار 2 أو 3")}
          </span>
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask();
            }
          }}
          rows={2}
          dir={fieldDir(question)}
          placeholder={t("مثلاً: أبني التطبيق بـ React Native ولا Flutter؟")}
          aria-label={t("سؤالك للمجلس")}
          className="input resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs" style={muted}>
            {t("كل نموذج بيتحسب عليه، فالسؤال الواحد بيكلّف أكتر من محادثة عادية.")}
          </p>
          {running ? (
            <Button variant="ghost" onClick={() => stop.current?.abort()}>
              {t("وقّف")}
            </Button>
          ) : (
            <Button variant="accent" onClick={() => void ask()} disabled={!question.trim() || picked.length < 2}>
              {t("اسأل المجلس")}
            </Button>
          )}
        </div>
      </div>

      <ErrorText message={error} />

      {asked && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: easeOutExpo }} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base font-semibold" dir={messageDir(asked)}>
              {asked}
            </p>
            {running && (
              <ol className="flex items-center gap-2 text-xs" aria-label={t("مراحل المجلس")}>
                {STAGES.map(([id, label]) => (
                  <li key={id} className="rounded-full px-2.5 py-1" style={stage === id ? { background: "var(--color-accent)", color: "var(--color-accent-ink)" } : { background: "var(--color-surface)", ...muted }}>
                    {label}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <AnimatePresence>
            {verdict && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: easeOutExpo }}
                className="rounded-2xl border-2 p-5"
                style={{ borderColor: "var(--color-accent)", background: "var(--color-surface)" }}
              >
                <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--color-accent)" }}>
                  {chairName ? t("القرار · كتبه {0}", { 0: chairName }) : t("القرار")}
                </h2>
                <div dir={messageDir(verdict)}>
                  <Markdown text={verdict} />
                </div>
                {chatId && (
                  <div className="mt-3">
                    <Button onClick={() => navigate(`/chat/${chatId}`)}>{t("كمّل بمحادثة")}</Button>
                  </div>
                )}
              </motion.section>
            )}
          </AnimatePresence>

          <div className={`grid grid-cols-1 gap-3 ${seats.length > 2 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
            {seats.map((seat) => (
              <article key={seat.id} className="flex min-w-0 flex-col gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
                <h3 className="text-sm font-bold">{seat.name}</h3>
                {seat.error && (
                  <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
                    {seat.error}
                  </p>
                )}
                <div className="text-sm" dir={messageDir(seat.answer)}>
                  {seat.answer ? (
                    <Markdown text={seat.answer} />
                  ) : (
                    !seat.error && (
                      <motion.span style={muted} animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                        {t("عم يفكّر…")}
                      </motion.span>
                    )
                  )}
                </div>
                {seat.critique && (
                  <div className="border-t pt-3 text-sm" style={{ borderColor: "var(--color-border)" }} dir={messageDir(seat.critique)}>
                    <p className="mb-1 text-xs font-semibold" style={muted}>
                      {t("نقده للباقي")}
                    </p>
                    <Markdown text={seat.critique} />
                  </div>
                )}
              </article>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
