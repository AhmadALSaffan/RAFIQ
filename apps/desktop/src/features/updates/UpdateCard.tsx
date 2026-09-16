/**
 * Checking for a new version, downloading it and restarting into it.
 *
 * The check is a signed manifest on the project's releases page; Tauri verifies the
 * signature before anything is run, so a tampered download simply fails. Nothing happens
 * without the user pressing the button.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "../../components/ui";
import { DownloadIcon, RefreshIcon, SpinnerIcon } from "../../components/Icons";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";

/** Updating only exists in the installed app — in a browser tab there's nothing to replace. */
async function inApp(): Promise<boolean> {
  const { isTauri } = await import("@tauri-apps/api/core");
  return isTauri();
}

type Found = { version: string; notes: string | null; date: string | null };
type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "found"; update: Found }
  | { status: "downloading"; update: Found; percent: number | null }
  | { status: "ready"; update: Found }
  | { status: "error"; message: string };

export function UpdateCard() {
  const [state, setState] = useState<State>({ status: "idle" });
  // The plugin's handle, kept so downloading uses the update we already checked.
  const [handle, setHandle] = useState<{ downloadAndInstall: (cb: (e: unknown) => void) => Promise<void> } | null>(
    null,
  );

  const [desktop, setDesktop] = useState(false);

  const check = useCallback(async (quiet = false) => {
    if (!(await inApp())) return;
    setState(quiet ? { status: "idle" } : { status: "checking" });
    try {
      const { check: checkForUpdate } = await import("@tauri-apps/plugin-updater");
      const found = await checkForUpdate();
      if (!found) {
        setState(quiet ? { status: "idle" } : { status: "current" });
        return;
      }
      setHandle(found as never);
      setState({ status: "found", update: { version: found.version, notes: found.body ?? null, date: found.date ?? null } });
    } catch (err) {
      // Offline, or no manifest published yet — not worth shouting about on a silent check.
      if (quiet) setState({ status: "idle" });
      else setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void inApp().then((yes) => {
      setDesktop(yes);
      if (yes) void check(true);
    });
  }, [check]);

  async function install() {
    if (state.status !== "found" || !handle) return;
    const update = state.update;
    setState({ status: "downloading", update, percent: null });
    try {
      let total = 0;
      let got = 0;
      await handle.downloadAndInstall((event) => {
        const e = event as { event: string; data?: { contentLength?: number; chunkLength?: number } };
        if (e.event === "Started") total = e.data?.contentLength ?? 0;
        if (e.event === "Progress") {
          got += e.data?.chunkLength ?? 0;
          setState({ status: "downloading", update, percent: total ? Math.round((got / total) * 100) : null });
        }
        if (e.event === "Finished") setState({ status: "ready", update });
      });
      setState({ status: "ready", update });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function restart() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }

  if (!desktop) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{t("التحديثات")}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={state.status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: easeOutExpo }}
            className="mt-0.5 text-xs"
            style={{ color: state.status === "error" ? "var(--color-danger)" : "var(--color-ink-muted)" }}
          >
            {state.status === "idle" && t("شوف إذا في نسخة أجدد.")}
            {state.status === "checking" && t("عم بشوف…")}
            {state.status === "current" && t("عندك آخر نسخة.")}
            {state.status === "found" && t("في نسخة {0} جاهزة.", { 0: state.update.version })}
            {state.status === "downloading" &&
              (state.percent === null ? t("عم بنزّل…") : t("عم بنزّل… {0}%", { 0: String(state.percent) }))}
            {state.status === "ready" && t("انثبّتت — بدها إعادة تشغيل.")}
            {state.status === "error" && state.message}
          </motion.p>
        </AnimatePresence>
      </div>

      {state.status === "found" && (
        <Button onClick={install}>
          <DownloadIcon className="h-4 w-4" />
          {t("نزّل وثبّت")}
        </Button>
      )}
      {state.status === "downloading" && (
        <Button disabled>
          <SpinnerIcon className="h-4 w-4" />
          {t("عم بنزّل…")}
        </Button>
      )}
      {state.status === "ready" && <Button onClick={restart}>{t("أعد التشغيل")}</Button>}
      {(state.status === "idle" || state.status === "current" || state.status === "error") && (
        <Button variant="ghost" onClick={() => check()}>
          <RefreshIcon className="h-4 w-4" />
          {t("افحص")}
        </Button>
      )}
      {state.status === "checking" && (
        <Button variant="ghost" disabled>
          <SpinnerIcon className="h-4 w-4" />
          {t("افحص")}
        </Button>
      )}
    </div>
  );
}
