import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrationProviders,
  listIntegrations,
  listIssues,
  verifyIntegration,
} from "../lib/api";
import type { IntegrationAccount, IntegrationProvider, TrackerIssue } from "../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../lib/motion";
import { timeAgo } from "../lib/time";
import { useElementMenu, usePageMenu } from "../components/ContextMenu";
import { PageHeader, RefreshButton, StatusStripe } from "../components/Page";
import { ActionProgress } from "../components/Feedback";
import { CATEGORY_COLOR as ISSUE_COLOR } from "../features/work/pieces";
import { AlertIcon, LinkIcon, SpinnerIcon, TrashIcon } from "../components/Icons";
import { Button, DrawnCheck, ErrorText, Field, Reveal } from "../components/ui";
import { BrandMark } from "../components/BrandMark";

import { t } from "../i18n";
export function IntegrationsPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<IntegrationProvider | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshAll() {
    setRefreshing(true);
    try {
      setAccounts(await listIntegrations());
      await refreshIssues();
    } catch {
      // Leave the last good list on screen.
    } finally {
      setRefreshing(false);
    }
  }

  usePageMenu(() => [
    { id: "refresh", label: t("حدّث الحسابات"), onSelect: () => void refreshAll() },
    { id: "work", label: t("روح لشغلي"), onSelect: () => navigate("/work"), disabled: accounts.length === 0 },
  ]);

  const refreshIssues = () => listIssues("", 12).then(setIssues).catch(() => setIssues([]));

  useEffect(() => {
    Promise.all([listIntegrationProviders(), listIntegrations()]).then(([p, a]) => {
      setProviders(p);
      setAccounts(a);
      setLoading(false);
      if (a.length) refreshIssues();
    });
  }, []);

  const connected = useMemo(() => new Set(accounts.map((a) => a.provider)), [accounts]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title={t("الربط")}
        description={
          <>
            {t("اربط حساب تتبّع المهام تبعك، وبتقدر تشاور على مهامك بالمحادثة بـ")} <code className="md-inline">/</code> {t("ورفيق يكتب التعليق ويعلّمها مكتملة لما تخلص.")}
          </>
        }
        actions={accounts.length > 0 && <RefreshButton spinning={refreshing} onClick={() => void refreshAll()} />}
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="shimmer h-[72px] rounded-xl border" style={{ borderColor: "var(--color-border)" }} />
          ))}
        </div>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {accounts.length > 0 && (
              <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8 flex flex-col gap-2">
                {accounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    provider={providers.find((p) => p.id === account.provider)}
                    onUpdated={(next) => setAccounts((prev) => prev.map((a) => (a.id === next.id ? next : a)))}
                    onRemoved={() => {
                      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
                      refreshIssues();
                    }}
                  />
                ))}
              </motion.section>
            )}
          </AnimatePresence>

          <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--color-ink-muted)" }}>
            {accounts.length ? t("اربط حساب ثاني") : t("اختار المنصّة")}
          </h2>
          <motion.div variants={listContainer} initial="hidden" animate="show" className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {providers.map((provider) => (
              <motion.button
                key={provider.id}
                variants={listItem}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                transition={snappy}
                onClick={() => setConnecting(connecting?.id === provider.id ? null : provider)}
                className="flex items-start gap-3 rounded-xl border px-4 py-3 text-start transition-colors hover:bg-[var(--color-surface-2)]"
                style={{
                  borderColor: connecting?.id === provider.id ? "var(--color-accent)" : "var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                <BrandMark provider={provider.id} className="mt-0.5 h-5 w-5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {provider.name}
                    {connected.has(provider.id) && (
                      <span className="text-xs" style={{ color: "var(--color-success)" }}>
                        {t("مربوط")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {provider.blurb}
                  </span>
                </span>
              </motion.button>
            ))}
          </motion.div>

          <Reveal open={Boolean(connecting)}>
            {connecting && (
              <ConnectForm
                provider={connecting}
                onCancel={() => setConnecting(null)}
                onConnected={(account) => {
                  setAccounts((prev) => [...prev, account]);
                  setConnecting(null);
                  refreshIssues();
                }}
              />
            )}
          </Reveal>

          <AnimatePresence>
            {issues.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: easeOutExpo }}
                className="mt-10"
              >
                <h2 className="mb-3 text-sm font-medium">{t("مهامك المفتوحة")}</h2>
                <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
                  {issues.map((issue) => (
                    <motion.li
                      key={`${issue.integration_id}-${issue.key}`}
                      variants={listItem}
                      className="relative flex items-center justify-between gap-3 overflow-hidden rounded-lg border px-4 py-2.5"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <StatusStripe color={ISSUE_COLOR[issue.status_category ?? "todo"]} />
                      <span className="flex min-w-0 items-center gap-2.5">
                        <BrandMark provider={issue.provider} className="h-4 w-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm" dir="auto">
                            {issue.title}
                          </span>
                          <span className="font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                            {issue.key}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}>
                        {issue.status}
                      </span>
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.section>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function AccountRow({
  account,
  provider,
  onUpdated,
  onRemoved,
}: {
  account: IntegrationAccount;
  provider?: IntegrationProvider;
  onUpdated: (next: IntegrationAccount) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menu = useElementMenu();

  async function reverify() {
    setBusy(true);
    try {
      onUpdated(await verifyIntegration(account.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: easeOutExpo }}
      className="relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      onMouseLeave={() => setConfirming(false)}
      onContextMenu={menu(() => [
        { id: "verify", label: t("افحص الربط"), onSelect: () => void reverify(), disabled: busy },
        { id: "disconnect", label: t("افصل الحساب"), onSelect: () => setConfirming(true), danger: true },
      ])}
    >
      <ActionProgress active={busy} />
      <StatusStripe
        color={busy ? "var(--color-accent)" : account.verify_ok === false ? "var(--color-danger)" : "var(--color-success)"}
      />
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark provider={account.provider} className="h-6 w-6 shrink-0" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {account.name}
            {account.verify_ok === false ? (
              <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-danger)" }}>
                <AlertIcon className="h-3.5 w-3.5" />
                {t("ما اشتغل")}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-success)" }}>
                <DrawnCheck className="h-3.5 w-3.5" />
                {t("مربوط")}
              </span>
            )}
          </p>
          <p className="truncate text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
            {account.verify_ok === false
              ? account.verify_error
              : `${account.account_label ?? ""}${account.verified_at ? t(" · آخر فحص {0}", { 0: timeAgo(account.verified_at) }) : ""}`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {provider && (
          <a
            href={provider.docs_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: "var(--color-ink-muted)" }}
            title={t("إدارة المفاتيح عند المزوّد")}
          >
            <LinkIcon className="h-4 w-4" />
          </a>
        )}
        <RefreshButton spinning={busy} onClick={() => void reverify()} label={t("افحص الربط")} />
        <AnimatePresence mode="wait" initial={false}>
          {confirming ? (
            <motion.div key="c" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="flex gap-1">
              <Button
                variant="danger"
                className="px-2.5 py-1 text-xs"
                onClick={async () => {
                  await disconnectIntegration(account.id);
                  onRemoved();
                }}
              >
                {t("فصل")}
              </Button>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirming(false)}>
                {t("لا")}
              </Button>
            </motion.div>
          ) : (
            <motion.button
              key="t"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setConfirming(true)}
              aria-label={t("فصل الحساب")}
              className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <TrashIcon className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function ConnectForm({
  provider,
  onCancel,
  onConnected,
}: {
  provider: IntegrationProvider;
  onCancel: () => void;
  onConnected: (account: IntegrationAccount) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    setName("");
    setError(null);
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
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-4 rounded-xl border p-5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex items-center gap-2">
        <BrandMark provider={provider.id} className="h-5 w-5" />
        <span className="text-sm font-medium">{t("ربط")} {provider.name}</span>
        <a href={provider.docs_url} target="_blank" rel="noreferrer" className="ms-auto text-xs underline-offset-2 hover:underline" style={{ color: "var(--color-accent)" }}>
          {t("من وين أجيب المفتاح؟")}
        </a>
      </div>

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
  );
}
