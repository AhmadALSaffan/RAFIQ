/**
 * Settings for the agent's reach: tasks and providers, the web and the browser, and
 * running in the background. MCP servers live in ./mcp.tsx.
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { getWebSearchKeys, listModels, saveWebSearchKey } from "../../lib/api";
import { autostartEnabled, setAutostart, syncBackground } from "../../lib/background";
import { snappy } from "../../lib/motion";
import type { AppSettings, LlmModel, WebSearchKeys, WebSearchProvider } from "../../lib/types";
import { Button } from "../../components/ui";
import { Card, Hint, Section, SelectRow, SliderRow, ToggleRow } from "./controls";
import { t } from "../../i18n";

type Persist = (next: AppSettings) => void;

export function TasksSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [models, setModels] = useState<LlmModel[]>([]);

  useEffect(() => {
    listModels()
      .then((all) => setModels(all.filter((m) => m.verify_ok !== false)))
      .catch(() => setModels([]));
  }, []);

  return (
    <Section title={t("المهام والمزوّدين")}>
      <SelectRow
        label={t("موديل تنفيذ المهام")}
        hint={t("لما الموديل يفتح مهام من المحادثة، بتنفّذها هالموديل. خلّيه موديل أرخص أو أسرع وخلّي المحادثة على الموديل القوي.")}
        value={settings.task_model_id ?? ""}
        options={[
          { value: "", label: t("نفس موديل المحادثة") },
          ...models.map((m) => ({ value: m.id, label: m.name })),
        ]}
        onChange={(id) => persist({ ...settings, task_model_id: id || null })}
      />
      <SliderRow
        label={t("المهام بالتوازي")}
        hint={t("كم مهمة بتشتغل بنفس الوقت. المهام اللي بتعدّل نفس الملفات أو المجلد بتضل تستنى دورها، واللي بتعتمد على غيرها بتبلش لما تخلص.")}
        value={settings.max_parallel_tasks ?? 100}
        min={1}
        max={100}
        lowLabel={t("وحدة ورا التانية")}
        onCommit={(n) => persist({ ...settings, max_parallel_tasks: n })}
      />
      <ToggleRow
        label={t("نسخة git خاصة لكل مهمة")}
        hint={t("لما المجلد مشروع git، كل مهمة بتشتغل بنسخة معزولة (worktree) فبيشتغلوا كلهم مع بعض، وبعدين تغييراتها بتنطبق على مجلدك وبتقدر تراجعها أو ترجّعها من صفحة المهمة.")}
        checked={settings.task_isolation ?? true}
        onChange={(task_isolation) => persist({ ...settings, task_isolation })}
      />
      <SliderRow
        label={t("طلبات متزامنة لكل مفتاح")}
        hint={t("قدّيش طلب بيروح لنفس المزوّد وبنفس المفتاح بنفس الوقت. الباقي بيستنى دوره بدل ما يرجع بخطأ «rate limit»، والطلب اللي بيوقع بسبب الضغط بيتعاد تلقائياً.")}
        value={settings.provider_concurrency ?? 6}
        min={1}
        max={50}
        onCommit={(n) => persist({ ...settings, provider_concurrency: n })}
      />
    </Section>
  );
}

const SEARCH: { id: WebSearchProvider; label: string; hint: string }[] = [
  { id: "none", label: t("مطفي"), hint: t("الوكيل بيقدر يقرأ صفحات بس ما بيدوّر.") },
  { id: "brave", label: "Brave", hint: t("مفتاح مجاني من api-dashboard.search.brave.com") },
  { id: "tavily", label: "Tavily", hint: t("مفتاح مجاني من tavily.com") },
  { id: "searxng", label: "SearXNG", hint: t("خادم SearXNG خاص فيك (لازم يكون مفعّل فيه JSON).") },
];

export function WebSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [keys, setKeys] = useState<WebSearchKeys | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [url, setUrl] = useState(settings.searxng_url ?? "");
  const [saving, setSaving] = useState(false);
  const provider = settings.web_search_provider ?? "none";

  useEffect(() => {
    getWebSearchKeys()
      .then(setKeys)
      .catch(() => setKeys(null));
  }, []);

  async function saveKey() {
    if (provider !== "brave" && provider !== "tavily") return;
    setSaving(true);
    try {
      setKeys(await saveWebSearchKey(provider, draftKey));
      setDraftKey("");
    } finally {
      setSaving(false);
    }
  }

  const hasKey = provider === "brave" ? keys?.brave : provider === "tavily" ? keys?.tavily : false;

  return (
    <Section title={t("الويب والمتصفح")}>
      <Card>
        <p className="text-sm font-medium">{t("البحث على الويب")}</p>
        <Hint>{t("قراءة الصفحات (web_fetch) شغّالة دايماً. للبحث اختار خدمة رسمية وحط مفتاحها — المفتاح بينحفظ بـ Windows Credential Manager.")}</Hint>
        <div className="mt-3 flex flex-wrap gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-2)" }} role="radiogroup">
          {SEARCH.map((option) => {
            const active = option.id === provider;
            return (
              <button
                key={option.id}
                role="radio"
                aria-checked={active}
                onClick={() => persist({ ...settings, web_search_provider: option.id })}
                className="relative flex-1 rounded-lg px-3 py-1.5 text-xs"
                style={{ color: active ? "var(--color-bg)" : "var(--color-ink-muted)" }}
              >
                {active && <motion.span layoutId="search-provider" className="absolute inset-0 rounded-lg" style={{ background: "var(--color-accent)" }} transition={snappy} />}
                <span className="relative">{option.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
          {SEARCH.find((s) => s.id === provider)?.hint}
        </p>
        {(provider === "brave" || provider === "tavily") && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.currentTarget.value)}
              placeholder={hasKey ? t("المفتاح محفوظ — اكتب واحد جديد لتبدّله") : t("الصق المفتاح هون")}
              className="input min-w-0 flex-1"
              dir="ltr"
            />
            <Button onClick={saveKey} disabled={saving || !draftKey.trim()}>
              {t("احفظ")}
            </Button>
            {hasKey && (
              <Button variant="ghost" onClick={() => void saveWebSearchKey(provider, "").then(setKeys)}>
                {t("احذف")}
              </Button>
            )}
          </div>
        )}
        {provider === "searxng" && (
          <input
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onBlur={() => url !== (settings.searxng_url ?? "") && persist({ ...settings, searxng_url: url.trim() || null })}
            placeholder="https://searx.example.org"
            className="input mt-2 w-full"
            dir="ltr"
          />
        )}
      </Card>
      <ToggleRow
        label={t("اعرض نافذة المتصفح")}
        hint={t("أدوات المتصفح بتشتغل على Microsoft Edge بملف تعريف خاص فيها (ما بتلمس حساباتك). طفّيها ليشتغل مخفي، أو شغّلها لتتفرج عليه وهو عم يشتغل.")}
        checked={settings.browser_visible ?? false}
        onChange={(browser_visible) => persist({ ...settings, browser_visible })}
      />
    </Section>
  );
}

export function BackgroundSettings({ settings, persist }: { settings: AppSettings; persist: Persist }) {
  const [autostart, setAutostartState] = useState<boolean | null>(null);

  useEffect(() => {
    autostartEnabled().then(setAutostartState);
  }, []);

  return (
    <Section title={t("التشغيل بالخلفية")}>
      <ToggleRow
        label={t("خلّي رفيق شغّال لما تسكّر النافذة")}
        hint={t("بيضل بجنب الساعة (أيقونة رفيق)، والمهام والمهام المجدولة بتكمل، وبيطلعلك إشعار لما مهمة تخلص أو بدها إذنك. للإنهاء الكامل: كليك يمين على الأيقونة ← إنهاء.")}
        checked={settings.run_in_background ?? true}
        onChange={(run_in_background) => {
          persist({ ...settings, run_in_background });
          void syncBackground(run_in_background);
        }}
      />
      {autostart !== null && (
        <ToggleRow
          label={t("شغّل رفيق مع ويندوز")}
          hint={t("بيفتح مخفي بجنب الساعة، فالمهام المجدولة بتشتغل بوقتها بدون ما تفتحه.")}
          checked={autostart}
          onChange={(on) => void setAutostart(on).then(setAutostartState)}
        />
      )}
    </Section>
  );
}
