/**
 * An account sign-in, inline. Two shapes, both official provider flows:
 * - device (GitHub): a code to type, a button that opens the provider's page;
 * - browser (OpenRouter, PKCE): a button that opens the approval page, which redirects
 *   back to Rafiq by itself.
 * Either way a quiet progress line runs while we wait for the user to approve there.
 *
 * Rafiq never sees a password — the user signs in on the provider's own site. The token
 * goes from the provider straight into the Windows keychain; this component only ever
 * receives the short user code and, at the end, the account's display name.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { pollConnect, startConnect } from "../../lib/api";
import type { AuthAccount, ConnectStart, Provider } from "../../lib/types";
import { openExternal } from "../../lib/links";
import { easeOutExpo } from "../../lib/motion";
import { ActionProgress } from "../../components/Feedback";
import { CopyIcon, ExternalIcon, SpinnerIcon } from "../../components/Icons";
import { Button, DrawnCheck } from "../../components/ui";
import { accountLabel } from "./labels";

import { t } from "../../i18n";
type Phase =
  | { kind: "starting" }
  | { kind: "waiting"; flow: ConnectStart }
  | { kind: "verifying"; flow: ConnectStart }
  | { kind: "done"; account: AuthAccount }
  | { kind: "error"; message: string };

export function ConnectAccount({
  provider,
  providerName,
  target,
  onConnected,
  onCancel,
}: {
  provider: Provider;
  /** Upstream service for adapters that front several (AuthAI). */
  target?: string;
  /** Shown in the instructions, e.g. "GitHub" or "OpenRouter". */
  providerName: string;
  onConnected: (account: AuthAccount) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const done = useRef(onConnected);
  done.current = onConnected;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPhase({ kind: "starting" });

    async function poll(flow: ConnectStart) {
      if (!alive) return;
      try {
        const result = await pollConnect(flow.flow_id);
        if (!alive) return;
        if (result.status === "complete" && result.account) {
          setPhase({ kind: "done", account: result.account });
          timer = setTimeout(() => done.current(result.account!), 900);
          return;
        }
        if (result.status !== "pending") {
          setPhase({ kind: "error", message: result.message ?? t("ما زبط تسجيل الدخول.") });
          return;
        }
      } catch {
        // A dropped request is not a failed sign-in — keep waiting.
      }
      timer = setTimeout(() => void poll(flow), Math.max(2, flow.interval) * 1000);
    }

    startConnect(provider, target)
      .then((flow) => {
        if (!alive) return;
        setPhase({ kind: "waiting", flow });
        timer = setTimeout(() => void poll(flow), Math.max(2, flow.interval) * 1000);
      })
      .catch((err) => alive && setPhase({ kind: "error", message: err instanceof Error ? err.message : t("صار خطأ") }));

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [provider, target, attempt]);

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  function openProvider(flow: ConnectStart) {
    // Device flow: the code is on the clipboard by the time the page opens — paste and approve.
    if (flow.kind === "device") copyCode(flow.user_code);
    void openExternal(flow.verification_uri);
    setPhase({ kind: "verifying", flow });
  }

  const waiting = phase.kind === "waiting" || phase.kind === "verifying" || phase.kind === "starting";

  return (
    <div
      className="relative overflow-hidden rounded-lg border px-4 py-4"
      style={{ borderColor: "var(--color-accent)", background: "color-mix(in oklch, var(--color-accent) 5%, var(--color-surface))" }}
    >
      <ActionProgress active={waiting} />
      <AnimatePresence mode="wait" initial={false}>
        {phase.kind === "starting" && (
          <motion.p
            key="starting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <SpinnerIcon className="h-4 w-4" />
            {t("عم جهّز تسجيل الدخول…")}
          </motion.p>
        )}

        {(phase.kind === "waiting" || phase.kind === "verifying") && (
          <motion.div
            key="code"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: easeOutExpo }}
            className="flex flex-col gap-3"
          >
            <p className="text-sm leading-relaxed">
              {phase.flow.kind === "device"
                ? t("افتح صفحة {0} وحط هالرمز، وبعدين وافق على «Rafiq». رفيق ما بيشوف كلمة السر تبعك أبداً.", { 0: providerName })
                : t("افتح صفحة {0} ووافق على «Rafiq» — بعدها بترجع لرفيق لحالها. رفيق ما بيشوف كلمة السر تبعك أبداً.", { 0: providerName })}
            </p>
            {phase.flow.kind === "device" && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-lg border px-4 py-2 font-mono text-2xl font-semibold tracking-[0.25em]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                dir="ltr"
              >
                {phase.flow.user_code}
              </span>
              <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => copyCode(phase.flow.user_code)}>
                {copied ? <DrawnCheck className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                {copied ? t("انتسخ") : t("انسخ")}
              </Button>
            </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => openProvider(phase.flow)}>
                <ExternalIcon className="h-4 w-4" />
                {phase.flow.kind === "device" ? t("انسخ الرمز وافتح {0}", { 0: providerName }) : t("افتح {0}", { 0: providerName })}
              </Button>
              <Button variant="ghost" onClick={onCancel}>
                {t("إلغاء")}
              </Button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
              {phase.kind === "verifying"
                ? t("بستنى موافقتك على {0}… بس توافق بيتربط الحساب لحاله.", { 0: providerName })
                : phase.flow.kind === "device"
                  ? t("الرمز صالح لربع ساعة.")
                  : t("الموافقة صالحة لعشر دقايق.")}
            </p>
          </motion.div>
        )}

        {phase.kind === "done" && (
          <motion.p
            key="done"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: "var(--color-success)" }}
          >
            <DrawnCheck className="h-5 w-5" />
            <span>
              {t("انربط الحساب")} <bdi dir="ltr">{accountLabel(phase.account.provider, phase.account.label)}</bdi>
            </span>
          </motion.p>
        )}

        {phase.kind === "error" && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3">
            <p className="text-sm" style={{ color: "var(--color-danger)" }}>
              {phase.message}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setAttempt((n) => n + 1)}>{t("جرّب من جديد")}</Button>
              <Button variant="ghost" onClick={onCancel}>
                {t("إلغاء")}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
