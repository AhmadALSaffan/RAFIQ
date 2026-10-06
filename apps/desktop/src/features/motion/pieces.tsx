/**
 * The motion page's parts, built ahead of the engine (docs/REDESIGN.md, R11): a timeline
 * you can drag, trim and zoom; the transport; the check badge and its panel; the device
 * frame; and the export window. They hold no engine state — everything comes in as props,
 * so the engine (docs/MOTION-ENGINE.md) plugs into them as is.
 *
 * Time always runs left to right, whatever the page direction — it's a time axis, not text.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { easeOutExpo, snappy } from "../../lib/motion";
import { BigNumber, BracketLabel, LedBar } from "../../components/brand";
import { Button } from "../../components/ui";
import { AlertIcon, CheckCircleIcon, XIcon } from "../../components/Icons";
import { t } from "../../i18n";

// ── Time ─────────────────────────────────────────────────────────────────────────────────

/** 4.2 → "0:04.20"; long clips get minutes, never hours (they read as minutes anyway). */
export function formatTime(seconds: number, fraction = true): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const head = `${m}:${String(whole).padStart(2, "0")}`;
  return fraction ? `${head}.${String(Math.floor((rest - whole) * 100)).padStart(2, "0")}` : head;
}

/** Ruler ticks that stay about 80px apart whatever the zoom. */
export function rulerStep(pxPerSecond: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((step) => step * pxPerSecond >= 80) ?? 600;
}

/** Keep a clip inside the clip's track and at least `min` long. */
export function clampClip(start: number, end: number, duration: number, min = 0.1): { start: number; end: number } {
  const length = Math.max(min, end - start);
  const s = Math.min(Math.max(0, start), Math.max(0, duration - length));
  return { start: s, end: Math.min(duration, s + length) };
}

const snap = (v: number) => Math.round(v * 20) / 20; // 0.05s

// ── Timeline ─────────────────────────────────────────────────────────────────────────────

export interface MotionClip {
  id: string;
  start: number;
  end: number;
  label?: string;
}

export interface MotionTrack {
  id: string;
  name: string;
  kind: "layer" | "video" | "audio";
  clips: MotionClip[];
  /** Keyframes as seconds from the start of the track's first clip, so they travel with it. */
  keyframes?: number[];
  /** Beat marks for an audio track. */
  beats?: number[];
  /** 0..1 amplitudes for an audio track's wave, evenly spread over its clip. */
  wave?: number[];
}

type Drag = { clip: string; track: string; mode: "move" | "start" | "end"; x: number; start: number; end: number };

