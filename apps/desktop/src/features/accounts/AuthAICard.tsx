/**
 * AuthAI — experimental and unofficial, off by default. This card is the only place it can
 * be switched on, and it says plainly what the user is opting into before they do.
 *
 * The per-app secret is write-only: it goes to the Windows keychain and the UI only ever
 * learns whether one is saved.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getAuthAIConfig, saveAuthAIConfig } from "../../lib/api";
import type { AuthAIConfig } from "../../lib/types";
import { AlertIcon } from "../../components/Icons";
import { Button, DrawnCheck, ErrorText } from "../../components/ui";

import { t } from "../../i18n";
export function AuthAICard({ onChanged }: { onChanged: () => void }) {
  const [config, setConfig] = useState<AuthAIConfig | null>(null);
  const [relay, setRelay] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthAIConfig()
      .then((c) => {
        setConfig(c);
        setRelay(c.relay_url ?? "");
      })
      .catch(() => setConfig(null));
  }, []);

  // The module may be absent (it's optional) — then there's simply nothing to show.
  if (!config) return null;

  async function save(next: { enabled: boolean; withFields?: boolean }) {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveAuthAIConfig({
        enabled: next.enabled,
        relay_url: relay.trim() || null,
        secret: next.withFields && secret.trim() ? secret.trim() : undefined,
      });
      setConfig(updated);
      setSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("صار خطأ"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        borderColor: config.enabled ? "var(--color-pending)" : "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            AuthAI
            <Chip label={t("تجريبي")} />
            <Chip label={t("غير رسمي")} />
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("تسجيل دخول بحساب ChatGPT أو Grok أو GitHub Copilot عن طريق relay خارجي.")}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={config.enabled}
          aria-label={t("فعّل AuthAI")}
          disabled={saving}
          onClick={() => void save({ enabled: !config.enabled })}
          className="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200"
          style={{
            background: config.enabled ? "var(--color-pending)" : "var(--color-surface-2)",
            justifyContent: config.enabled ? "flex-end" : "flex-start",
          }}
        >
          <motion.span layout className="h-5 w-5 rounded-full bg-white shadow-sm" />
        </button>
      </div>

      <div
        className="mt-3 flex gap-2 rounded-md px-3 py-2.5 text-xs leading-relaxed"
        style={{ background: "color-mix(in oklch, var(--color-pending) 10%, transparent)", color: "var(--color-ink)" }}
      >
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--color-pending)" }} />
        <span>
          {t("AuthAI مشروع مستقل مش تابع لـ OpenAI ولا xAI ولا GitHub. بيسجّل الدخول بنفس الطريقة اللي بتستعملها أدوات هالشركات الرسمية، وحسب توثيقه بيوصّل طلبات ChatGPT لواجهة ChatGPT الداخلية — وهاد مش مسموح رسمياً للتطبيقات التانية. الشركات ممكن توقفه أو تغيّره بأي وقت، واستعماله ممكن يخالف شروطها ويعرّض حسابك للإيقاف. رسائلك بتمرق على الـ relay اللي بتختاره. استعمله لتجارب شخصية بس.")}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {config.enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("عنوان الـ relay")}
                <input
                  value={relay}
                  onChange={(e) => setRelay(e.target.value)}
                  placeholder="https://relay.authai.io"
                  className="input font-mono text-xs"
                  dir="ltr"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                App secret {config.has_secret && <span style={{ color: "var(--color-success)" }}>{t("— محفوظ بخزنة ويندوز")}</span>}
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  type="password"
                  placeholder={config.has_secret ? t("••••••••  (اتركه فاضي لتضل القيمة نفسها)") : "AUTH_AI_SECRET"}
                  className="input font-mono text-xs"
                  dir="ltr"
                  autoComplete="off"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              {t("الـ relay المستضاف بيحتاج app secret من authai.io. إذا مستضيف الـ relay عندك، حط عنوانه وما بتحتاج secret.")}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="ghost" className="px-2.5 py-1 text-xs" disabled={saving} onClick={() => void save({ enabled: true, withFields: true })}>
                {t("احفظ")}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-success)" }}>
                  <DrawnCheck className="h-3.5 w-3.5" />
                  {t("انحفظ")}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ErrorText message={error} />
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-normal"
      style={{ borderColor: "color-mix(in oklch, var(--color-pending) 45%, transparent)", color: "var(--color-pending)" }}
    >
      {label}
    </span>
  );
}
