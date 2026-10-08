/**
 * A scene on a canvas: the preview in the workspace, the thumbnails in the list, and each
 * side of a version comparison. Draws with the same engine the export uses, at the size of
 * its box (times the screen's pixel ratio), and plays the mixed sound in step with it.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { hasAudio, mixAudio, toAudioBuffer } from "./engine/audio";
import { MotionEngine } from "./engine/engine";
import type { BrandKit, Scene } from "./engine/types";
import { assetLoader } from "./exports";

export interface ScenePlayerHandle {
  engine: () => MotionEngine | null;
  canvas: () => HTMLCanvasElement | null;
}

interface Props {
  scene: Scene;
  kit: BrandKit;
  time: number;
  playing?: boolean;
  /** Called on every drawn frame while playing (and when it stops at the end). */
  onTime?: (t: number) => void;
  onEnded?: () => void;
  loop?: boolean;
  sound?: boolean;
  /** Pixel budget for thumbnails (the longest side, in CSS px); the preview uses its box. */
  maxSide?: number;
  /** Full quality: videos decoded at their real size (the full preview). */
  full?: boolean;
  className?: string;
  onReady?: (engine: MotionEngine) => void;
  onError?: (message: string) => void;
  /** Drawn over the canvas at its exact size (safe area, grid, selection). */
  overlay?: (width: number, height: number) => React.ReactNode;
  onCanvasClick?: (x: number, y: number) => void;
}

export const ScenePlayer = forwardRef<ScenePlayerHandle, Props>(function ScenePlayer(
  { scene, kit, time, playing = false, onTime, onEnded, loop = false, sound = false, maxSide, full = false, className, onReady, onError, overlay, onCanvasClick },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MotionEngine | null>(null);
  const [ready, setReady] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const timeRef = useRef(time);
  timeRef.current = time;
  const comp = scene.composition;

  useImperativeHandle(ref, () => ({ engine: () => engine.current, canvas: () => canvas.current }), []);

  // The engine follows the scene; loading fonts, icons and media happens once per change.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!engine.current) engine.current = new MotionEngine(scene, kit, await assetLoader(), { preview: !full });
        else await engine.current.update(scene, kit);
        if (!engine.current.prepared) await engine.current.ready();
        if (!alive) return;
        setReady((n) => n + 1);
        onReady?.(engine.current);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, kit]);

  useEffect(() => () => engine.current?.dispose(), []);

  // Fit the composition into the box.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      const k = Math.min(rect.width / comp.width, rect.height / comp.height);
      setSize({ w: Math.max(1, Math.floor(comp.width * k)), h: Math.max(1, Math.floor(comp.height * k)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comp.width, comp.height]);

  const draw = async (t: number) => {
    const e = engine.current;
    const c = canvas.current;
    if (!e?.prepared || !c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const budget = maxSide ? Math.min(1, (maxSide * dpr) / Math.max(size.w, size.h)) : 1;
    const pw = Math.round(size.w * dpr * budget);
    const ph = Math.round(size.h * dpr * budget);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    if (e.hasVideo()) await e.prepareFrame(t);
    const ctx = c.getContext("2d");
    if (ctx) e.draw(ctx, Math.max(0, Math.min(comp.duration - 1e-4, t)), pw / comp.width);
  };

  // Still frames: redraw when the time, the size or the scene changes.
  useEffect(() => {
    if (!playing) void draw(time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, size, ready, playing]);

  // Sound: mixed once per scene, played from the current time.
  const audio = useRef<{ key: string; buffer: AudioBuffer } | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Playing: a clock from requestAnimationFrame, the audio started at the same moment.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let alive = true;
    let busy = false;
    const from = timeRef.current >= comp.duration - 1e-3 ? 0 : timeRef.current;
    let started = performance.now();
    (async () => {
      if (sound && engine.current && hasAudio(scene)) {
        const key = JSON.stringify([scene.audio, scene.assets, scene.composition.duration, scene.layers.filter((l) => l.type === "video").map((l) => [l.start, l.end, l.in, l.speed, l.volume])]);
        if (audio.current?.key !== key) {
          const mix = await mixAudio({ scene, open: (id) => engine.current!.audioReader(id) });
          audio.current = { key, buffer: toAudioBuffer(mix.channels) };
        }
        if (!alive) return;
        ctxRef.current ??= new AudioContext({ sampleRate: 48000 });
        await ctxRef.current.resume();
        const src = ctxRef.current.createBufferSource();
        src.buffer = audio.current.buffer;
        src.connect(ctxRef.current.destination);
        src.start(0, from);
        sourceRef.current = src;
        started = performance.now();
      }
      const tick = async () => {
        if (!alive) return;
        let t = from + (performance.now() - started) / 1000;
        if (t >= comp.duration) {
          if (loop) {
            started = performance.now();
            t = 0;
          } else {
            onTime?.(comp.duration);
            onEnded?.();
            return;
          }
        }
        if (!busy) {
          busy = true;
          await draw(t);
          busy = false;
          onTime?.(t);
        }
        raf = requestAnimationFrame(() => void tick());
      };
      raf = requestAnimationFrame(() => void tick());
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      try {
        sourceRef.current?.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ready]);

  return (
    // positioned by the caller (absolute inset-…) or, by default, relative — never both, or
    // the stylesheet's order decides and the box collapses to the canvas
    <div ref={box} className={`${/\b(absolute|fixed)\b/.test(className ?? "") ? "" : "relative "}flex items-center justify-center ${className ?? ""}`}>
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h, borderRadius: 6 }}
          onClick={(e) => {
            if (!onCanvasClick) return;
            const rect = e.currentTarget.getBoundingClientRect();
            onCanvasClick(((e.clientX - rect.left) / rect.width) * comp.width, ((e.clientY - rect.top) / rect.height) * comp.height);
          }}
        />
        {overlay?.(size.w, size.h)}
      </div>
    </div>
  );
});