export function Timeline({
  tracks,
  duration,
  time,
  onSeek,
  selected,
  onSelect,
  onClipChange,
  zoom,
  onZoom,
}: {
  tracks: MotionTrack[];
  duration: number;
  time: number;
  onSeek: (seconds: number) => void;
  selected: string | null;
  onSelect: (clipId: string | null) => void;
  onClipChange: (trackId: string, clip: MotionClip) => void;
  /** Pixels per second. */
  zoom: number;
  onZoom: (pxPerSecond: number) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const width = Math.max(1, duration * zoom);
  const step = rulerStep(zoom);
  const ticks = useMemo(() => Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step), [duration, step]);

  useEffect(() => {
    if (!drag) return;
    const moveTo = (e: PointerEvent) => {
      const dt = (e.clientX - drag.x) / zoom;
      const track = tracks.find((tr) => tr.id === drag.track);
      const clip = track?.clips.find((c) => c.id === drag.clip);
      if (!clip) return;
      const next =
        drag.mode === "move"
          ? clampClip(snap(drag.start + dt), snap(drag.end + dt), duration)
          : drag.mode === "start"
            ? { start: Math.min(Math.max(0, snap(drag.start + dt)), drag.end - 0.1), end: drag.end }
            : { start: drag.start, end: Math.max(Math.min(duration, snap(drag.end + dt)), drag.start + 0.1) };
      onClipChange(drag.track, { ...clip, ...next });
    };
    const stop = () => setDrag(null);
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", stop);
    };
  }, [drag, zoom, tracks, duration, onClipChange]);

  function seekAt(clientX: number) {
    const box = area.current?.getBoundingClientRect();
    if (!box) return;
    onSeek(Math.min(duration, Math.max(0, (clientX - box.left) / zoom)));
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl" style={{ background: "var(--color-surface-2)" }}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <BracketLabel>{t("الزمن")}</BracketLabel>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onZoom(Math.max(20, zoom / 1.5))}
            aria-label={t("صغّر الزمن")}
            title={t("صغّر الزمن")}
            className="flex h-6 w-6 items-center justify-center rounded-full text-sm transition-colors hover:bg-[var(--color-surface)]"
          >
            −
          </button>
          <span className="num w-12 text-center text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {Math.round(zoom)}px/s
          </span>
          <button
            onClick={() => onZoom(Math.min(600, zoom * 1.5))}
            aria-label={t("كبّر الزمن")}
            title={t("كبّر الزمن")}
            className="flex h-6 w-6 items-center justify-center rounded-full text-sm transition-colors hover:bg-[var(--color-surface)]"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex min-h-0">
        {/* Track names follow the page direction; the time area doesn't. */}
        <div className="w-24 shrink-0 pt-6">
          {tracks.map((track) => (
            <div key={track.id} className="flex h-10 items-center truncate px-3 text-xs" style={{ color: "var(--color-ink-muted)" }} dir="auto">
              {track.name}
            </div>
          ))}
        </div>

        <div
          className="min-w-0 flex-1 overflow-x-auto pb-2"
          dir="ltr"
          onWheel={(e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            onZoom(Math.min(600, Math.max(20, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
          }}
        >
          <div ref={area} className="relative" style={{ width: width + 24 }}>
            {/* Ruler: click or drag to move the playhead. */}
            <div
              className="relative h-6 cursor-pointer select-none"
              onPointerDown={(e) => {
                seekAt(e.clientX);
                const move = (ev: PointerEvent) => seekAt(ev.clientX);
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
              }}
            >
              {ticks.map((tick) => (
                <span key={tick} className="num absolute top-1 text-[10px]" style={{ left: tick * zoom, color: "var(--color-ink-muted)" }}>
                  <span className="absolute -bottom-2 left-0 h-1.5 w-px" style={{ background: "var(--color-border)" }} />
                  <span className="ps-1">{formatTime(tick, step < 1)}</span>
                </span>
              ))}
            </div>

            {tracks.map((track) => (
              <div key={track.id} className="relative h-10 border-t" style={{ borderColor: "var(--color-border)" }}>
                {track.clips.map((clip) => {
                  const on = selected === clip.id;
                  return (
                    <div
                      key={clip.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      aria-label={clip.label ?? track.name}
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).dataset.edge) return;
                        e.preventDefault();
                        onSelect(clip.id);
                        setDrag({ clip: clip.id, track: track.id, mode: "move", x: e.clientX, start: clip.start, end: clip.end });
                      }}
                      onKeyDown={(e) => {
                        const by = e.shiftKey ? 1 : 0.1;
                        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                          e.preventDefault();
                          const d = e.key === "ArrowRight" ? by : -by;
                          onClipChange(track.id, { ...clip, ...clampClip(snap(clip.start + d), snap(clip.end + d), duration) });
                        }
                      }}
                      className="group absolute top-1.5 flex h-7 cursor-grab items-center overflow-hidden rounded-lg text-[11px] active:cursor-grabbing"
                      style={{
                        left: clip.start * zoom,
                        width: Math.max(8, (clip.end - clip.start) * zoom),
                        background: track.kind === "video" ? "var(--color-border)" : "var(--color-surface)",
                        boxShadow: on ? "inset 0 0 0 2px var(--color-accent)" : "inset 0 0 0 1px var(--color-border)",
                      }}
                    >
                      {track.kind === "audio" && track.wave && <Wave values={track.wave} />}
                      <span className="relative truncate px-2" dir="auto">
                        {clip.label}
                      </span>
                      {(["start", "end"] as const).map((edge) => (
                        <span
                          key={edge}
                          data-edge={edge}
                          aria-hidden
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelect(clip.id);
                            setDrag({ clip: clip.id, track: track.id, mode: edge, x: e.clientX, start: clip.start, end: clip.end });
                          }}
                          className={`absolute inset-y-0 w-1.5 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100 ${edge === "start" ? "left-0" : "right-0"}`}
                          style={{ background: "var(--color-ink-muted)" }}
                        />
                      ))}
                    </div>
                  );
                })}
                {track.keyframes?.map((k) => (
                  <span
                    key={k}
                    className="pointer-events-none absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45"
                    style={{ left: ((track.clips[0]?.start ?? 0) + k) * zoom, background: "var(--color-ink)" }}
                    aria-hidden
                  />
                ))}
                {track.beats?.map((b) => (
                  <span key={b} className="pointer-events-none absolute inset-y-1 w-px" style={{ left: b * zoom, background: "var(--color-ink-muted)", opacity: 0.5 }} aria-hidden />
                ))}
              </div>
            ))}

            {/* Playhead: the one orange line. */}
            <motion.span
              className="pointer-events-none absolute bottom-0 top-0 w-0.5"
              style={{ background: "var(--color-accent)" }}
              animate={{ left: time * zoom }}
              transition={{ duration: 0 }}
              aria-hidden
            >
              <span className="absolute -left-1 top-0 h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-accent)" }} />
            </motion.span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Wave({ values }: { values: number[] }) {
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${50 - v * 45} `).join("");
  const lower = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${50 + v * 45} `).reverse().join("");
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <polygon points={points + lower} style={{ fill: "var(--color-ink-muted)", opacity: 0.35 }} />
    </svg>
  );
}

