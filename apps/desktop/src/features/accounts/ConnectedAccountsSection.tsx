/**
 * Settings → «الحسابات المتصلة»: providers you sign in to with an account (GitHub Copilot
 * today), who is connected, which agents use each account, and connect / disconnect.
 *
 * Disconnecting one account only affects the agents bound to it — they stop and ask to
 * reconnect; no agent silently switches to another login or key.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { disconnectAccount, listAccountProviders, listAccounts } from "../../lib/api";
import { PROVIDERS } from "../../lib/providers";
import type { AccountProvider, AuthAccount, Provider } from "../../lib/types";
import { listContainer, listItem } from "../../lib/motion";
import { timeAgo } from "../../lib/time";
import { BrandMark } from "../../components/BrandMark";
import { StatusStripe } from "../../components/Page";
import { PlusIcon, TrashIcon } from "../../components/Icons";
import { Button, Reveal } from "../../components/ui";
import { ConnectAccount } from "./ConnectAccount";
import { accountLabel } from "./labels";
import { AuthAICard } from "./AuthAICard";

import { t } from "../../i18n";
// AuthAI fronts several services; the user picks which account to sign in with.
const AUTHAI_TARGETS = [
  { id: "openai", label: "ChatGPT" },
  { id: "xai", label: "Grok" },
  { id: "github", label: "GitHub Copilot" },
];

export function ConnectedAccountsSection() {
  const [providers, setProviders] = useState<AccountProvider[]>([]);
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([listAccountProviders(), listAccounts()]);
      setProviders(p);
      setAccounts(a);
    } catch {
      // The section stays usable; the next action reloads.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const keyProviders = PROVIDERS.filter((p) => !p.account && !p.accountOptional && p.needsKey).map((p) => p.label);

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium">{t("الحسابات المتصلة")}</h2>
      <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
        {t("مزوّدين بتسجّل عندهم دخول بحسابك بدل المفتاح. التوكن بينحفظ بخزنة ويندوز — مش بقاعدة البيانات — وكل نموذج بيستعمل الحساب اللي اخترته إله بس.")}
      </p>

      {loading ? (
        <div className="shimmer h-16 rounded-lg" />
      ) : (
        <motion.div variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-2">
          {providers
            // An experimental adapter only shows once the user has switched it on below.
            .filter((provider) => !provider.experimental || provider.available)
            .map((provider) => {
            const mine = accounts.filter((a) => a.provider === provider.id);
            const connected = mine.filter((a) => a.status === "connected").length;
            return (
              <motion.div
                key={provider.id}
                variants={listItem}
                className="relative overflow-hidden rounded-lg border px-4 py-3"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <StatusStripe color={connected ? "var(--color-success)" : "var(--color-border)"} />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <BrandMark provider={provider.id} className="h-5 w-5 shrink-0" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {provider.name}
                        <MethodChip
                          label={provider.method === "experimental" ? t("عبر relay خارجي") : t("تسجيل دخول بالحساب (OAuth)")}
                        />
                        {provider.experimental && <MethodChip label={t("تجريبي")} tone="pending" />}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                        {!provider.available
                          ? provider.unavailable_reason
                          : connected
                            ? t(connected === 1 ? "{0} حساب متصل" : "{0} حسابات متصلة", { 0: connected })
                            : t("ما في حساب متصل")}
                      </p>
                    </div>
                  </div>
                  {connecting !== provider.id && (
                    <Button
                      variant="ghost"
                      className="shrink-0 px-2.5 py-1.5 text-xs"
                      disabled={!provider.available}
                      onClick={() => {
                        setTarget(null);
                        setConnecting(provider.id);
                      }}
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      {mine.length ? t("اربط حساب تاني") : t("اربط حساب")}
                    </Button>
                  )}
                </div>

                <Reveal open={connecting === provider.id}>
                  {connecting === provider.id && provider.id === "authai" && !target && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span style={{ color: "var(--color-ink-muted)" }}>{t("سجّل دخول بـ:")}</span>
                      {AUTHAI_TARGETS.map((t) => (
                        <Button key={t.id} variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setTarget(t.id)}>
                          {t.label}
                        </Button>
                      ))}
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConnecting(null)}>
                        {t("إلغاء")}
                      </Button>
                    </div>
                  )}
                  {connecting === provider.id && (provider.id !== "authai" || target) && (
                    <div className="mt-3">
                      <ConnectAccount
                        provider={provider.id}
                        target={provider.id === "authai" ? (target ?? undefined) : undefined}
                        providerName={
                          provider.id === "github_copilot"
                            ? "GitHub"
                            : provider.id === "authai"
                              ? (AUTHAI_TARGETS.find((t) => t.id === target)?.label ?? provider.name)
                              : provider.name
                        }
                        onCancel={() => {
                          setConnecting(null);
                          setTarget(null);
                        }}
                        onConnected={() => {
                          setConnecting(null);
                          setTarget(null);
                          void reload();
                        }}
                      />
                    </div>
                  )}
                </Reveal>

                <AnimatePresence initial={false}>
                  {mine.length > 0 && (
                    <motion.ul
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 flex flex-col divide-y overflow-hidden rounded-md border"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {mine.map((account) => (
                        <AccountLine
                          key={account.id}
                          account={account}
                          onReconnect={() => {
                            setTarget(null);
                            setConnecting(provider.id);
                          }}
                          onDisconnected={() => void reload()}
                        />
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          <AuthAICard onChanged={() => void reload()} />

          <div
            className="flex items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-xs leading-relaxed"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-muted)" }}
          >
            <MethodChip label={t("مفتاح API")} />
            <span>
              {keyProviders.join(t("، "))} {t("— بتشتغل بمفتاح بتحطه من صفحة النماذج. تسجيل الدخول بالحساب بينضاف بس للمزوّد اللي بيسمح فيه رسمياً للتطبيقات التانية.")}
            </span>
          </div>
        </motion.div>
      )}
    </section>
  );
}

function AccountLine({
  account,
  onReconnect,
  onDisconnected,
}: {
  account: AuthAccount;
  onReconnect: () => void;
  onDisconnected: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const connected = account.status === "connected";

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectAccount(account.id);
      onDisconnected();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2.5"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      onMouseLeave={() => setConfirming(false)}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm">
          <bdi dir="ltr" className="font-medium">
            {accountLabel(account.provider, account.label)}
          </bdi>
          <span
            className="flex items-center gap-1 text-xs"
            style={{ color: connected ? "var(--color-success)" : "var(--color-danger)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            {connected ? t("متصل") : t("مفصول")}
          </span>
        </p>
        <p className="mt-0.5 truncate text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {account.used_by.length ? t("بيستعمله: {0}", { 0: account.used_by.join(t("، ")) }) : t("ما في نموذج بيستعمله لسا")}
          {account.verified_at && t(" · انربط {0}", { 0: timeAgo(account.verified_at) })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!connected && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onReconnect}>
            {t("أعد الربط")}
          </Button>
        )}
        {connected &&
          (confirming ? (
            <>
              <Button variant="danger" className="px-2.5 py-1 text-xs" disabled={busy} onClick={() => void disconnect()}>
                {t("افصل")}
              </Button>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirming(false)}>
                {t("لا")}
              </Button>
            </>
          ) : (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setConfirming(true)}
              aria-label={t("افصل الحساب")}
              title={
                account.used_by.length
                  ? t("رح يوقف {0} لحتى تربطه من جديد", { 0: account.used_by.join(t("، ")) })
                  : t("افصل الحساب")
              }
              className="rounded-md p-1.5 transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </motion.button>
          ))}
      </div>
    </li>
  );
}

function MethodChip({ label, tone }: { label: string; tone?: "pending" }) {
  const color = tone === "pending" ? "var(--color-pending)" : "var(--color-ink-muted)";
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal"
      style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)`, color }}
    >
      {label}
    </span>
  );
}
