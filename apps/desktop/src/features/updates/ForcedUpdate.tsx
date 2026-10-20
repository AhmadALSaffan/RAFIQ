/**
 * A new version is not optional: when one is out, this covers the app until it's installed.
 *
 * It checks on launch and every half hour, on the channel the user picked (Settings → About).
 * When it finds a version it shows what's new, downloads it with progress, and restarts into
 * it. There's no close button and Escape does nothing; if the download fails, the user can
 * retry or download the installer from the release page — the app stays covered either way.
 * Tauri checks the build's signature before anything runs, so only a genuine Rafiq installs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "../../components/ui";
import { RainbowButton } from "../../components/easy/rainbow-button";
import { DownloadIcon, ExternalIcon, RefreshIcon, SpinnerIcon } from "../../components/Icons";
import { Markdown } from "../../components/Markdown";
import { Logo } from "../../components/Logo";
import { getSettings } from "../../lib/api";
import { openExternal } from "../../lib/links";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";

type Found = { version: string; notes: string | null; date: string | null };
type Progress = { event: "Started"; data: { total: number | null } } | { event: "Chunk"; data: { length: number } } | { event: "Finished" };
type Stage =
  | { kind: "found" }
  | { kind: "downloading"; percent: number | null }
  | { kind: "restarting" }
  | { kind: "failed"; message: string };

const EVERY = 30 * 60_000;
const RELEASES = "https://github.com/AhmadALSaffan/RAFIQ/releases/latest";

async function inApp(): Promise<boolean> {
  const { isTauri } = await import("@tauri-apps/api/core");
  return isTauri();
}

export function ForcedUpdate() {
  const [update, setUpdate] = useState<Found | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "found" });
  const installing = useRef(false);

  const check = useCallback(async () => {
    // The quick-ask window is the same app in a small frame; the main window handles updates.
    if (installing.current || window.location.hash.startsWith("#/quick") || !(await inApp())) return;
    try {
      const channel = (await getSettings().catch(() => null))?.update_channel ?? "stable";
      const { invoke } = await import("@tauri-apps/api/core");
      const found = await invoke<Found | null>("check_update", { channel });
      if (found) {
        setUpdate(found);
        setStage({ kind: "found" });
      }
    } catch {
      // Offline, or nothing published: try again on the next round.
    }
  }, []);

  useEffect(() => {
    // Dev builds only: «?update-preview» shows the dialog with sample notes, to see it in a browser.
    if (import.meta.env.DEV && window.location.hash.includes("update-preview")) {
      setUpdate({ version: "0.4.29", notes: ["## ✨ New", "", "- Stronger Jira and GitHub integrations", "- The model starts tasks with your approval"].join("\n"), date: null });
      return;
    }
    const first = window.setTimeout(() => void check(), 3000);
    const id = window.setInterval(() => void check(), EVERY);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [check]);

  // Nothing behind the dialog takes the keyboard while it's up.
  useEffect(() => {
    if (!update) return;
    const block = (e: KeyboardEvent) => {
      if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && ["k", "n", "w"].includes(e.key.toLowerCase()))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [update]);

  async function install() {
    if (!update || installing.current) return;
    installing.current = true;
    setStage({ kind: "downloading", percent: null });
    try {
      const { invoke, Channel } = await import("@tauri-apps/api/core");
      let total = 0;
      let got = 0;
      const onProgress = new Channel<Progress>();
      onProgress.onmessage = (message) => {
        if (message.event === "Started") total = message.data.total ?? 0;
        if (message.event === "Chunk") {
          got += message.data.length;
          setStage({ kind: "downloading", percent: total ? Math.min(100, Math.round((got / total) * 100)) : null });
        }
      };
      // The check that found it is the one installed; a fresh check makes sure it's still there.
      const channel = (await getSettings().catch(() => null))?.update_channel ?? "stable";
      await invoke("check_update", { channel });
      await invoke("install_update", { onProgress });
      setStage({ kind: "restarting" });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      installing.current = false;
      setStage({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <AnimatePresence>
      {update && (
        <motion.div
          key="forced-update"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] flex items-center justify-center p-6"
          style={{ background: "color-mix(in oklch, var(--color-bg) 70%, transparent)", backdropFilter: "blur(10px)" }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="forced-update-title"
          aria-describedby="forced-update-body"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, ease: easeOutExpo }}
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl shadow-2xl"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center gap-3 px-6 pb-3 pt-6">
              <Logo className="h-10 w-10" />
              <div className="min-w-0">
                <h2 id="forced-update-title" className="text-xl font-extrabold">
                  {t("في نسخة جديدة من رفيق")}
                </h2>
                <p id="forced-update-body" className="text-sm" style={{ color: "var(--color-ink-muted)" }}>
                  {t("لازم تثبّت النسخة {0} لتكمّل — بتاخد دقيقة.", { 0: update.version })}
                </p>
              </div>
            </div>

            {update.notes && (
              <div className="mx-6 mb-4 min-h-0 flex-1 overflow-y-auto rounded-2xl px-4 py-3 text-sm" style={{ background: "var(--color-bg)" }} tabIndex={0} role="region" aria-label={t("شو الجديد")}>
                <Markdown text={update.notes} />
              </div>
            )}

            <div className="border-t px-6 py-4" style={{ borderColor: "var(--color-border)" }}>
              {stage.kind === "downloading" && (
                <div className="mb-3">
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "var(--color-accent)" }}
                      animate={stage.percent === null ? { x: ["-100%", "100%"] } : { width: `${stage.percent}%` }}
                      transition={stage.percent === null ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
                      initial={false}
                    />
                  </div>
                  <p className="mt-1.5 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    {stage.percent === null ? t("عم بنزّل…") : t("عم بنزّل… {0}%", { 0: String(stage.percent) })}
                  </p>
                </div>
              )}
              {stage.kind === "failed" && (
                <p className="mb-3 text-xs" style={{ color: "var(--color-danger)" }}>
                  {t("ما زبط التنزيل: {0}", { 0: stage.message })}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {stage.kind === "found" && (
                  <RainbowButton onClick={() => void install()}>
                    <DownloadIcon className="h-4 w-4" />
                    {t("نزّل وثبّت هلّق")}
                  </RainbowButton>
                )}
                {stage.kind === "downloading" && (
                  <Button disabled>
                    <SpinnerIcon className="h-4 w-4" />
                    {t("عم بنزّل…")}
                  </Button>
                )}
                {stage.kind === "restarting" && (
                  <Button disabled>
                    <SpinnerIcon className="h-4 w-4" />
                    {t("عم يعيد التشغيل…")}
                  </Button>
                )}
                {stage.kind === "failed" && (
                  <>
                    <Button onClick={() => void install()}>
                      <RefreshIcon className="h-4 w-4" />
                      {t("جرّب مرة تانية")}
                    </Button>
                    <Button variant="ghost" onClick={() => void openExternal(RELEASES)}>
                      <ExternalIcon className="h-4 w-4" />
                      {t("نزّلها من صفحة الإصدار")}
                    </Button>
                  </>
                )}
              </div>
              <p className="mt-3 text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {t("التاسكات الشغّالة رح توقف مع إعادة التشغيل، وفيك تكمّلها من وين وقفت.")}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