// ── Transport ────────────────────────────────────────────────────────────────────────────

export function Transport({
  playing,
  time,
  duration,
  fps,
  onPlay,
  onSeek,
}: {
  playing: boolean;
  time: number;
  duration: number;
  fps: number;
  onPlay: (playing: boolean) => void;
  onSeek: (seconds: number) => void;
}) {
  const frame = 1 / fps;
  const button = "flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface-2)]";
  return (
    <div className="flex items-center gap-3" dir="ltr">
      <div className="flex items-center gap-1">
        <button className={button} onClick={() => onSeek(Math.max(0, time - frame))} aria-label={t("فريم لورا")} title={t("فريم لورا")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M6 5h2v14H6zM20 5v14L9 12z" />
          </svg>
        </button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}
          onClick={() => onPlay(!playing)}
          aria-label={playing ? t("وقّف") : t("شغّل")}
          title={playing ? t("وقّف") : t("شغّل")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </motion.button>
        <button className={button} onClick={() => onSeek(Math.min(duration, time + frame))} aria-label={t("فريم لقدّام")} title={t("فريم لقدّام")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
          </svg>
        </button>
      </div>
      <p className="num text-[20px] font-bold leading-none">
        {formatTime(time)}
        <span className="text-[13px] font-normal" style={{ color: "var(--color-ink-muted)" }}>
          {" "}
          / {formatTime(duration)}
        </span>
      </p>
    </div>
  );
}

// ── Check badge and panel ────────────────────────────────────────────────────────────────

export interface LintIssue {
  code: string;
  message: string;
  time: number;
  layer?: string;
  severity: "error" | "warning";
}

export function LintBadge({ issues, open, onToggle }: { issues: LintIssue[]; open: boolean; onToggle: () => void }) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const clean = issues.length === 0;
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
      style={{
        borderColor: "var(--color-border)",
        color: clean ? "var(--color-success)" : errors ? "var(--color-danger)" : "var(--color-pending)",
      }}
    >
      <span style={{ color: "var(--color-ink-muted)" }}>( {t("فحص")} )</span>
      {clean ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <AlertIcon className="h-3.5 w-3.5" />}
      <span className="num">{clean ? "" : issues.length}</span>
    </button>
  );
}

