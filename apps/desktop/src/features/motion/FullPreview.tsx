/**
 * The video as it will export: the whole window, full resolution (videos decoded at their
 * real size, not the editor's preview size), no guides, with sound. Space plays, arrows step
 * a frame, Esc closes.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { t } from "../../i18n";
import { PauseIcon, PlayIcon, VolumeIcon, XIcon } from "../../components/Icons";
import { ScenePlayer } from "./ScenePlayer";
import { formatTime } from "./pieces";
import type { BrandKit, Scene } from "./engine/types";

export function FullPreview({ scene, kit, start = 0, onClose }: { scene: Scene; kit: BrandKit; start?: number; onClose: (time: number) => void }) {
  const comp = scene.composition;
  const [time, setTime] = useState(start >= comp.duration - 0.05 ? 0 : start);
  const [playing, setPlaying] = useState(true);
  const [sound, setSound] = useState(true);
  const [loop, setLoop] = useState(false);
  const [actual, setActual] = useState(false);
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(timeRef.current);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        setPlaying(false);
        const d = (e.shiftKey ? 1 : 1 / comp.fps) * (e.key === "ArrowRight" ? 1 : -1);
        setTime((x) => Math.min(comp.duration, Math.max(0, x + d)));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [comp.duration, comp.fps, onClose]);

  // the controls fade away while it plays and the mouse rests
  const wake = () => {
    setIdle(false);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), 2200);
  };
  useEffect(() => {
    wake();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const hide = idle && playing;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#000", cursor: hide ? "none" : undefined }}
      onPointerMove={wake}
      role="dialog"
      aria-label={t("معاينة كاملة")}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto" onClick={() => setPlaying((p) => !p)}>
        <div
          style={
            actual
              ? { width: comp.width / (window.devicePixelRatio || 1), height: comp.height / (window.devicePixelRatio || 1) }
              : { width: "100%", height: "100%" }
          }
          className="shrink-0"
        >
          <ScenePlayer
            scene={scene}
            kit={kit}
            time={time}
            playing={playing}
            sound={sound}
            loop={loop}
            onTime={setTime}
            onEnded={() => setPlaying(false)}
            full
            className="h-full w-full"
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-6 pb-5 pt-3 transition-opacity duration-300" style={{ opacity: hide ? 0 : 1, color: "#fff", background: "linear-gradient(transparent, rgba(0,0,0,.85))" }}>
        <input
          type="range"
          min={0}
          max={comp.duration}
          step={1 / comp.fps}
          value={time}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
          className="w-full accent-[var(--color-accent)]"
          dir="ltr"
          aria-label={t("الزمن")}
        />
        <div className="flex items-center gap-3" dir="ltr">
          <button type="button" onClick={() => setPlaying((p) => !p)} className="rounded-full p-2" style={{ background: "#fff", color: "#000" }} aria-label={playing ? t("إيقاف") : t("تشغيل")}>
            {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
          </button>
          <span className="num text-sm">
            {formatTime(time)} / {formatTime(comp.duration)}
          </span>
          <span className="num text-xs opacity-60">
            {comp.width}×{comp.height} · {comp.fps}fps
          </span>
          <div className="flex-1" />
          <button type="button" onClick={() => setLoop((l) => !l)} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: loop ? "#fff" : "rgba(255,255,255,.3)" }}>
            {t("تكرار")}
          </button>
          <button type="button" onClick={() => setActual((a) => !a)} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: actual ? "#fff" : "rgba(255,255,255,.3)" }}>
            {actual ? t("ملء الشاشة") : t("الحجم الحقيقي")}
          </button>
          <button type="button" onClick={() => setSound((s) => !s)} className="rounded-full p-1.5" style={{ opacity: sound ? 1 : 0.4 }} aria-label={t("الصوت")} title={t("الصوت")}>
            <VolumeIcon className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => onClose(time)} className="rounded-full p-1.5" aria-label={t("إغلاق")} title={t("إغلاق (Esc)")}>
            <XIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
