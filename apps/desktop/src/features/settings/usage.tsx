/**
 * What the models cost, the limits that stop them, and the report to send when something
 * goes wrong.
 *
 * Prices come from the provider's own token rates, so a model with no published price
 * shows its tokens and no dollars — never a made-up number.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { exportUsage, getDiagnostics, getUsage, getUsageSources, saveWorkspace } from "../../lib/api";
import { refreshWorkspaces, useWorkspaces } from "../../lib/workspace";
import { BudgetMeter, money } from "../../components/BudgetMeter";
import { easeOutExpo, listContainer, listItem } from "../../lib/motion";
import type { AppSettings, UsageByModel, UsageSource, UsageSummary } from "../../lib/types";
import { Button } from "../../components/ui";
import { DownloadIcon, RefreshIcon } from "../../components/Icons";
import { saveTextFile } from "../../components/ChatCommands";
import { Card, Hint, Section, ToggleRow } from "./controls";
import { BigNumber, Block, BracketLabel, LedBar } from "../../components/brand";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

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

/** A day as YYYY-MM-DD in the user's own time zone. */
function isoDay(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Every call as a spreadsheet: a day range, one model, one chat or task. The file has one
 * row per call (when, which model, what for, tokens, cost), so the user can total it any
 * way they like.
 */
function UsageExport({ models }: { models: UsageByModel[] }) {
  const today = isoDay(new Date());
  const [since, setSince] = useState(isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const [until, setUntil] = useState(today);
  const [modelRef, setModelRef] = useState("");
  const [source, setSource] = useState("");
  const [sources, setSources] = useState<UsageSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getUsageSources({ since, until })
      .then((list) => {
        if (!alive) return;
        setSources(list);
        // A chat outside the new range has nothing to export.
        setSource((current) => (list.some((s) => s.id === current) ? current : ""));
      })
      .catch(() => alive && setSources([]));
    return () => {
      alive = false;
    };
  }, [since, until]);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const text = await exportUsage({ since, until, modelRef: modelRef || undefined, source: source || undefined });
      const calls = Math.max(0, text.trim().split("\n").length - 1);
      if (calls === 0) {
        setNote(t("ما في استدعاءات بهالفترة."));
        return;
      }
      const path = await saveTextFile(`rafiq-usage-${since}-${until}.csv`, text, "csv");
      if (path) setNote(t("انحفظ: {0}", { 0: path }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const named = models.filter((m) => m.model_ref);
  return (
    <Card>
      <p className="text-sm font-medium">{t("صدّر الاستهلاك")}</p>
      <Hint>{note ?? t("ملف CSV فيه كل طلب لحاله: الوقت، النموذج، المحادثة أو المهمة، التوكنات والكلفة. بيفتح بـ Excel أو Google Sheets.")}</Hint>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("من يوم")}
          </span>
          <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className="input py-1.5 text-sm" dir="ltr" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("لـ يوم")}
          </span>
          <input type="date" value={until} min={since} max={today} onChange={(e) => setUntil(e.target.value)} className="input py-1.5 text-sm" dir="ltr" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("النموذج")}
          </span>
          <select value={modelRef} onChange={(e) => setModelRef(e.target.value)} className="input py-1.5 text-sm">
            <option value="">{t("كل النماذج")}</option>
            {named.map((m) => (
              <option key={m.model_ref!} value={m.model_ref!}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("المحادثة أو المهمة")}
          </span>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="input py-1.5 text-sm">
            <option value="">{t("كل المحادثات والمهام")}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.kind === "task" ? t("مهمة: {0}", { 0: s.title }) : s.title} · {money(s.cost_usd)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" onClick={() => void save()} disabled={busy || !since || !until}>
          <DownloadIcon className="h-4 w-4" />
          {t("صدّر CSV")}
        </Button>
      </div>
    </Card>
  );
}

export function UsageSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { all: workspaces } = useWorkspaces();

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

  async function setWorkspaceBudget(id: string, daily: number) {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return;
    await saveWorkspace(
      { name: w.name, working_dir: w.working_dir, model_id: w.model_id, instructions: w.instructions, color: w.color, daily_budget_usd: daily || null },
      id,
    ).catch(() => undefined);
    await refreshWorkspaces();
    load();
  }

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
      {/* Today inverted and large; the month and the tokens beside it. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Block tone="inverse" className="flex flex-col gap-2">
          <BracketLabel tone="inverse">{t("اليوم")}</BracketLabel>
          <BigNumber value={summary?.today_usd ?? 0} decimals={2} prefix="$" size={40} />
          {(settings.daily_budget_usd ?? 0) > 0 && (
            <LedBar value={Math.min(1, (summary?.today_usd ?? 0) / (settings.daily_budget_usd ?? 1))} tone="inverse" label={t("حد يومي")} />
          )}
        </Block>
        <Block className="flex flex-col gap-2">
          <BracketLabel>{t("هالشهر")}</BracketLabel>
          <BigNumber value={summary?.month_usd ?? 0} decimals={2} prefix="$" size={34} />
          {(settings.monthly_budget_usd ?? 0) > 0 && (
            <LedBar value={Math.min(1, (summary?.month_usd ?? 0) / (settings.monthly_budget_usd ?? 1))} label={t("حد شهري")} />
          )}
        </Block>
        <Block className="flex flex-col gap-2">
          <BracketLabel>{t("توكنات (٣٠ يوم)")}</BracketLabel>
          <p className="num text-[34px] font-bold leading-none">{tokens(summary?.total_tokens ?? 0)}</p>
        </Block>
      </div>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-6">
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
                className="flex-1 rounded-[3px]"
                style={{ background: "var(--color-ink)", opacity: 0.8 }}
              />
            ))}
          </div>
        )}
      </Card>

      {summary?.by_workspace && summary.by_workspace.length > 0 && (
        <Card>
          <p className="text-sm font-medium">{t("حد لكل مساحة عمل")}</p>
          <Hint>{t("فوق الحد العام: كل مساحة إلها مصروفها اليومي. لما توصل حدها، محادثاتها ومهامها بتوقف لبكرا والباقي بيكمّل.")}</Hint>
          <motion.ul variants={listContainer} initial="hidden" animate="show" className="mt-3 flex flex-col divide-y" style={{ borderColor: "var(--color-border)" }}>
            {summary.by_workspace.map((w) => (
              <motion.li key={w.id} variants={listItem} className="flex items-center gap-4 py-2.5" style={{ borderColor: "var(--color-border)" }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w.color ?? "var(--color-ink-muted)" }} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm" dir="auto">
                    {w.name}
                  </p>
                  <BudgetMeter spent={w.today_usd} limit={w.daily_budget_usd} className="max-w-72" />
                </div>
                <BudgetField label={t("حد يومي")} value={w.daily_budget_usd ?? 0} onCommit={(n) => void setWorkspaceBudget(w.id, n)} />
              </motion.li>
            ))}
          </motion.ul>
        </Card>
      )}

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
                  <span className="num shrink-0 text-lg font-bold">{money(m.cost_usd)}</span>
                </div>
              </Card>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <UsageExport models={summary?.by_model ?? []} />

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