export function LintPanel({ issues, onJump, onClose }: { issues: LintIssue[]; onJump: (issue: LintIssue) => void; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: easeOutExpo }}
      className="w-80 overflow-hidden rounded-2xl border shadow-lg"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <BracketLabel>{t("فحص")}</BracketLabel>
        <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-full p-1 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {issues.length === 0 ? (
        <p className="px-3.5 pb-4 text-sm" style={{ color: "var(--color-success)" }}>
          {t("ما في مشاكل. المقطع جاهز للتصدير.")}
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className="border-t" style={{ borderColor: "var(--color-border)" }}>
              <button onClick={() => onJump(issue)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-start transition-colors hover:bg-[var(--color-surface-2)]">
                <span
                  className="num mt-0.5 shrink-0 rounded-full px-1.5 text-[10px]"
                  style={{ background: issue.severity === "error" ? "var(--color-danger)" : "var(--color-pending)", color: "#fff" }}
                  dir="ltr"
                >
                  {issue.code}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-relaxed" dir="auto">
                  {issue.message}
                  {issue.layer && <span style={{ color: "var(--color-ink-muted)" }}> · {issue.layer}</span>}
                </span>
                <span className="num shrink-0 text-[11px]" style={{ color: "var(--color-ink-muted)" }} dir="ltr">
                  {formatTime(issue.time)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// ── Device frame ─────────────────────────────────────────────────────────────────────────

/** The clip inside its device: a phone for 9:16, a plain frame otherwise; safe area and grid on request. */
export function DeviceFrame({ ratio, safeArea, grid, children }: { ratio: "9:16" | "1:1" | "16:9"; safeArea: boolean; grid: boolean; children?: React.ReactNode }) {
  const [w, h] = ratio.split(":").map(Number);
  const phone = ratio === "9:16";
  return (
    <div
      className="relative mx-auto overflow-hidden"
      style={{
        aspectRatio: `${w} / ${h}`,
        height: phone ? 360 : undefined,
        width: phone ? undefined : "100%",
        maxWidth: phone ? undefined : 560,
        borderRadius: phone ? 28 : 12,
        border: phone ? "6px solid var(--color-inverse)" : "1px solid var(--color-border)",
        background: "#111",
      }}
    >
      {children}
      {grid && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(to right, rgba(255,255,255,.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.12) 1px, transparent 1px)",
            backgroundSize: "calc(100% / 6) calc(100% / 6)",
          }}
          aria-hidden
        />
      )}
      {safeArea && (
        <div
          className="pointer-events-none absolute rounded-md"
          style={{ inset: phone ? "12% 8% 18% 8%" : "6% 6%", border: "1px dashed rgba(255,255,255,.45)" }}
          aria-hidden
        />
      )}
    </div>
  );
}

// ── Export window ────────────────────────────────────────────────────────────────────────

export interface ExportSettings {
  format: "mp4-h264" | "mp4-h265" | "lottie";
  size: "720p" | "1080p" | "4k";
  fps: 24 | 30 | 60 | 120;
  encoder: "auto" | "gpu" | "ffmpeg";
}

export function ExportDialog({
  value,
  onChange,
  progress,
  secondsLeft,
  onStart,
  onCancel,
  onClose,
}: {
  value: ExportSettings;
  onChange: (next: ExportSettings) => void;
  /** null before it starts; 0..1 while it runs. */
  progress: number | null;
  secondsLeft: number | null;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const running = progress !== null && progress < 1;
  const lottie = value.format === "lottie";
  const options: { key: keyof ExportSettings; label: string; items: { id: string; label: string; off?: boolean }[] }[] = [
    {
      key: "format",
      label: t("الصيغة"),
      items: [
        { id: "mp4-h264", label: "MP4 · H.264" },
        { id: "mp4-h265", label: "MP4 · H.265" },
        { id: "lottie", label: "Lottie" },
      ],
    },
    {
      key: "size",
      label: t("الدقة"),
      items: [
        { id: "720p", label: "720p" },
        { id: "1080p", label: "1080p" },
        { id: "4k", label: "4K", off: value.fps === 120 },
      ],
    },
    {
      key: "fps",
      label: "fps",
      items: [24, 30, 60, 120].map((n) => ({ id: String(n), label: String(n), off: n === 120 && value.size === "4k" })),
    },
    {
      key: "encoder",
      label: t("المُرمّز"),
      items: [
        { id: "auto", label: t("تلقائي") },
        { id: "gpu", label: t("كرت الشاشة") },
        { id: "ffmpeg", label: "FFmpeg" },
      ],
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: easeOutExpo }}
      className="flex w-full max-w-md flex-col gap-4 rounded-2xl border p-5 shadow-2xl"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      role="dialog"
      aria-label={t("تصدير")}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">{t("تصدير")}</h2>
        <button onClick={onClose} aria-label={t("إغلاق")} className="rounded-full p-1.5 hover:bg-[var(--color-surface-2)]" style={{ color: "var(--color-ink-muted)" }}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {options.map((group) =>
        lottie && group.key !== "format" && group.key !== "fps" ? null : (
          <div key={group.key} className="flex flex-col gap-1.5">
            <BracketLabel>{group.label}</BracketLabel>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => {
                const on = String(value[group.key]) === item.id;
                return (
                  <button
                    key={item.id}
                    disabled={running || item.off}
                    onClick={() => onChange({ ...value, [group.key]: group.key === "fps" ? Number(item.id) : item.id } as ExportSettings)}
                    className="relative rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
                    style={{ borderColor: on ? "var(--color-inverse)" : "var(--color-border)", color: on ? "var(--color-on-inverse)" : "var(--color-ink)" }}
                  >
                    {on && <motion.span layoutId={`export-${group.key}`} className="absolute inset-0 rounded-full" style={{ background: "var(--color-inverse)" }} transition={snappy} />}
                    <span className="num relative">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ),
      )}

      <AnimatePresence initial={false}>
        {progress !== null && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex items-end justify-between gap-3 pt-1">
              <BigNumber value={Math.round(progress * 100)} unit="%" size={34} />
              {secondsLeft !== null && running && (
                <p className="text-end text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
                  {t("الوقت الباقي")}
                  <br />
                  <span className="num text-[20px] font-bold" style={{ color: "var(--color-ink)" }}>
                    {formatTime(secondsLeft, false)}
                  </span>
                </p>
              )}
            </div>
            <LedBar value={progress} segments={24} tone="accent" label={t("تصدير")} className="mt-2" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-end gap-2">
        {running ? (
          <Button variant="ghost" onClick={onCancel}>
            {t("إلغاء")}
          </Button>
        ) : (
          <Button variant="accent" onClick={onStart}>
            {progress === 1 ? t("صدّر كمان مرة") : t("صدّر")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
