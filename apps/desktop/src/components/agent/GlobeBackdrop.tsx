/**
 * A globe turning slowly behind the pages, the cities of the region pulsing on it — the
 * app's backdrop. Drawn with cobe (WebGL, a few kilobytes); it stops drawing while the window
 * is hidden or another app is in front (WebGL at 60 frames a second is the app's costliest
 * thing on a laptop), stands still for people who ask for less motion, and can be switched off in
 * Settings → General. (After the "Globe Pulse" component on 21st.dev, written for Rafiq.)
 *
 * It stays built while pages come and go: a page that covers it (`paused`) only stops its
 * drawing, so moving between pages never builds a new WebGL context and compiles its shaders.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import createGlobe from "cobe";

// Riyadh, Dubai, Cairo, Amman, Beirut, Istanbul, London, New York, Tokyo — [lat, lng].
const CITIES: [number, number][] = [
  [24.71, 46.68],
  [25.2, 55.27],
  [30.04, 31.24],
  [31.95, 35.93],
  [33.89, 35.5],
  [41.01, 28.98],
  [51.51, -0.13],
  [40.71, -74.01],
  [35.68, 139.69],
];

/** How long the globe holds still after a page changes, so the new page draws first. */
const PAGE_HOLD_MS = 700;

export function GlobeBackdrop({ dark, size = 720, paused = false }: { dark: boolean; size?: number; paused?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const stopped = useRef(paused);
  const holdUntil = useRef(0);
  const wake = useRef<() => void>(() => undefined);

  useEffect(() => {
    stopped.current = paused;
    wake.current();
  }, [paused]);

  useEffect(() => {
    holdUntil.current = performance.now() + PAGE_HOLD_MS;
  }, [location.pathname]);

  useEffect(() => {
    const host = box.current;
    if (!host) return;
    // A new canvas for every build (a theme or size change): the last one's WebGL context is
    // let go when it's taken down, and a lost context can't draw again.
    const el = document.createElement("canvas");
    el.className = "pointer-events-none select-none";
    el.style.cssText = `width:${size}px;height:${size}px;contain:strict;display:block`;
    host.appendChild(el);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Drawn at one pixel per CSS pixel even on a scaled screen: every pixel runs the whole
    // shader, so 1.5× would cost 2.25× the graphics work for a backdrop that looks the same.
    const dpr = 1;
    let phi = 4.2; // the Middle East facing the viewer
    let t = 0;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let last = 0; // when the globe last drew
    let frame = 0; // the pending animation frame, while the window is active
    let drawn = 0;
    try {
      globe = createGlobe(el, {
        devicePixelRatio: dpr,
        width: size * dpr,
        height: size * dpr,
        phi,
        theta: 0.28,
        // Dark in both themes, like the original: a night globe reads on a light page too.
        dark: 1,
        diffuse: 1.6,
        mapSamples: 14000,
        mapBrightness: dark ? 9 : 8,
        baseColor: dark ? [0.36, 0.35, 0.33] : [0.2, 0.2, 0.19],
        markerColor: [0.9, 0.53, 0.21],
        glowColor: dark ? [0.32, 0.2, 0.1] : [0.98, 0.8, 0.6],
        markers: [],
        onRender: (state) => {
          // Moved by the time since the last frame, so the pace is the same at any frame rate.
          const now = performance.now();
          const frames = last ? Math.min(4, (now - last) / (1000 / 60)) : 1;
          last = now;
          if (!still) {
            phi += 0.0016 * frames;
            t += 0.03 * frames;
          }
          state.phi = phi;
          // Each city pulses on its own beat: a ring that swells and falls back.
          state.markers = CITIES.map((location, i) => ({ location, size: 0.03 + 0.045 * Math.pow(Math.sin(t + i * 0.9) * 0.5 + 0.5, 2) }));
        },
      });
      // cobe draws on every screen refresh; a backdrop turning this slowly looks the same at
      // 30 frames a second, for half the work (on a laptop's built-in graphics, that matters).
      globe.toggle(false);
    } catch {
      // No WebGL (an old driver): no backdrop, nothing else changes.
    }
    // Drawn by the processor instead of a graphics card (no driver, or the browser fell back to
    // software): each frame would cost the processor what the whole app needs. It stands still.
    // (cobe takes WebGL 2 where there is one; asking for the kind it took returns that one.)
    const gl = globe ? (el.getContext("webgl2") ?? el.getContext("webgl")) : null;
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const software = Boolean(gl && info && /swiftshader|software|basic render|llvmpipe/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))));
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - drawn < 1000 / 30 - 2 || now < holdUntil.current) return;
      drawn = now;
      globe?.render();
    };
    // Focus inside a page's own frame (a design preview) still counts as the window's.
    const rest = () => {
      const active = !document.hidden && document.hasFocus() && !stopped.current && !software;
      if (active && !frame && globe) frame = requestAnimationFrame(tick);
      if (!active && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
      }
    };
    wake.current = rest;
    const later = () => window.setTimeout(rest, 0);
    // One frame right away, so the globe is there even in a window that starts unfocused.
    globe?.render();
    rest();
    window.addEventListener("focus", rest);
    window.addEventListener("blur", later);
    document.addEventListener("visibilitychange", rest);
    return () => {
      wake.current = () => undefined;
      window.removeEventListener("focus", rest);
      window.removeEventListener("blur", later);
      document.removeEventListener("visibilitychange", rest);
      if (frame) cancelAnimationFrame(frame);
      globe?.destroy();
      // Its graphics memory goes now, not whenever the canvas happens to be collected.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      el.remove();
    };
  }, [dark, size]);

  return <div ref={box} aria-hidden style={{ width: size, height: size }} />;
}
