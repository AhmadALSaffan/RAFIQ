/**
 * The export window: format, resolution, frame rate, codec, quality — each option checked
 * against what this machine's encoder says it can do. Shows progress and time left, can be
 * cancelled, and at the end says what the file really is (read back by the agent).
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { t } from "../../i18n";
import { easeOutExpo, snappy } from "../../lib/motion";
import { ffmpegStatus, installFfmpeg, motionRenderUrl, type FfmpegStatus } from "../../lib/api";
import { revealPath } from "../../lib/folders";
import { BigNumber, BracketLabel, LedBar } from "../../components/brand";
import { Button } from "../../components/ui";
import { AlertIcon, XIcon } from "../../components/Icons";
import { capabilities, outputSize, type ExportSettings, type ExportSize } from "./engine/export";
import type { Issue } from "./engine/lint";
import type { Scene } from "./engine/types";
import { dismissExport, runExport, runLottieExport, useExports } from "./exports";
import { structuralIssues } from "./engine/lint";
import { formatTime } from "./pieces";

const SIZES: ExportSize[] = ["720p", "1080p", "1440p", "2160p"];

export function ExportPanel({
  projectId,
  scene,
  kit,
  issues,
  onClose,
}: {
  projectId: string;
  scene: Scene;
  kit: import("./engine/types").BrandKit;
  issues: Issue[];
  onClose: () => void;
}) {
  const comp = scene.composition;
  const [settings, setSettings] = useState<ExportSettings>({ format: "mp4", size: "1080p", fps: comp.fps, codec: "h264", quality: "auto", encoder: "auto" });
  const [caps, setCaps] = useState<Record<string, boolean> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const jobs = useExports(projectId);
  const job = jobs[jobs.length - 1];
  const running = !!job && !job.result && !job.error;
  const [url, setUrl] = useState<string | null>(null);
  const [ff, setFf] = useState<FfmpegStatus | null>(null);
  const [mode, setMode] = useState<"mp4" | "lottie">("mp4");
  const [lottieFormat, setLottieFormat] = useState<"lottie" | "dotlottie">("dotlottie");
  const [lottieBusy, setLottieBusy] = useState(false);
  const [lottieResult, setLottieResult] = useState<Awaited<ReturnType<typeof runLottieExport>> | null>(null);
  const [lottieError, setLottieError] = useState<string | null>(null);
  const lottieIssues = structuralIssues(scene, kit.type, kit.spacing, "lottie").filter((i) => i.code === "L001");

  useEffect(() => {
    ffmpegStatus().then(setFf).catch(() => setFf(null));
  }, []);
  // While FFmpeg downloads, follow its progress.
  useEffect(() => {
    if (!ff || !["downloading", "unpacking", "testing"].includes(ff.progress.state)) return;
    const timer = window.setTimeout(() => ffmpegStatus().then(setFf).catch(() => undefined), 800);
    return () => window.clearTimeout(timer);
  }, [ff]);

  useEffect(() => {
    capabilities(comp.width, comp.height).then(setCaps).catch(() => setCaps({}));
  }, [comp.width, comp.height]);

  useEffect(() => {
    if (job?.result?.status === "done") void motionRenderUrl(job.result.id).then(setUrl);
    else setUrl(null);
  }, [job?.result]);

  const supported = (size: ExportSize, fps: number) => !caps || caps[`${size}@${fps}`] !== false;
  const blocking = issues.filter((i) => i.blocking);
  const needsFfmpeg = settings.codec === "h265" || (caps !== null && caps.aac === false) || !supported(settings.size, settings.fps ?? comp.fps);
  const ffBusy = !!ff && ["downloading", "unpacking", "testing"].includes(ff.progress.state);
  const out = outputSize(comp.width, comp.height, settings.size);

  const chip = (on: boolean, off = false) => ({
    borderColor: on ? "var(--color-inverse)" : "var(--color-border)",
    color: on ? "var(--color-on-inverse)" : "var(--color-ink)",
    opacity: off ? 0.4 : 1,
  });

  const group = <T extends string | number>(label: string, items: { id: T; label: string; off?: boolean; hint?: string }[], value: T, set: (v: T) => void, layoutKey: string) => (
    <div className="flex flex-col gap-1.5">
      <BracketLabel>{label}</BracketLabel>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const on = value === item.id;
          return (
            <button key={String(item.id)} disabled={running || item.off} title={item.hint} onClick={() => set(item.id)} className="relative rounded-full border px-3 py-1.5 text-xs" style={chip(on, item.off)}>
              {on && <motion.span layoutId={`export-${layoutKey}`} className="absolute inset-0 rounded-full" style={{ background: "var(--color-inverse)" }} transition={snappy} />}
              <span className="num relative">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,.45)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !running && onClose()}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.25, ease: easeOutExpo }}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col gap-4 rounded-3xl p-6 shadow-2xl"
        style={{ background: "var(--color-surface)" }}
        role="dialog"
        aria-label={t("تصدير")}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold">{t("تصدير")}</h2>
          <button onClick={onClose} disabled={running} aria-label={t("إغلاق")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1.5">
          {(["mp4", "lottie"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} disabled={running || lottieBusy} className="relative rounded-full border px-3 py-1.5 text-xs" style={chip(mode === m)}>
              {mode === m && <motion.span layoutId="export-mode" className="absolute inset-0 rounded-full" style={{ background: "var(--color-inverse)" }} transition={snappy} />}
              <span className="relative">{m === "mp4" ? "MP4" : "Lottie"}</span>
            </button>
          ))}
        </div>
        {mode === "lottie" && (
          <div className="flex flex-col gap-3">
            {group(
              t("الملف"),
              [
                { id: "dotlottie", label: ".lottie" },
                { id: "lottie", label: ".json" },
              ] as { id: "lottie" | "dotlottie"; label: string }[],
              lottieFormat,
              setLottieFormat,
              "lottie-format",
            )}
            <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
              {t("أشكال ونصوص كمسارات (العربي سليم بكل مشغّل). بعد التصدير بيتشغّل الملف وبيتقارن مع الإنجن فريم فريم قبل ما ينحفظ.")}
            </p>
            {lottieIssues.length > 0 && (
              <div className="rounded-xl p-3 text-[11px]" style={{ background: "var(--color-surface-2)" }}>
                <p className="mb-1 font-semibold" style={{ color: "var(--color-danger)" }}>
                  {t("هالطبقات ما رح تكون بالـ Lottie:")}
                </p>
                {lottieIssues.slice(0, 8).map((i, n) => (
                  <p key={n} style={{ color: "var(--color-ink-muted)" }}>
                    {i.layer ? `${i.layer}: ` : ""}
                    {i.message}
                  </p>
                ))}
              </div>
            )}
            {lottieError && (
              <p className="rounded-xl p-3 text-xs" style={{ background: "var(--color-surface-2)", color: "var(--color-danger)" }}>
                {lottieError}
              </p>
            )}
            {lottieResult && (
              <div className="flex flex-col gap-1 text-[11px]">
                <p style={{ color: lottieResult.ok ? "var(--color-success)" : "var(--color-danger)" }} dir="auto">
                  {lottieResult.ok ? "✓ " : "✗ "}
                  {t("مطابق للإنجن (SSIM): {s}", { s: lottieResult.ssim.join(" · ") })}
                </p>
                <p className="truncate font-mono text-[10px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr" title={lottieResult.path}>
                  {lottieResult.path}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              {lottieResult?.ok && (
                <Button variant="ghost" onClick={() => void revealPath(lottieResult.path)}>
                  {t("افتح المجلد")}
                </Button>
              )}
              <Button
                variant="accent"
                disabled={lottieBusy}
                onClick={async () => {
                  setLottieBusy(true);
                  setLottieError(null);
                  setLottieResult(null);
                  try {
                    setLottieResult(await runLottieExport(projectId, scene, kit, lottieFormat));
                  } catch (err) {
                    setLottieError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setLottieBusy(false);
                  }
                }}
              >
                {lottieBusy ? t("عم يصدّر ويقارن…") : t("صدّر Lottie")}
              </Button>
            </div>
          </div>
        )}
        {mode === "mp4" && (
        <>
        {group(
          t("الدقة"),
          SIZES.map((s) => ({ id: s, label: s === "2160p" ? "4K" : s, off: !supported(s, settings.fps ?? comp.fps), hint: !supported(s, settings.fps ?? comp.fps) ? t("كرت الشاشة ما بيدعمها — رح تمرّ على FFmpeg") : undefined })),
          settings.size,
          (size) => setSettings({ ...settings, size }),
          "size",
        )}
        {group(
          "fps",
          [24, 25, 30, 50, 60, 120].map((n) => ({ id: n, label: String(n), off: !supported(settings.size, n === 24 || n === 25 ? 30 : n === 50 ? 60 : n) })),
          settings.fps ?? comp.fps,
          (fps) => setSettings({ ...settings, fps }),
          "fps",
        )}
        {group(
          t("الكوديك"),
          [
            { id: "h264", label: "H.264" },
            { id: "h265", label: "H.265", hint: t("أصغر بنص الحجم، بيمرّ على FFmpeg") },
          ] as { id: ExportSettings["codec"]; label: string; hint?: string }[],
          settings.codec,
          (codec) => setSettings({ ...settings, codec }),
          "codec",
        )}
        {group(
          t("الجودة"),
          [
            { id: "auto", label: t("عادية") },
            { id: "high", label: t("أعلى") },
          ] as { id: NonNullable<ExportSettings["quality"]>; label: string }[],
          settings.quality ?? "auto",
          (quality) => setSettings({ ...settings, quality }),
          "quality",
        )}
        <p className="num text-[11px]" style={{ color: "var(--color-ink-muted)", textAlign: "end" }} dir="ltr">
          {out.width}×{out.height} · {settings.fps ?? comp.fps}fps · {formatTime(comp.duration, false)}
          {caps && caps.aac === false ? ` · ${t("الصوت بيمرّ على FFmpeg")}` : ""}
        </p>

        {needsFfmpeg && ff && !ff.installed && (
          <div className="flex items-center justify-between gap-3 rounded-xl p-3 text-xs" style={{ background: "var(--color-surface-2)" }}>
            <span className="flex-1">
              {ffBusy
                ? ff.progress.state === "downloading"
                  ? t("عم ينزّل FFmpeg… {p}%", { p: Math.round(((ff.progress.done ?? 0) / Math.max(1, ff.progress.total ?? ff.download_size)) * 100) })
                  : t("عم يجرّب FFmpeg على كرت الشاشة…")
                : ff.progress.state === "failed"
                  ? t("ما نزل FFmpeg: {e}", { e: ff.progress.error ?? "" })
                  : t("هالإعداد بيلزمه FFmpeg (نسخة LGPL، {mb} ميجا، بيتحقق منها بالـ SHA-256). بينزل مرة وحدة.", { mb: Math.round(ff.download_size / 1048576) })}
            </span>
            {!ffBusy && (
              <Button
                onClick={async () => {
                  setFf(await installFfmpeg());
                }}
              >
                {t("نزّل FFmpeg")}
              </Button>
            )}
          </div>
        )}
        {needsFfmpeg && ff?.installed && (
          <p className="text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="auto">
            {t("رح يمرّ على FFmpeg ({e})", { e: (settings.codec === "h265" ? ff.hevc : ff.h264) ?? "—" })}
          </p>
        )}

        {blocking.length > 0 && !running && !job?.result && (
          <label className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ background: "var(--color-surface-2)", color: "var(--color-danger)" }}>
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">
              {t("في {n} أخطاء لازم تنتبه إلها (تباين، نص طالع، أو منطقة الواجهة): {codes}", { n: blocking.length, codes: [...new Set(blocking.map((i) => i.code))].join(" ") })}
              <span className="mt-1.5 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                {t("صدّر رغم هيك")}
              </span>
            </span>
          </label>
        )}

        {job && (
          <div>
            {job.progress && !job.result && !job.error && (
              <>
                <div className="flex items-end justify-between gap-3">
                  <BigNumber value={Math.round(job.progress.fraction * 100)} unit="%" size={34} />
                  <p className="text-end text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                    {job.progress.stage === "audio" ? t("عم يمزج الصوت…") : job.progress.stage === "finishing" ? t("عم يكتب الملف…") : job.progress.stage === "checking" ? t("عم يفحص الملف…") : `${job.progress.frame} / ${job.progress.frames}`}
                    {job.progress.eta !== null && job.progress.stage === "video" && (
                      <>
                        <br />
                        <span className="num text-[18px] font-bold" style={{ color: "var(--color-ink)" }}>
                          {formatTime(job.progress.eta, false)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <LedBar value={job.progress.fraction} segments={24} tone="accent" label={t("تصدير")} className="mt-2" />
              </>
            )}
            {job.error && (
              <p className="rounded-xl p-3 text-xs" style={{ background: "var(--color-surface-2)", color: "var(--color-danger)" }}>
                {job.error === "canceled" ? t("انلغى التصدير.") : job.error}
              </p>
            )}
            {job.result?.status === "done" && (
              <div className="flex flex-col gap-2">
                {/* The user's own export: any captions it has are drawn into the picture. */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                {url && <video src={url} controls aria-label={t("الفيديو المصدَّر")} className="max-h-56 w-full rounded-xl" style={{ background: "#000" }} />}
                <p className="num text-[11px]" style={{ color: "var(--color-success)" }} dir="ltr">
                  ✓ {(job.result.report as { video?: { width: number; height: number; frames: number; fps: number } } | null)?.video?.width}×
                  {(job.result.report as { video?: { height: number } } | null)?.video?.height} · {(job.result.report as { video?: { frames: number } } | null)?.video?.frames} frames · {(job.result.report as { video?: { fps: number } } | null)?.video?.fps}fps
                  {(job.result.report as { audio?: unknown } | null)?.audio ? " · audio ✓" : ""}
                </p>
                <p className="truncate font-mono text-[10px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr" title={job.result.path}>
                  {job.result.path}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {job?.result?.status === "done" && (
            <Button variant="ghost" onClick={() => void revealPath(job.result!.path)}>
              {t("افتح المجلد")}
            </Button>
          )}
          {running ? (
            <Button variant="ghost" onClick={() => job.controller.abort()}>
              {t("إلغاء")}
            </Button>
          ) : (
            <Button
              variant="accent"
              disabled={(blocking.length > 0 && !confirmed) || (needsFfmpeg && !ff?.installed)}
              onClick={() => {
                if (job) dismissExport(job.key);
                void runExport(projectId, settings, scene, kit);
              }}
            >
              {job?.result ? t("صدّر كمان مرة") : t("صدّر")}
            </Button>
          )}
        </div>
        </>
        )}
      </motion.div>
    </motion.div>
  );
}
