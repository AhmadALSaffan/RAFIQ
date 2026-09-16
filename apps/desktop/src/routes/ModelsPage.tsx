import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  createModel,
  deleteModel,
  discoverModels,
  listAccounts,
  listModels,
  providerLabel,
  setModelAccount,
  setModelFallback,
  verifyModel,
} from "../lib/api";
import { GROUP_LABEL, PROVIDERS, providerMeta } from "../lib/providers";
import type { ProviderGroup } from "../lib/providers";
import type { AuthAccount, DiscoveredModel, LlmModel, Provider } from "../lib/types";
import { easeOutExpo, listContainer, listItem, snappy } from "../lib/motion";
import { timeAgo } from "../lib/time";
import { useElementMenu, usePageMenu } from "../components/ContextMenu";
import { PageHeader, RefreshButton, StatusStripe } from "../components/Page";
import { ActionProgress } from "../components/Feedback";
import { AlertIcon, ModelsIcon, PlusIcon, RefreshIcon, SearchIcon, SpinnerIcon, TrashIcon } from "../components/Icons";
import { Button, DrawnCheck, EmptyState, ErrorText, Field, Reveal } from "../components/ui";
import { BrandMark } from "../components/BrandMark";
import { fieldDir } from "../lib/bidi";
import { ConnectAccount } from "../features/accounts/ConnectAccount";
import { accountLabel } from "../features/accounts/labels";

