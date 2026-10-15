/**
 * Checking for a new version, reading what's in it, downloading it and restarting into it.
 *
 * Two channels: «stable» offers releases only; «beta» offers beta builds too (and every
 * stable release, so a beta user never falls behind). The choice is saved with the app's
 * settings. The check reads a signed manifest; Tauri verifies the signature before anything
 * runs, so a tampered download simply fails. Nothing installs without the user pressing
 * the button, and the release notes are there to read first.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "../../components/ui";
import { DownloadIcon, RefreshIcon, SpinnerIcon } from "../../components/Icons";
import { Markdown } from "../../components/Markdown";
import { getSettings, updateSettings } from "../../lib/api";
import { easeOutExpo } from "../../lib/motion";
import { t } from "../../i18n";

type Channel = "stable" | "beta";
type Found = { version: string; notes: string | null; date: string | null };
type Progress = { event: "Started"; data: { total: number | null } } | { event: "Chunk"; data: { length: number } } | { event: "Finished" };
type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "found"; update: Found }
  | { status: "downloading"; update: Found; percent: number | null }
  | { status: "ready"; update: Found }
  | { status: "error"; message: string };

/** Updating only exists in the installed app — in a browser tab there's nothing to replace. */
async function inApp(): Promise<boolean> {
  const { isTauri } = await import("@tauri-apps/api/core");
  return isTauri();
}

function ChannelChoice({ value, onChange, disabled }: { value: Channel; onChange: (c: Channel) => void; disabled: boolean }) {
  const options: { id: Channel; label: string }[] = [
    { id: "stable", label: t("مستقرة") },
    { id: "beta", label: t("تجريبية (beta)") },
  ];
  return (
    <div role="radiogroup" aria-label={t("قناة التحديث")} className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--color-border)" }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className="rounded-md px-3 py-1 text-xs transition-colors"
            style={{
              background: on ? "var(--color-ink)" : "transparent",
              color: on ? "var(--color-bg)" : "var(--color-ink-muted)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function UpdateCard() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [desktop, setDesktop] = useState(false);
  const [channel, setChannel] = useState<Channel>("stable");
  const [notesOpen, setNotesOpen] = useState(true);

  const check = useCallback(async (on: Channel, quiet = false) => {
    if (!(await inApp())) return;
    setState(quiet ? { status: "idle" } : { status: "checking" });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const found = await invoke<Found | null>("check_update", { channel: on });
      if (!found) {
        setState(quiet ? { status: "idle" } : { status: "current" });
        return;
      }
      setNotesOpen(true);
      setState({ status: "found", update: found });
    } catch (err) {
      // Offline, or no manifest published yet — not worth shouting about on a silent check.
      if (quiet) setState({ status: "idle" });
      else setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void inApp().then(async (yes) => {
      setDesktop(yes);
      if (!yes) return;
      const saved = (await getSettings().catch(() => null))?.update_channel ?? "stable";
      setChannel(saved);
      void check(saved, true);
    });
  }, [check]);

  async function pick(next: Channel) {
    if (next === channel) return;
    setChannel(next);
    const current = await getSettings().catch(() => null);
    if (current) await updateSettings({ ...current, update_channel: next }).catch(() => undefined);
    void check(next);
  }

  async function install() {
    if (state.status !== "found") return;
    const update = state.update;
    setState({ status: "downloading", update, percent: null });
    try {
      const { invoke, Channel: IpcChannel } = await import("@tauri-apps/api/core");
      let total = 0;
      let got = 0;
      const onProgress = new IpcChannel<Progress>();
      onProgress.onmessage = (message) => {
        if (message.event === "Started") total = message.data.total ?? 0;
        if (message.event === "Chunk") {
          got += message.data.length;
          setState({ status: "downloading", update, percent: total ? Math.round((got / total) * 100) : null });
        }
        if (message.event === "Finished") setState({ status: "ready", update });
      };
      await invoke("install_update", { onProgress });
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

  const busy = state.status === "checking" || state.status === "downloading";
  const notes = state.status === "found" || state.status === "downloading" || state.status === "ready" ? state.update.notes : null;

  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: "var(--color-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
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

        <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="ghost" onClick={() => check(channel)}>
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
      </div>

      {/* What's in it, before anything is installed. */}
      {notes && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
          <button
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
            aria-expanded={notesOpen}
            className="text-xs font-medium underline-offset-4 hover:underline"
          >
            {notesOpen ? t("خبّي شو الجديد") : t("شو الجديد بهالنسخة؟")}
          </button>
          {notesOpen && (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg px-3 py-2 text-sm" style={{ background: "var(--color-bg)" }} tabIndex={0} role="region" aria-label={t("ملاحظات الإصدار")}>
              <Markdown text={notes} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {channel === "beta"
            ? t("بتوصلك النسخ التجريبية أول بأول، وفيها ميزات جديدة قبل الكل — وممكن يكون فيها غلطات.")
            : t("بتوصلك بس النسخ اللي جرّبناها كفاية.")}
        </p>
        <ChannelChoice value={channel} onChange={(c) => void pick(c)} disabled={busy} />
      </div>
      {channel === "stable" && state.status === "current" && (
        <p className="mt-1 text-xs" style={{ color: "var(--color-ink-muted)" }}>
          {t("إذا كنت على نسخة تجريبية، بتضل عليها لحد ما تطلع نسخة مستقرة أجدد منها.")}
        </p>
      )}
    </div>
  );
}
