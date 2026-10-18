/**
 * Every version of the scene, newest first: who made it and what changed. Pick one to watch
 * it next to the current scene, in step (the same clock drives both), and bring it back.
 */

import { Timeline } from "../../components/arc/timeline/timeline";
import { useEffect, useState } from "react";
import { intlLocale, t } from "../../i18n";
import { getMotionVersion, listMotionVersions, restoreMotionVersion, type MotionProject, type MotionVersion } from "../../lib/api";
import { BracketLabel } from "../../components/brand";
import { Button } from "../../components/ui";
import { PauseIcon, PlayIcon } from "../../components/Icons";
import type { Scene } from "./engine/types";
import { ScenePlayer } from "./ScenePlayer";
import { formatTime } from "./pieces";

export function VersionsPane({ project, onRestored }: { project: MotionProject; onRestored: (p: MotionProject) => void }) {
  const [versions, setVersions] = useState<MotionVersion[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [other, setOther] = useState<Scene | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listMotionVersions(project.id).then(setVersions).catch(() => setVersions([]));
  }, [project.id, project.version]);

  useEffect(() => {
    if (picked === null) return setOther(null);
    let alive = true;
    getMotionVersion(project.id, picked).then((v) => alive && setOther(v.scene)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [picked, project.id]);

  const duration = Math.max(project.scene.composition.duration, other?.composition.duration ?? 0);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col gap-1 overflow-y-auto border-e p-3" style={{ borderColor: "var(--color-border)" }}>
        <BracketLabel>{t("النسخ")}</BracketLabel>
        {/* Every version as a feed, newest first: who made it and what changed; open one to
            compare it with the current scene. */}
        <Timeline
          label={t("نسخ المشهد")}
          now={Date.now()}
          timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          locale={intlLocale()}
          scrollToNew
          events={versions.map((v) => {
            const current = v.number === project.version;
            return {
              id: String(v.number),
              at: v.created_at,
              actor: `v${v.number}`,
              title: v.summary || "—",
              meta: current ? t("الحالية") : v.author === "model" ? t("الموديل") : v.author === "restore" ? t("إرجاع") : t("إنت"),
              tone: current ? ("success" as const) : ("neutral" as const),
              detail: current ? undefined : (
                <Button variant={picked === v.number ? "accent" : "ghost"} className="mt-1 text-xs" onClick={() => setPicked(picked === v.number ? null : v.number)}>
                  {picked === v.number ? t("سكّر المقارنة") : t("قارنها مع الحالية")}
                </Button>
              ),
            };
          })}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {picked === null || !other ? (
          <p className="m-auto max-w-sm text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("اختار نسخة لتشوفها جنب النسخة الحالية، بنفس الوقت.")}
          </p>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <div className="flex min-h-0 flex-col gap-1">
                <BracketLabel>{`v${picked}`}</BracketLabel>
                <ScenePlayer scene={other} kit={project.kit} time={time} playing={playing} onTime={setTime} onEnded={() => setPlaying(false)} className="min-h-0 flex-1" />
              </div>
              <div className="flex min-h-0 flex-col gap-1">
                <BracketLabel>{`v${project.version} · ${t("الحالية")}`}</BracketLabel>
                <ScenePlayer scene={project.scene} kit={project.kit} time={time} playing={playing} className="min-h-0 flex-1" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? t("إيقاف") : t("تشغيل")} className="rounded-full p-2" style={{ background: "var(--color-inverse)", color: "var(--color-on-inverse)" }}>
                {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
              </button>
              <input type="range" min={0} max={duration} step={0.01} value={time} onChange={(e) => setTime(Number(e.target.value))} aria-label={t("مكان التشغيل")} className="flex-1 accent-[var(--color-ink)]" dir="ltr" />
              <span className="num w-16 text-xs">{formatTime(time)}</span>
              <Button
                variant="accent"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    onRestored(await restoreMotionVersion(project.id, picked));
                    setPicked(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("رجّع v{n}", { n: picked })}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
