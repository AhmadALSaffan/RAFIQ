/** Settings → Usage: the smart route, and how much one task or chat may cost. */

import { useEffect, useState } from "react";
import type { AppSettings, LlmModel } from "../../lib/types";
import { listModels } from "../../lib/api";
import { Card, Hint, Section, ToggleRow } from "./controls";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

function CapField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  useEffect(() => setDraft(value ? String(value) : ""), [value]);
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <span className="flex items-center gap-1" dir="ltr">
        <span style={{ color: "var(--color-ink-muted)" }}>$</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={draft}
          placeholder="0"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(Math.max(0, Number(draft) || 0))}
          className="input w-28"
        />
      </span>
    </label>
  );
}

export function SavingsSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [models, setModels] = useState<LlmModel[]>([]);
  useEffect(() => {
    listModels()
      .then((list) => setModels(list.filter((m) => m.verify_ok !== false)))
      .catch(() => setModels([]));
  }, []);
  const on = settings.smart_route ?? false;

  return (
    <Section title={t("مصاري أقل")}>
      <ToggleRow
        label={t("المسار الذكي")}
        hint={t("السؤال القصير اللي ما بده ملفات ولا أدوات بيروح للنموذج الرخيص، والشغل الكبير بيضل مع النموذج اللي اخترته. كل رد بيقلك مين جاوب.")}
        checked={on}
        onChange={(smart_route) => persist({ ...settings, smart_route })}
      />
      {on && (
        <Card>
          <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
            {t("النموذج الرخيص")}
            <select
              value={settings.cheap_model_id ?? ""}
              onChange={(e) => persist({ ...settings, cheap_model_id: e.target.value || null })}
              aria-label={t("النموذج الرخيص")}
              className="input max-w-64 py-1.5"
            >
              <option value="">{t("اختار نموذج")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {!settings.cheap_model_id && <Hint>{t("ما رح يشتغل المسار الذكي لحد ما تختار نموذج.")}</Hint>}
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap gap-6">
          <CapField label={t("حد لكل مهمة")} value={settings.task_cost_cap_usd ?? 0} onCommit={(task_cost_cap_usd) => persist({ ...settings, task_cost_cap_usd })} />
          <CapField label={t("حد لكل محادثة")} value={settings.chat_cost_cap_usd ?? 0} onCommit={(chat_cost_cap_usd) => persist({ ...settings, chat_cost_cap_usd })} />
        </div>
        <Hint>{t("لما مهمة أو محادثة توصل حدها، رفيق بيوقف وبيسألك إذا بدك تكمّل. صفر = بلا حد. الفحص قبل كل طلب للنموذج، فالرد الطويل ممكن يتعدّى الحد شوي، والنماذج اللي ما إلها سعر معروف ما بتنحسب.")}</Hint>
      </Card>
    </Section>
  );
}
