/** The motion parts wired together with sample data — for the design-system sheet only. */

import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Chip } from "../../components/brand";
import { Button } from "../../components/ui";
import { DeviceFrame, ExportDialog, LintBadge, LintPanel, Timeline, Transport, type ExportSettings, type LintIssue, type MotionTrack } from "./pieces";
import { t } from "../../i18n";

const DURATION = 12;

function sampleTracks(): MotionTrack[] {
  return [
    { id: "title", name: t("العنوان"), kind: "layer", clips: [{ id: "c1", start: 0.5, end: 4.2, label: t("العنوان") }], keyframes: [0, 0.7, 3.1] },
    { id: "price", name: t("السعر"), kind: "layer", clips: [{ id: "c2", start: 2, end: 7.5, label: "$49" }], keyframes: [0, 0.6] },
    { id: "video", name: t("الفيديو"), kind: "video", clips: [{ id: "c3", start: 0, end: 10, label: "shop.mp4" }] },
    {
      id: "audio",
      name: t("الصوت"),
      kind: "audio",
      clips: [{ id: "c4", start: 0, end: DURATION, label: "beat.wav" }],
      beats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      wave: Array.from({ length: 60 }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.7)) * (i % 4 === 0 ? 1 : 0.55)),
    },
  ];
}

export function MotionDemo() {
  const [tracks, setTracks] = useState(sampleTracks);
  const [time, setTime] = useState(4.2);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(60);
  const [selected, setSelected] = useState<string | null>("c1");
  const [lintOpen, setLintOpen] = useState(false);
  const [grid, setGrid] = useState(false);
  const [safe, setSafe] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [settings, setSettings] = useState<ExportSettings>({ format: "mp4-h264", size: "1080p", fps: 60, encoder: "auto" });
  const [progress, setProgress] = useState<number | null>(null);

  const issues: LintIssue[] = [
    { code: "M201", message: t("النص بيطلع برّا المنطقة الآمنة"), time: 2.4, layer: t("السعر"), severity: "error" },
    { code: "M310", message: t("التباين أقل من 4.5:1"), time: 5.1, layer: t("العنوان"), severity: "warning" },
  ];

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setTime((v) => (v + (now - last) / 1000) % DURATION);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    if (progress === null || progress >= 1) return;
    const id = setTimeout(() => setProgress((p) => Math.min(1, (p ?? 0) + 0.04)), 120);
    return () => clearTimeout(id);
  }, [progress]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">
          <span className="font-normal" style={{ color: "var(--color-ink-muted)" }}>
            ( {t("مشروع")} ){" "}
          </span>
          {t("إعلان المتجر")} <span className="num font-normal" style={{ color: "var(--color-ink-muted)" }}>· 9:16 · 30fps</span>
        </p>
        <div className="flex items-center gap-2">
          <LintBadge issues={issues} open={lintOpen} onToggle={() => setLintOpen((v) => !v)} />
          <Button variant="accent" onClick={() => setExporting(true)}>
            {t("تصدير")}
          </Button>
        </div>
        <AnimatePresence>
          {lintOpen && (
            <div className="absolute end-0 top-full z-10 mt-2">
              <LintPanel
                issues={issues}
                onClose={() => setLintOpen(false)}
                onJump={(issue) => {
                  setTime(issue.time);
                  setLintOpen(false);
                }}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl p-4" style={{ background: "var(--color-surface)" }}>
        <DeviceFrame ratio="9:16" safeArea={safe} grid={grid}>
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white">
            <p className="text-2xl font-extrabold" style={{ fontFamily: "var(--font-display)", opacity: time > 0.5 && time < 4.2 ? 1 : 0.2 }}>
              {t("العنوان")}
            </p>
            <p className="num text-4xl font-bold" style={{ color: "var(--color-accent)", opacity: time > 2 && time < 7.5 ? 1 : 0.2 }}>
              $49
            </p>
          </div>
        </DeviceFrame>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Transport playing={playing} time={time} duration={DURATION} fps={30} onPlay={setPlaying} onSeek={setTime} />
          <Chip active={grid} onClick={() => setGrid((v) => !v)}>
            {t("الشبكة")}
          </Chip>
          <Chip active={safe} onClick={() => setSafe((v) => !v)}>
            {t("المنطقة الآمنة")}
          </Chip>
        </div>
      </div>

      <Timeline
        tracks={tracks}
        duration={DURATION}
        time={time}
        onSeek={setTime}
        selected={selected}
        onSelect={setSelected}
        onClipChange={(trackId, clip) => setTracks((all) => all.map((tr) => (tr.id === trackId ? { ...tr, clips: tr.clips.map((c) => (c.id === clip.id ? clip : c)) } : tr)))}
        zoom={zoom}
        onZoom={setZoom}
      />

      <AnimatePresence>
        {exporting && (
          <div className="flex justify-center">
            <ExportDialog
              value={settings}
              onChange={setSettings}
              progress={progress}
              secondsLeft={progress === null ? null : Math.round((1 - progress) * 40)}
              onStart={() => setProgress(0)}
              onCancel={() => setProgress(null)}
              onClose={() => {
                setExporting(false);
                setProgress(null);
              }}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
