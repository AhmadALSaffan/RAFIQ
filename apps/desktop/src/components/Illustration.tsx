/**
 * Hand-drawn people for empty screens and the first run (Open Peeps, CC0 art; react-peeps,
 * MIT). Black line on a calm block — never drawn by hand here. The figures load as their own
 * chunk so the first paint doesn't wait for them.
 */

import { lazy, Suspense, useEffect, useState } from "react";

const Peep = lazy(() => import("react-peeps"));

export type Scene = "chat" | "tasks" | "designs" | "schedule" | "models" | "work" | "search" | "welcome" | "connect" | "motion" | "settings" | "thinking";

type Part = Parameters<typeof import("react-peeps").default>[0];

const SCENES: Record<Scene, Part> = {
  chat: { body: "Coffee", face: "Calm", hair: "Hijab" },
  tasks: { body: "PointingFingerWB", face: "Driven", hair: "ShortVolumed" },
  designs: { body: "Device", face: "Cheeky", hair: "Bun" },
  schedule: { body: "MediumWB", face: "EyesClosed", hair: "Short" },
  models: { body: "Geek", face: "Smile", hair: "Pomp", accessory: "GlassRoundThick" },
  work: { body: "Paper", face: "Serious", hair: "MediumStraight" },
  search: { body: "Explaining", face: "Suspicious", hair: "Medium" },
  welcome: { body: "RoboDanceWB", face: "SmileBig", hair: "Afro" },
  connect: { body: "PointingUp", face: "Explaining", hair: "Turban" },
  motion: { body: "Gaming", face: "LoveGrin", hair: "BunCurly", accessory: "SunglassWayfarer" },
  settings: { body: "Turtleneck", face: "Calm", hair: "GrayShort", accessory: "GlassRound" },
  thinking: { body: "Explaining", face: "Explaining", hair: "Hijab" },
};

const STANDING = new Set(["PointingFingerWB", "RoboDanceWB"]);
const SITTING = new Set(["MediumWB"]);

/** The theme actually on the page, following the toggle and the system. */
function usePageTheme(): "light" | "dark" {
  const read = (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function Illustration({ scene, size = 160, className = "" }: { scene: Scene; size?: number; className?: string }) {
  const theme = usePageTheme();
  const part = SCENES[scene];
  // SVG attributes can't read CSS variables, so the two theme colours are passed as values.
  const ink = theme === "dark" ? "#f2f2ef" : "#121212";
  const fill = theme === "dark" ? "#232321" : "#ffffff";
  const tall = STANDING.has(String(part.body)) || SITTING.has(String(part.body));
  return (
    <div className={`pointer-events-none select-none ${className}`} style={{ width: size, height: size }} aria-hidden>
      <Suspense fallback={null}>
        <Peep
          {...part}
          strokeColor={ink}
          backgroundColor={fill}
          style={{ width: size, height: size }}
          viewBox={tall ? { x: "-200", y: "0", width: "1400", height: "1600" } : { x: "0", y: "0", width: "850", height: "1200" }}
        />
      </Suspense>
    </div>
  );
}
