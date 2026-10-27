/** Connecting a tracker: with a key (every provider), or — for GitHub and GitLab — by
 *  signing in with a code on the provider's own page (OAuth device flow), so no token is
 *  ever pasted. */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { snappy } from "../../lib/motion";
import { connectIntegration, pollDeviceSignIn, startDeviceSignIn } from "../../lib/api";
import type { DeviceSignIn, IntegrationAccount, IntegrationProvider } from "../../lib/types";
import { Button, ErrorText, Field } from "../../components/ui";
import { CopyIcon, ExternalIcon, KeyIcon, ShieldIcon, SpinnerIcon } from "../../components/Icons";
import { BrandMark } from "../../components/BrandMark";
import { openExternal } from "../../lib/links";
import { t } from "../../i18n";

const DEVICE = new Set(["github", "gitlab"]);

export function ConnectForm({
  provider,
  onCancel,
  onConnected,
}: {
  provider: IntegrationProvider;
  onCancel: () => void;
  onConnected: (account: IntegrationAccount) => void;
}) {
  const [mode, setMode] = useState<"key" | "device">("key");
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    setName("");
    setError(null);
    setMode("key");
  }, [provider.id]);

  const missing = provider.fields.some((f) => f.required && !values[f.key]?.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onConnected(await connectIntegration({ provider: provider.id, name: name.trim() || undefined, config: values }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما قدرت أربط الحساب"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl p-5" style={{ background: "var(--color-surface)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <BrandMark provider={provider.id} className="h-5 w-5" />
        <span className="text-sm font-medium">{t("ربط")} {provider.name}</span>
        {DEVICE.has(provider.id) && (
          <div className="ms-auto flex rounded-full p-0.5 text-xs" style={{ background: "var(--color-surface-2)" }} role="tablist">
            {(["key", "device"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className="relative rounded-full px-3 py-1 transition-colors"
                style={{ color: mode === m ? "var(--color-ink)" : "var(--color-ink-muted)" }}
              >
                {mode === m && <motion.span layoutId="connect-mode" className="absolute inset-0 rounded-full" style={{ background: "var(--color-surface)" }} transition={snappy} />}
                <span className="relative">{m === "key" ? t("بمفتاح") : t("بكود تسجيل دخول")}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {provider.scopes && (
        <p className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
          <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>{t("الصلاحيات اللازمة:")}</span> <span dir="auto">{provider.scopes}</span>
          </span>
        </p>
      )}

      {mode === "device" ? (
        <DeviceForm provider={provider} name={name} setName={setName} onConnected={onConnected} onCancel={onCancel} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => void openExternal(provider.token_url || provider.docs_url)}
            className="flex items-center gap-1.5 self-start text-xs underline underline-offset-2"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <KeyIcon className="h-3.5 w-3.5" />
            {t("اعمل مفتاح جديد عند {0}", { 0: provider.name })}
            <ExternalIcon className="h-3 w-3" />
          </button>
          {provider.fields.map((field) => (
            <Field key={field.key} label={`${field.label}${field.required ? "" : t(" (اختياري)")}`} hint={field.help || undefined}>
              <input
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                type={field.kind === "password" ? "password" : "text"}
                placeholder={field.placeholder}
                className={`input ${field.kind === "text" && field.key === "email" ? "" : "font-mono"}`}
                dir={field.kind === "url" || field.kind === "password" ? "ltr" : "auto"}
                autoComplete="off"
              />
            </Field>
          ))}
          <Field label={t("اسم يظهرلك (اختياري)")}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={provider.name} className="input" />
          </Field>
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("المفتاح بينحفظ بخزنة ويندوز، وما بينحط بقاعدة البيانات.")}
          </p>
          <ErrorText message={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || missing}>
              {saving ? (
                <>
                  <SpinnerIcon className="h-4 w-4" />
                  {t("جارِ التحقق…")}
                </>
              ) : (
                t("تحقق واربط")
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("إلغاء")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function DeviceForm({
  provider,
  name,
  setName,
  onConnected,
  onCancel,
}: {
  provider: IntegrationProvider;
  name: string;
  setName: (v: string) => void;
  onConnected: (account: IntegrationAccount) => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState(() => localStorage.getItem(`rafiq.oauth.${provider.id}`) ?? "");
  const [baseUrl, setBaseUrl] = useState("");
  const [flow, setFlow] = useState<DeviceSignIn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      localStorage.setItem(`rafiq.oauth.${provider.id}`, clientId.trim());
      const started = await startDeviceSignIn({ provider: provider.id as "github" | "gitlab", client_id: clientId.trim(), base_url: baseUrl.trim(), name: name.trim() || undefined });
      setFlow(started);
      void openExternal(started.verification_uri_complete || started.verification_uri);
      schedule(started.flow_id, started.interval);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ما زبط"));
    } finally {
      setStarting(false);
    }
  }

  function schedule(flowId: string, seconds: number) {
    timer.current = window.setTimeout(async () => {
      try {
        const result = await pollDeviceSignIn(flowId);
        if (result.status === "done" && result.integration) return onConnected(result.integration);
        if (result.status === "expired") return (setFlow(null), setError(t("الكود انتهى — جرّب من جديد.")));
        if (result.status === "denied") return (setFlow(null), setError(t("رفضت الطلب عند {0}.", { 0: provider.name })));
        schedule(flowId, result.status === "slow_down" ? seconds + 5 : seconds);
      } catch (err) {
        setFlow(null);
        setError(err instanceof Error ? err.message : t("ما زبط"));
      }
    }, seconds * 1000);
  }

  if (flow) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3 py-2 text-center">
        <p className="text-sm">{t("اكتب هالكود بصفحة {0} اللي انفتحت:", { 0: provider.name })}</p>
        <button
          onClick={() => void navigator.clipboard.writeText(flow.user_code)}
          className="flex items-center gap-2 rounded-2xl px-5 py-3 font-mono text-2xl font-bold tracking-[0.2em]"
          style={{ background: "var(--color-surface-2)" }}
          dir="ltr"
          title={t("انسخ الكود")}
        >
          {flow.user_code}
          <CopyIcon className="h-4 w-4" />
        </button>
        <button onClick={() => void openExternal(flow.verification_uri)} className="text-xs underline underline-offset-2" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
          {flow.verification_uri}
        </button>
        <p className="flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
          <SpinnerIcon className="h-3.5 w-3.5" />
          {t("عم استنى توافق…")}
        </p>
        <Button variant="ghost" onClick={() => { if (timer.current) window.clearTimeout(timer.current); setFlow(null); }}>
          {t("إلغاء")}
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
        {t("بتسجّل دخول بصفحة {0} نفسها وبتكتب كود قصير — ما في مفتاح تنسخه. بيلزمك تطبيق OAuth باسمك (أو باسم شركتك) مفعّل فيه Device flow، وبتحط الـ Client ID تبعه هون مرة وحدة.", { 0: provider.name })}
      </p>
      <Field label="Client ID" hint={provider.id === "github" ? t("GitHub ← Settings ← Developer settings ← OAuth Apps ← فعّل Enable Device Flow") : t("GitLab ← Preferences ← Applications ← بدون Confidential، وبصلاحية api")}>
        <input className="input font-mono" dir="ltr" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
      </Field>
      {provider.id === "gitlab" && (
        <Field label={t("رابط الخادم (اختياري)")}>
          <input className="input font-mono" dir="ltr" placeholder="https://gitlab.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
      )}
      <Field label={t("اسم يظهرلك (اختياري)")}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={provider.name} className="input" />
      </Field>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <Button onClick={() => void start()} disabled={starting || !clientId.trim()}>
          {starting ? <SpinnerIcon className="h-4 w-4" /> : null}
          {t("سجّل دخول بـ {0}", { 0: provider.name })}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("إلغاء")}
        </Button>
      </div>
    </div>
  );
}
