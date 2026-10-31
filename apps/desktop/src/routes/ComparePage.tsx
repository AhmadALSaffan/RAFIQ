/**
 * Compare two models: the same question to both, side by side, with the answer, the price and
 * the speed. For choosing a model; nothing here is saved.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { compareModels, listModels, type CompareEvent, type CompareResult } from "../lib/api";
import type { LlmModel } from "../lib/types";
import { fieldDir, messageDir } from "../lib/bidi";
import { easeOutExpo } from "../lib/motion";
import { Markdown } from "../components/Markdown";
import { PageHeader } from "../components/Page";
import { Button, ErrorText } from "../components/ui";
import { intlLocale, t } from "../i18n";

type Side = { id: string; name: string; text: string; error?: string; result?: CompareResult };

/** The cheapest and the quickest of what finished, to mark them. A tie, or an unknown price
 * on either side, marks nothing: there's no winner to name. */
export function winners(sides: Pick<Side, "id" | "result">[]): { cheapest?: string; fastest?: string } {
  const done = sides.filter((s) => s.result);
  if (done.length < 2) return {};
  const [a, b] = done as { id: string; result: CompareResult }[];
  const out: { cheapest?: string; fastest?: string } = {};
  if (a.result.cost_usd > 0 && b.result.cost_usd > 0 && a.result.cost_usd !== b.result.cost_usd) {
    out.cheapest = a.result.cost_usd < b.result.cost_usd ? a.id : b.id;
  }
  if (a.result.total_ms !== b.result.total_ms) out.fastest = a.result.total_ms < b.result.total_ms ? a.id : b.id;
  return out;
}

function seconds(ms: number | null): string {
  return ms === null ? "–" : t("{0} ث", { 0: (ms / 1000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) });
}

function price(cost: number): string {
  return cost > 0 ? `$${cost < 0.01 ? cost.toFixed(5) : cost.toFixed(3)}` : t("غير معروف");
}

export function ComparePage() {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [sides, setSides] = useState<Side[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    listModels()
      .then((list) => {
        const usable = list.filter((m) => m.verify_ok !== false);
        setModels(usable);
        setLeft(usable[0]?.id ?? "");
        setRight(usable[1]?.id ?? "");
      })
      .catch(() => setModels([]));
    return () => stop.current?.abort();
  }, []);

  function onEvent(event: CompareEvent) {
    if (event.type === "start") setSides(event.seats.map((s) => ({ ...s, text: "" })));
    else if (event.type === "delta") setSides((all) => all.map((s) => (s.id === event.seat ? { ...s, text: s.text + event.text } : s)));
    else if (event.type === "error") setSides((all) => all.map((s) => (s.id === event.seat ? { ...s, error: event.message } : s)));
    else if (event.type === "finished") setSides((all) => all.map((s) => (s.id === event.seat ? { ...s, result: event } : s)));
  }

  async function ask() {
    const text = question.trim();
    if (!text || !left || !right || left === right || running) return;
    const controller = new AbortController();
    stop.current = controller;
    setAsked(text);
    setSides([]);
    setError(null);
    setRunning(true);
    try {
      await compareModels(text, [left, right], onEvent, controller.signal);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const muted = { color: "var(--color-ink-muted)" };
  const marks = winners(sides);
  const picker = (value: string, set: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="input min-w-48 flex-1 py-1.5 text-sm" disabled={running}>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 lg:px-8">
      <PageHeader title={t("قارن نموذجين")} description={t("نفس السؤال لنموذجين جنب بعض: الجواب والسعر والسرعة. بتختار على شغلك إنت، مش على جدول أرقام.")} />

      <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
        <div className="flex flex-wrap items-center gap-2">
          {picker(left, setLeft, t("النموذج الأول"))}
          <span className="text-xs" style={muted}>
            {t("مقابل")}
          </span>
          {picker(right, setRight, t("النموذج التاني"))}
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
          placeholder={t("اكتب سؤال من شغلك…")}
          aria-label={t("السؤال")}
          className="input resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs" style={left === right && models.length ? { color: "var(--color-danger)" } : muted}>
            {left === right && models.length ? t("اختار نموذجين مختلفين.") : t("كل نموذج بيتحسب عليه. ما بينحفظ شي من هون.")}
          </p>
          {running ? (
            <Button variant="ghost" onClick={() => stop.current?.abort()}>
              {t("وقّف")}
            </Button>
          ) : (
            <Button variant="accent" onClick={() => void ask()} disabled={!question.trim() || !left || left === right}>
              {t("قارن")}
            </Button>
          )}
        </div>
      </div>

      <ErrorText message={error} />

      {asked && (
        <p className="text-base font-semibold" dir={messageDir(asked)}>
          {asked}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sides.map((side) => (
          <motion.article key={side.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: easeOutExpo }} className="flex min-w-0 flex-col gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
            <h2 className="text-sm font-bold">{side.name}</h2>
            {side.error && (
              <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
                {side.error}
              </p>
            )}
            <div className="flex-1 text-sm" dir={messageDir(side.text)}>
              {side.text ? (
                <Markdown text={side.text} />
              ) : (
                !side.error && (
                  <motion.span style={muted} animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                    {t("عم يفكّر…")}
                  </motion.span>
                )
              )}
            </div>
            {side.result && (
              <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs" style={{ borderColor: "var(--color-border)" }}>
                <div>
                  <dt style={muted}>{t("السعر")}</dt>
                  <dd className="num font-semibold" style={marks.cheapest === side.id ? { color: "var(--color-accent)" } : undefined}>
                    {price(side.result.cost_usd)}
                    {marks.cheapest === side.id && ` · ${t("الأرخص")}`}
                  </dd>
                </div>
                <div>
                  <dt style={muted}>{t("الوقت الكلي")}</dt>
                  <dd className="num font-semibold" style={marks.fastest === side.id ? { color: "var(--color-accent)" } : undefined}>
                    {seconds(side.result.total_ms)}
                    {marks.fastest === side.id && ` · ${t("الأسرع")}`}
                  </dd>
                </div>
                <div>
                  <dt style={muted}>{t("أول كلمة")}</dt>
                  <dd className="num font-semibold">{seconds(side.result.first_ms)}</dd>
                </div>
              </dl>
            )}
          </motion.article>
        ))}
      </div>
    </div>
  );
}
