/**
 * A globe turning slowly behind the pages, the cities of the region pulsing on it — the
 * app's backdrop. Drawn with cobe (WebGL, a few kilobytes); it rests while the window is
 * hidden, stands still for people who ask for less motion, and can be switched off in
 * Settings → General. (After the "Globe Pulse" component on 21st.dev, written for Rafiq.)
 */

import { useEffect, useRef } from "react";
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

export function GlobeBackdrop({ dark, size = 720 }: { dark: boolean; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let phi = 4.2; // the Middle East facing the viewer
    let t = 0;
    let globe: ReturnType<typeof createGlobe> | null = null;
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
          if (document.hidden) return;
          if (!still) {
            phi += 0.0016;
            t += 0.03;
          }
          state.phi = phi;
          // Each city pulses on its own beat: a ring that swells and falls back.
          state.markers = CITIES.map((location, i) => ({ location, size: 0.03 + 0.045 * Math.pow(Math.sin(t + i * 0.9) * 0.5 + 0.5, 2) }));
        },
      });
    } catch {
      // No WebGL (an old driver): no backdrop, nothing else changes.
    }
    return () => globe?.destroy();
  }, [dark, size]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none select-none" style={{ width: size, height: size, contain: "strict" }} />;
}