import { t } from "../i18n";
export function ModelsPage() {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);

  async function refresh() {
    setRefreshing(true);
    try {
      const [m, a] = await Promise.all([listModels(), listAccounts().catch(() => [] as AuthAccount[])]);
      setModels(m);
      setAccounts(a);
    } catch {
      // Keep what's on screen; the next visit tries again.
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  usePageMenu(() => [
    { id: "add-model", label: t("أضف نموذج"), onSelect: () => setFormOpen(true) },
    { id: "refresh", label: t("حدّث القائمة"), onSelect: () => void refresh() },
  ]);

  useEffect(() => {
    void refresh();
  }, []);

  async function handleDelete(id: string) {
    setModels((prev) => prev.filter((m) => m.id !== id));
    await deleteModel(id);
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title={t("النماذج")}
        description={t("اختار المزوّد، حط مفتاحك، وبنجيبلك الموديلات المتاحة إلك مباشرة من عنده.")}
        actions={
          <>
            <RefreshButton spinning={refreshing} onClick={() => void refresh()} />
            {!formOpen && (
              <Button onClick={() => setFormOpen(true)}>
                <PlusIcon className="h-4 w-4" />
                {t("إضافة نموذج")}
              </Button>
            )}
          </>
        }
      />

      <Reveal open={formOpen}>
        <NewModelForm
          onCancel={() => setFormOpen(false)}
          onCreated={(m) => {
            setModels((prev) => [...prev, m]);
            setJustAdded(m.id);
            setFormOpen(false);
          }}
        />
      </Reveal>

      {loading ? (
        <ListSkeleton />
      ) : models.length === 0 && !formOpen ? (
        <EmptyState
          icon={<ModelsIcon className="h-8 w-8" />}
          text={t("ما في نماذج مضافة بعد. أضف أول نموذج عشان تقدر تبلّش مهمة.")}
          action={<Button onClick={() => setFormOpen(true)}>{t("إضافة نموذج")}</Button>}
        />
      ) : (
        <motion.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {models.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                highlight={m.id === justAdded}
                accounts={accounts.filter((a) => a.provider === m.provider && a.status === "connected")}
                others={models.filter((x) => x.id !== m.id)}
                onDelete={() => handleDelete(m.id)}
                onUpdated={(next) => setModels((prev) => prev.map((x) => (x.id === next.id ? next : x)))}
              />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="shimmer h-[66px] rounded-lg border"
          style={{ borderColor: "var(--color-border)", animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}

function ModelRow({
  model,
  highlight,
  accounts,
  others,
  onDelete,
  onUpdated,
}: {
  model: LlmModel;
  highlight: boolean;
  /** Connected accounts this agent could sign in with (same provider). */
  accounts: AuthAccount[];
  /** The other agents — any of them can be this one's fallback. */
  others: LlmModel[];
  onDelete: () => void;
  onUpdated: (m: LlmModel) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menu = useElementMenu();
  const stripe = testing
    ? "var(--color-accent)"
    : model.verify_ok === true
      ? "var(--color-success)"
      : model.verify_ok === false
        ? "var(--color-danger)"
        : "var(--color-border)";

  async function retest() {
    setTesting(true);
    try {
      onUpdated(await verifyModel(model.id));
    } finally {
      setTesting(false);
    }
  }

  return (
    <motion.li
      layout
      variants={listItem}
      exit="exit"
      className={`relative overflow-hidden rounded-lg border px-4 py-3 ${highlight ? "flash-accent" : ""}`}
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      onContextMenu={menu(() => [
        { id: "verify", label: t("افحص من جديد"), onSelect: () => void retest(), disabled: testing },
        { id: "copy-id", label: t("انسخ اسم الموديل"), onSelect: () => void navigator.clipboard.writeText(model.model_id) },
        { id: "delete", label: t("احذف النموذج"), onSelect: () => setConfirmDelete(true), danger: true },
      ])}
    >
      <ActionProgress active={testing} />
      <StatusStripe color={stripe} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BrandMark provider={model.provider} className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">{model.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: "var(--color-surface-2)", color: "var(--color-ink-muted)" }}
            >
              {providerLabel(model.provider)}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
            {model.model_id}
          </p>
          {model.auth_method === "oauth" && (
            <AccountLine
              model={model}
              accounts={accounts}
              onSwitch={async (accountId) => {
                setTesting(true);
                try {
                  onUpdated(await setModelAccount(model.id, accountId));
                } finally {
                  setTesting(false);
                }
              }}
            />
          )}
          {others.length > 0 && (
            <label className="mt-1.5 flex items-center gap-2 text-xs" style={{ color: "var(--color-ink-muted)" }}>
              <span className="shrink-0">{t("احتياطي:")}</span>
              <select
                value={model.fallback_model_id ?? ""}
                onChange={async (e) => onUpdated(await setModelFallback(model.id, e.currentTarget.value || null))}
                className="input h-7 min-w-0 max-w-56 py-0 text-xs"
                title={t("إذا المزوّد ضل يرفض أو وقع، الطلب بيروح للنموذج الاحتياطي تلقائياً.")}
              >
                <option value="">{t("بلا")}</option>
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <VerifyStatus model={model} testing={testing} />
          <RefreshButton spinning={testing} onClick={() => void retest()} label={t("افحص إذا الموديل شغّال")} />
          <AnimatePresence mode="wait" initial={false}>
            {confirmDelete ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-1"
              >
                <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={onDelete}>
                  {t("حذف")}
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirmDelete(false)}>
                  {t("لا")}
                </Button>
              </motion.div>
            ) : (
              <motion.button
                key="trash"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setConfirmDelete(true)}
                aria-label={t("حذف")}
                className="rounded-md p-2 transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                <TrashIcon className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {model.verify_ok === false && model.verify_error && !testing && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 text-xs"
            style={{ color: "var(--color-danger)" }}
          >
            {model.verify_error}
          </motion.p>
        )}
      </AnimatePresence>
      {model.verify_ok && model.supports_tools === false && (
        <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "var(--color-pending)" }}>
          <AlertIcon className="h-3.5 w-3.5" />
          {t("هالموديل ما بيدعم استدعاء الأدوات — ممكن يحكي بس ما يقدر ينفّذ شي على جهازك.")}
        </p>
      )}
    </motion.li>
  );
}

function VerifyStatus({ model, testing }: { model: LlmModel; testing: boolean }) {
  let content: React.ReactNode;
  let color = "var(--color-ink-muted)";
  let key = "unknown";

  if (testing) {
    key = "testing";
    content = (
      <>
        <SpinnerIcon className="h-3.5 w-3.5" />
        {t("جارِ الفحص")}
      </>
    );
  } else if (model.verify_ok) {
    key = `ok-${model.verified_at}`;
    color = "var(--color-success)";
    content = (
      <>
        <DrawnCheck className="h-3.5 w-3.5" />
        {t("شغّال")}{model.verify_latency_ms != null ? ` · ${model.verify_latency_ms}ms` : ""}
      </>
    );
  } else if (model.verify_ok === false) {
    key = `fail-${model.verified_at}`;
    color = "var(--color-danger)";
    content = (
      <>
        <AlertIcon className="h-3.5 w-3.5" />
        {t("ما اشتغل")}
      </>
    );
  } else {
    content = t("ما انفحص");
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={key}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: easeOutExpo }}
        className="flex items-center gap-1 whitespace-nowrap px-1 text-xs font-medium"
        style={{ color }}
        title={model.verified_at ? t("آخر فحص {0}", { 0: timeAgo(model.verified_at) }) : undefined}
      >
        {content}
      </motion.span>
    </AnimatePresence>
  );
}

type FetchState = { status: "idle" } | { status: "loading" } | { status: "done"; models: DiscoveredModel[] } | { status: "error"; message: string };

/** Which account an OAuth agent signs in as — and a switch, when there's more than one. */
function AccountLine({
  model,
  accounts,
  onSwitch,
}: {
  model: LlmModel;
  accounts: AuthAccount[];
  onSwitch: (accountId: string) => void;
}) {
  const disconnected = model.account_status !== "connected";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
      <span style={{ color: disconnected ? "var(--color-danger)" : "var(--color-ink-muted)" }}>
        {disconnected ? t("الحساب مفصول — اربطه من الإعدادات ← الحسابات المتصلة") : t("بيسجّل دخول بحساب")}
      </span>
      {accounts.length > 1 ? (
        <select
          value={model.account_id ?? ""}
          onChange={(e) => onSwitch(e.target.value)}
          className="rounded-md border bg-transparent px-1.5 py-0.5 text-xs"
          style={{ borderColor: "var(--color-border)" }}
          dir="ltr"
          aria-label={t("الحساب")}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountLabel(a.provider, a.label)}
            </option>
          ))}
        </select>
      ) : (
        model.account_label && (
          <bdi dir="ltr" className="font-medium" style={{ color: "var(--color-ink)" }}>
            {accountLabel(model.provider, model.account_label)}
          </bdi>
        )
      )}
    </div>
  );
}

function NewModelForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (m: LlmModel) => void }) {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DiscoveredModel | null>(null);
  const [manualId, setManualId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [connecting, setConnecting] = useState(false);
  // Providers that take a key *or* an account (OpenRouter): which one this agent uses.
  const [useAccount, setUseAccount] = useState(false);
  // AWS signs with a key pair, so it gets two fields that become one saved secret.
  const [awsId, setAwsId] = useState("");
  const [awsSecret, setAwsSecret] = useState("");
  // Non-secret provider settings (region, api_version, project…).
  const [options, setOptions] = useState<Record<string, string>>({});

  const meta = providerMeta(provider);
  const isAccount = Boolean(meta.account || (meta.accountOptional && useAccount));
  const effectiveBaseUrl = baseUrl || meta.defaultBaseUrl || "";
  const showBaseUrl = Boolean(meta.needsBaseUrl || meta.baseUrlOptional);
  const providerAccounts = accounts.filter((a) => a.provider === provider && a.status === "connected");
  // One secret goes to the backend whatever shape the provider's credentials come in.
  const secret =
    meta.credential === "aws"
      ? awsId.trim() && awsSecret.trim()
        ? JSON.stringify({ access_key_id: awsId.trim(), secret_access_key: awsSecret.trim() })
        : ""
      : apiKey.trim();
  const sentOptions = useMemo(() => {
    const filled = Object.entries(options).filter(([, v]) => v.trim().length > 0);
    return filled.length ? Object.fromEntries(filled.map(([k, v]) => [k, v.trim()])) : undefined;
  }, [options]);
  const optionsReady = (meta.options ?? []).every((o) => !o.required || (options[o.key] ?? "").trim().length > 0);
  const canFetch = isAccount
    ? Boolean(accountId)
    : (!meta.needsKey || secret.length > 0) && (!meta.needsBaseUrl || effectiveBaseUrl.length > 0) && optionsReady;
  const modelId = picked?.id ?? manualId.trim();

  useEffect(() => {
    listAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  function selectProvider(p: Provider) {
    setProvider(p);
    setFetchState({ status: "idle" });
    setPicked(null);
    setManualId("");
    setQuery("");
    setError(null);
    setConnecting(false);
    setUseAccount(false);
    setAwsId("");
    setAwsSecret("");
    setOptions({});
    const next = providerMeta(p);
    if (next.account) {
      const first = accounts.find((a) => a.provider === p && a.status === "connected");
      setAccountId(first?.id ?? "");
      if (first) void fetchModels(p, first.id);
      else setConnecting(true);
    } else if (!next.needsKey) {
      void fetchModels(p);
    }
  }

  async function fetchModels(p: Provider = provider, account: string = accountId, viaAccount: boolean = isAccount) {
    const m = providerMeta(p);
    const signIn = Boolean(m.account || viaAccount);
    setFetchState({ status: "loading" });
    setPicked(null);
    try {
      const found = await discoverModels({
        provider: p,
        apiKey: signIn ? undefined : secret || undefined,
        baseUrl: signIn ? undefined : (p === provider ? baseUrl : "") || m.defaultBaseUrl || undefined,
        accountId: signIn ? account : undefined,
        options: p === provider ? sentOptions : undefined,
      });
      setFetchState({ status: "done", models: found });
    } catch (err) {
      setFetchState({ status: "error", message: err instanceof Error ? err.message : t("صار خطأ") });
    }
  }

  const filtered = useMemo(() => {
    if (fetchState.status !== "done") return [];
    const q = query.trim().toLowerCase();
    return q
      ? fetchState.models.filter((m) => m.id.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q))
      : fetchState.models;
  }, [fetchState, query]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modelId) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createModel({
        name: name.trim() || picked?.display_name || modelId,
        provider,
        modelId,
        baseUrl: showBaseUrl ? effectiveBaseUrl : undefined,
        apiKey: isAccount ? undefined : secret || undefined,
        accountId: isAccount ? accountId : undefined,
        options: sentOptions,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("صار خطأ غير متوقع"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 flex flex-col gap-5 rounded-xl border p-5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
          {t("المزوّد")}
        </span>
        <div className="flex flex-col gap-3">
          {(Object.keys(GROUP_LABEL) as ProviderGroup[]).map((group) => {
            const inGroup = PROVIDERS.filter(
              (p) =>
                p.group === group &&
                // Experimental integrations appear only once an account for them is connected.
                (!p.experimental || accounts.some((a) => a.provider === p.value && a.status === "connected")),
            );
            if (!inGroup.length) return null;
            return (
              <div key={group} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium opacity-70" style={{ color: "var(--color-ink-muted)" }}>
                  {GROUP_LABEL[group]}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {inGroup.map((p) => {
                    const active = p.value === provider;
                    return (
                      <motion.button
                        type="button"
                        key={p.value}
                        onClick={() => selectProvider(p.value)}
                        whileTap={{ scale: 0.95 }}
                        className="relative rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          borderColor: active ? "transparent" : "var(--color-border)",
                          color: active ? "var(--color-accent-ink)" : "var(--color-ink)",
                        }}
                      >
                        {active && (
                          <motion.span
                            layoutId="provider-pill"
                            className="absolute inset-0 rounded-full"
                            style={{ background: "var(--color-accent)" }}
                            transition={snappy}
                          />
                        )}
                        <span className="relative flex items-center gap-1.5">
                          <BrandMark provider={p.value} className="h-3.5 w-3.5" />
                          {p.label}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {meta.hint && (
          <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {meta.hint}
          </p>
        )}
      </div>

      {meta.accountOptional && (
        <div className="flex gap-1.5" role="radiogroup" aria-label={t("طريقة الدخول")}>
          {[
            { value: false, label: t("مفتاح API") },
            { value: true, label: t("حساب {0}", { 0: meta.label }) },
          ].map((option) => (
            <button
              type="button"
              key={String(option.value)}
              role="radio"
              aria-checked={useAccount === option.value}
              onClick={() => {
                setUseAccount(option.value);
                setFetchState({ status: "idle" });
                setPicked(null);
                if (option.value) {
                  const first = accounts.find((a) => a.provider === provider && a.status === "connected");
                  setAccountId(first?.id ?? "");
                  if (first) void fetchModels(provider, first.id, true);
                  else setConnecting(true);
                } else {
                  setConnecting(false);
                }
              }}
              className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderColor: useAccount === option.value ? "var(--color-accent)" : "var(--color-border)",
                background:
                  useAccount === option.value ? "color-mix(in oklch, var(--color-accent) 12%, transparent)" : "transparent",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {isAccount && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
              {t("الحساب")}
            </span>
            {!connecting && !meta.experimental && (
              <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConnecting(true)}>
                <PlusIcon className="h-3.5 w-3.5" />
                {t("اربط حساب")}
              </Button>
            )}
          </div>
          {providerAccounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {providerAccounts.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => {
                    setAccountId(a.id);
                    void fetchModels(provider, a.id, true);
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    borderColor: a.id === accountId ? "var(--color-accent)" : "var(--color-border)",
                    background:
                      a.id === accountId ? "color-mix(in oklch, var(--color-accent) 12%, transparent)" : "transparent",
                  }}
                >
                  <bdi dir="ltr">{accountLabel(a.provider, a.label)}</bdi>
                </button>
              ))}
            </div>
          )}
          <Reveal open={connecting}>
            {connecting && (
              <ConnectAccount
                provider={provider}
                providerName={provider === "github_copilot" ? "GitHub" : meta.label}
                onCancel={() => setConnecting(false)}
                onConnected={(account) => {
                  setConnecting(false);
                  setAccounts((prev) => [...prev.filter((a) => a.id !== account.id), account]);
                  setAccountId(account.id);
                  void fetchModels(provider, account.id, true);
                }}
              />
            )}
          </Reveal>
        </div>
      )}

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: meta.needsKey && showBaseUrl && meta.credential !== "json" ? "1fr 1fr" : "1fr" }}
      >
        {showBaseUrl && (
          <Field label={meta.baseUrlLabel ?? "Base URL"}>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => canFetch && fetchState.status === "idle" && fetchModels()}
              placeholder={meta.defaultBaseUrl}
              className="input font-mono"
              dir="ltr"
            />
          </Field>
        )}
        {meta.needsKey && !isAccount && meta.credential === "aws" && (
          <>
            <Field label={t("معرّف مفتاح الوصول")}>
              <input
                value={awsId}
                onChange={(e) => {
                  setAwsId(e.target.value);
                  if (fetchState.status !== "idle") setFetchState({ status: "idle" });
                }}
                placeholder="AKIA…"
                className="input font-mono"
                dir="ltr"
                autoComplete="off"
              />
            </Field>
            <Field label={t("المفتاح السرّي")} hint={t("بيتخزّن مشفّر بخزنة ويندوز، وما رح يظهر مرة ثانية.")}>
              <input
                value={awsSecret}
                onChange={(e) => {
                  setAwsSecret(e.target.value);
                  if (fetchState.status !== "idle") setFetchState({ status: "idle" });
                }}
                onBlur={() => canFetch && fetchState.status === "idle" && fetchModels()}
                type="password"
                className="input font-mono"
                dir="ltr"
                autoComplete="off"
              />
            </Field>
          </>
        )}
        {meta.needsKey && !isAccount && meta.credential === "json" && (
          <Field label={t("ملف حساب الخدمة (JSON)")} hint={t("بيتخزّن مشفّر بخزنة ويندوز، وما رح يظهر مرة ثانية.")}>
            <textarea
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (fetchState.status !== "idle") setFetchState({ status: "idle" });
              }}
              onBlur={() => canFetch && fetchState.status === "idle" && fetchModels()}
              rows={4}
              placeholder={'{ "type": "service_account", … }'}
              className="input resize-y font-mono text-xs"
              dir="ltr"
              spellCheck={false}
            />
          </Field>
        )}
        {meta.needsKey && !isAccount && !meta.credential && (
          <Field label={t("مفتاح API")} hint={t("بيتخزّن مشفّر بخزنة ويندوز، وما رح يظهر مرة ثانية.")}>
            <input
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (fetchState.status !== "idle") setFetchState({ status: "idle" });
              }}
              onBlur={() => canFetch && fetchState.status === "idle" && fetchModels()}
              type="password"
              placeholder={meta.keyPlaceholder ?? "…"}
              className="input font-mono"
              dir="ltr"
              autoComplete="off"
            />
          </Field>
        )}
      </div>

      {meta.options && !isAccount && (
        <div className="grid gap-4" style={{ gridTemplateColumns: meta.options.length > 1 ? "1fr 1fr" : "1fr" }}>
          {meta.options.map((option) => (
            <Field key={option.key} label={option.label}>
              <input
                value={options[option.key] ?? ""}
                onChange={(e) => setOptions((prev) => ({ ...prev, [option.key]: e.target.value }))}
                onBlur={() => canFetch && fetchState.status === "idle" && fetchModels()}
                placeholder={option.placeholder}
                className="input font-mono"
                dir="ltr"
                autoComplete="off"
              />
            </Field>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("الموديل")}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="px-2 py-1 text-xs"
            disabled={!canFetch || fetchState.status === "loading"}
            onClick={() => fetchModels()}
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            {fetchState.status === "done" ? t("تحديث القائمة") : t("جلب الموديلات")}
          </Button>
        </div>

        <ModelChooser
          state={fetchState}
          filtered={filtered}
          query={query}
          onQuery={setQuery}
          picked={picked}
          onPick={(m) => {
            setPicked(m);
            setName(m.display_name);
          }}
          canFetch={canFetch}
          needsKey={meta.needsKey}
          needsAccount={isAccount}
          manualId={manualId}
          onManualId={setManualId}
        />
      </div>

      <Reveal open={Boolean(modelId)}>
        <Field label={t("اسم يظهرلك بالتطبيق")}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={modelId} className="input" />
        </Field>
      </Reveal>

      <ErrorText message={error} />

      <div className="flex items-center justify-start gap-2">
        <Button type="submit" disabled={saving || !modelId}>
          {saving ? (
            <>
              <SpinnerIcon className="h-4 w-4" />
              {t("جارِ التحقق إنه شغّال…")}
            </>
          ) : (
            t("تحقق واحفظ")
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("إلغاء")}
        </Button>
        {saving && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("بنبعت رسالة تجريبية للموديل")}
          </motion.span>
        )}
      </div>
    </form>
  );
}

function ModelChooser({
  state,
  filtered,
  query,
  onQuery,
  picked,
  onPick,
  canFetch,
  needsKey,
  needsAccount,
  manualId,
  onManualId,
}: {
  state: FetchState;
  filtered: DiscoveredModel[];
  query: string;
  onQuery: (q: string) => void;
  picked: DiscoveredModel | null;
  onPick: (m: DiscoveredModel) => void;
  canFetch: boolean;
  needsKey: boolean;
  needsAccount?: boolean;
  manualId: string;
  onManualId: (v: string) => void;
}) {
  const box = "rounded-lg border";
  const boxStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" };

  if (state.status === "idle") {
    return (
      <div className={`${box} px-4 py-6 text-center text-xs`} style={{ ...boxStyle, color: "var(--color-ink-muted)" }}>
        {canFetch
          ? t("اضغط «جلب الموديلات» لنجيب القائمة من المزوّد.")
          : needsAccount
            ? t("اربط حساب أول، وبنجيب الموديلات اللي حسابك بيقدر يستعملها.")
            : needsKey
              ? t("حط مفتاح الـ API أول، وبنجيب الموديلات المتاحة إلك.")
              : t("حدد الـ Base URL.")}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className={`${box} flex flex-col gap-1.5 p-2`} style={boxStyle}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-9 rounded-md" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <ErrorText message={state.message} />
        <input
          value={manualId}
          onChange={(e) => onManualId(e.target.value)}
          placeholder={t("أو اكتب معرّف الموديل يدوياً")}
          className="input font-mono"
          dir="ltr"
        />
      </div>
    );
  }

  if (state.models.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("المزوّد ما رجّع أي موديل. اكتب المعرّف يدوياً:")}
        </p>
        <input value={manualId} onChange={(e) => onManualId(e.target.value)} className="input font-mono" dir="ltr" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOutExpo } }}
      className={`${box} overflow-hidden`}
      style={boxStyle}
    >
      <div className="flex items-center gap-2 border-b px-3" style={{ borderColor: "var(--color-border)" }}>
        <SearchIcon className="h-4 w-4 shrink-0" style={{ color: "var(--color-ink-muted)" }} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("ابحث بين {0} موديل…", { 0: state.models.length })}
          className="w-full bg-transparent py-2.5 text-sm outline-none"
          style={{ color: "var(--color-ink)" }}
          dir={fieldDir(query)}
        />
      </div>
      <motion.ul
        variants={listContainer}
        initial="hidden"
        animate="show"
        className="max-h-64 overflow-y-auto p-1.5"
        role="listbox"
      >
        {filtered.slice(0, 120).map((m) => {
          const active = picked?.id === m.id;
          return (
            <motion.li key={m.id} variants={listItem} layout="position">
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onPick(m)}
                className="relative flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-2)]"
              >
                {active && (
                  <motion.span
                    layoutId="model-pick"
                    className="absolute inset-0 rounded-md"
                    style={{ background: "color-mix(in oklch, var(--color-accent) 16%, transparent)", border: "1px solid var(--color-accent)" }}
                    transition={snappy}
                  />
                )}
                <span className="relative min-w-0 text-start">
                  <span className="block truncate text-sm" dir="auto">
                    {m.display_name}
                  </span>
                  {m.display_name !== m.id && (
                    <span className="block truncate font-mono text-xs" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                      {m.id}
                    </span>
                  )}
                </span>
                {active && (
                  <span className="relative" style={{ color: "var(--color-accent)" }}>
                    <DrawnCheck />
                  </span>
                )}
              </button>
            </motion.li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
            {t("ما في نتائج لـ «")}{query}»
          </li>
        )}
      </motion.ul>
    </motion.div>
  );
}
