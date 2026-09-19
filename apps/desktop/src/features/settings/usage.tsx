/**
 * What the models cost, the limits that stop them, and the report to send when something
 * goes wrong.
 *
 * Prices come from the provider's own token rates, so a model with no published price
 * shows its tokens and no dollars — never a made-up number.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { getDiagnostics, getUsage } from "../../lib/api";
import { easeOutExpo, listContainer, listItem } from "../../lib/motion";
import type { AppSettings, UsageSummary } from "../../lib/types";
import { Button } from "../../components/ui";
import { DownloadIcon, RefreshIcon } from "../../components/Icons";
import { saveTextFile } from "../../components/ChatCommands";
import { Card, Hint, Section, ToggleRow } from "./controls";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

function money(value: number): string {
  if (!value) return "$0";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

/** A number the user types in dollars; empty or 0 means no limit. */
function BudgetField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  useEffect(() => setDraft(value ? String(value) : ""), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <span style={{ color: "var(--color-ink-muted)" }}>$</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={() => {
            const next = Number(draft) || 0;
            if (next !== value) onCommit(next);
          }}
          inputMode="decimal"
          placeholder={t("بلا حد")}
          className="input w-28 py-1.5 text-sm tabular-nums"
          dir="ltr"
        />
      </div>
    </label>
  );
}

export function UsageSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getUsage(30)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  useEffect(load, [load]);

  async function exportReport() {
    setBusy(true);
    try {
      const report = await getDiagnostics();
      const name = `rafiq-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      const path = await saveTextFile(name, JSON.stringify(report, null, 2), "json");
      setSaved(path);
    } catch {
      setSaved(null);
    } finally {
      setBusy(false);
    }
  }

  const peak = Math.max(1, ...(summary?.by_day ?? []).map((d) => d.cost_usd));

  return (
    <Section
      title={t("الاستهلاك")}
      action={
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={load}>
          <RefreshIcon className="h-3.5 w-3.5" />
          {t("حدّث")}
        </Button>
      }
    >
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex gap-6">
            <div>
              <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("اليوم")}
              </p>
              <p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--color-accent)" }}>
                {money(summary?.today_usd ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("هالشهر")}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{money(summary?.month_usd ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("توكنات (٣٠ يوم)")}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{tokens(summary?.total_tokens ?? 0)}</p>
            </div>
          </div>
          <div className="flex gap-4">
            <BudgetField
              label={t("حد يومي")}
              value={settings.daily_budget_usd ?? 0}
              onCommit={(daily_budget_usd) => persist({ ...settings, daily_budget_usd })}
            />
            <BudgetField
              label={t("حد شهري")}
              value={settings.monthly_budget_usd ?? 0}
              onCommit={(monthly_budget_usd) => persist({ ...settings, monthly_budget_usd })}
            />
          </div>
        </div>
        <Hint>{t("لما توصل الحد، رفيق بيوقف يبعت للمزوّد لحد ما يبلش يوم (أو شهر) جديد أو تغيّر الرقم. صفر = بلا حد.")}</Hint>

        {summary && summary.by_day.length > 1 && (
          <div className="mt-4 flex h-16 items-end gap-1" dir="ltr" aria-hidden>
            {summary.by_day.map((day) => (
              <motion.span
                key={day.date}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(4, (day.cost_usd / peak) * 100)}%` }}
                transition={{ duration: 0.4, ease: easeOutExpo }}
                title={`${day.date} · ${money(day.cost_usd)}`}
                className="flex-1 rounded-sm"
                style={{ background: "color-mix(in oklch, var(--color-accent) 45%, transparent)" }}
              />
            ))}
          </div>
        )}
      </Card>

      <ToggleRow
        label={t("توفير التوكنز")}
        hint={t("بيبعت أسماء المهارات بس بدل وصف كل وحدة — بيوفّر آلاف الأحرف بكل رسالة. هاد الافتراضي للمحادثات الجديدة، وكل محادثة بتقدر تغيّره من /إعدادات.")}
        checked={settings.token_saver}
        onChange={(token_saver) => persist({ ...settings, token_saver })}
      />

      {summary && summary.by_model.length > 0 && (
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
          {summary.by_model.map((m) => (
            <motion.li key={`${m.model_ref ?? ""}${m.name}`} variants={listItem}>
              <Card>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <Hint>
                      {t("{0} طلب · {1} توكن", { 0: String(m.calls), 1: tokens(m.prompt_tokens + m.completion_tokens) })}
                      {m.cached_tokens > 0 && ` · ${t("{0} من الكاش", { 0: tokens(m.cached_tokens) })}`}
                    </Hint>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(m.cost_usd)}</span>
                </div>
              </Card>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("تقرير للمشاكل")}</p>
            <Hint>
              {saved
                ? t("انحفظ: {0}", { 0: saved })
                : t("ملف فيه نسخة التطبيق وإعداداتك وأسماء النماذج — بلا مفاتيح ولا محتوى محادثاتك.")}
            </Hint>
          </div>
          <Button variant="ghost" onClick={exportReport} disabled={busy}>
            <DownloadIcon className="h-4 w-4" />
            {t("احفظ التقرير")}
          </Button>
        </div>
      </Card>
    </Section>
  );
}
