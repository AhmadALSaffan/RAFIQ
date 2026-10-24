/**
 * A ChatGPT plan's usage, as a small ring beside the model: the figure OpenAI reports in its
 * responses when it does, full and red when the limit was reached. A click opens what Rafiq
 * knows — the windows, its own requests and tokens, when the limit was hit — and the plan's
 * own usage page, the one place with the whole picture.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { getPlanUsage, type PlanUsage } from "../../lib/api";
import { openExternal } from "../../lib/links";
import { easeOutExpo } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { Button } from "../../components/ui";
import { XIcon } from "../../components/Icons";
import { t } from "../../i18n";

const USAGE_PAGE = "https://chatgpt.com/settings/usage";

function inWords(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return t("{0} دقيقة", { 0: Math.max(1, m) });
  const h = Math.round(m / 60);
  if (h < 48) return t("{0} ساعة", { 0: h });
  return t("{0} يوم", { 0: Math.round(h / 24) });
}

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

function Ring({ value, limited, size = 18 }: { value: number | null; limited: boolean; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const shown = limited ? 1 : (value ?? 0) / 100;
  const color = limited ? "var(--color-danger)" : shown >= 0.8 ? "var(--color-pending)" : "var(--color-accent)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={2.5} />
      {value === null && !limited ? (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-muted)" strokeWidth={2.5} strokeDasharray="2 3" opacity={0.6} />
      ) : (
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0.02, shown))) }}
          transition={{ duration: 0.6, ease: easeOutExpo }}
        />
      )}
    </svg>
  );
}

export function PlanUsageRing({ accountId, refreshKey }: { accountId: string; refreshKey?: unknown }) {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void getPlanUsage(accountId)
        .then((u) => alive && setUsage(u))
        .catch(() => alive && setUsage(null));
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [accountId, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (!usage) return null;
  const percent = usage.used_percent;
  const label = usage.limited
    ? t("وصلت لحد الاستخدام")
    : percent !== null
      ? t("استخدام خطة ChatGPT: {0}%", { 0: Math.round(percent) })
      : t("استخدام خطة ChatGPT");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-1.5 rounded-full px-2 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: usage.limited ? "var(--color-danger)" : "var(--color-ink-muted)" }}
        aria-label={label}
        title={label}
      >
        <Ring value={percent} limited={usage.limited} />
        {(percent !== null || usage.limited) && <span className="num">{usage.limited ? "100%" : `${Math.round(percent!)}%`}</span>}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[60] grid place-items-center p-6"
              style={{ background: "color-mix(in oklch, var(--color-bg) 70%, transparent)", backdropFilter: "blur(6px)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label={t("استخدام خطة ChatGPT")}
            >
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: easeOutExpo }}
                className="w-full max-w-md overflow-hidden rounded-3xl p-6 shadow-2xl"
                style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-extrabold">{t("استخدام خطة ChatGPT")}</h2>
                    <p className="mt-1 text-sm" style={{ color: "var(--color-ink-muted)" }}>
                      {t("اللي بيعرفه رفيق عن استخدامه لخطتك.")}
                    </p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label={t("إغلاق")} className="rounded-full p-2 transition-colors hover:bg-[var(--color-surface-2)]">
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 flex items-center gap-4">
                  <Ring value={percent} limited={usage.limited} size={72} />
                  <div>
                    <p className="num text-[32px] font-extrabold leading-none">{usage.limited ? "100%" : percent !== null ? `${Math.round(percent)}%` : "—"}</p>
                    <p className="mt-1 text-sm" style={{ color: usage.limited ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
                      {usage.limited
                        ? t("وصلت لحد الاستخدام (لخطتك أو للحد اللي حاطّه لرفيق).")
                        : percent !== null
                          ? t("من الاستخدام المسموح، حسب آخر رد من OpenAI.")
                          : t("OpenAI ما بعتت نسبة الاستخدام مع ردودها — النسبة الكاملة بصفحة الاستخدام.")}
                    </p>
                  </div>
                </div>

                {usage.windows.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-1.5 text-sm">
                    {usage.windows.map((w) => (
                      <li key={w.name} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: "var(--color-surface-2)" }}>
                        <span>
                          {w.window_minutes ? t("كل {0}", { 0: inWords(w.window_minutes * 60) }) : w.name}
                          {w.resets_in_seconds !== null && (
                            <span style={{ color: "var(--color-ink-muted)" }}> · {t("بيتجدد بعد {0}", { 0: inWords(w.resets_in_seconds) })}</span>
                          )}
                        </span>
                        <span className="num font-semibold">{Math.round(w.used_percent)}%</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    { label: t("اليوم"), value: usage.today },
                    { label: t("آخر 7 أيام"), value: usage.week },
                  ].map((x) => (
                    <div key={x.label} className="rounded-2xl p-3" style={{ background: "var(--color-surface-2)" }}>
                      <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        {x.label}
                      </p>
                      <p className="num mt-1 text-lg font-bold">{t("{0} طلب", { 0: x.value.requests })}</p>
                      <p className="num text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        {t("{0} توكن", { 0: tokens(x.value.tokens) })}
                      </p>
                    </div>
                  ))}
                </div>

                {usage.limit_at && (
                  <p className="mt-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    {t("آخر مرة وصلت للحد: {0}", { 0: timeAgo(new Date(usage.limit_at * 1000).toISOString()) })}
                  </p>
                )}

                <div className="mt-5 flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    {t("إغلاق")}
                  </Button>
                  <Button variant="primary" onClick={() => void openExternal(USAGE_PAGE)}>
                    {t("افتح صفحة الاستخدام")}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
