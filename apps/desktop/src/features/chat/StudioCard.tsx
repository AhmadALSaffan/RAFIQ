/**
 * A design or a motion reel the model started from a chat (`design_start` / `motion_start`).
 * The work happens in its own session; the card follows it: a live thumbnail (the design's
 * page, or the reel's player), what the model is doing, and one click to open it.
 */

import { useEffect, useRef, useState } from "react";
import { notify } from "../../lib/toast";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { getDesign, getMotionProject } from "../../lib/api";
import type { Design } from "../../lib/types";
import type { MotionProject } from "../../lib/api/motion";
import { snappy } from "../../lib/motion";
import { ScenePlayer } from "../motion/ScenePlayer";
import { MovieIcon, WandIcon } from "../../components/Icons";
import { ShimmerText } from "../../components/LiveText";
import { t } from "../../i18n";

export type StudioRef = { studio: "design" | "motion"; id: string; chat_id: string; title: string };

type Live = { working: boolean; html: string | null; project: MotionProject | null; title: string; gone: boolean };

/** Polls the session while its model works, then settles. */
function useLive(ref: StudioRef): Live {
  const [live, setLive] = useState<Live>({ working: true, html: null, project: null, title: ref.title, gone: false });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        if (ref.studio === "design") {
          const d: Design = await getDesign(ref.id);
          if (!alive) return;
          setLive({ working: Boolean(d.working), html: d.preview_html, project: null, title: d.title, gone: false });
          if (d.working) timer = setTimeout(tick, 3000);
        } else {
          const p: MotionProject = await getMotionProject(ref.id);
          if (!alive) return;
          setLive({ working: Boolean(p.working), html: null, project: p, title: p.title, gone: false });
          if (p.working) timer = setTimeout(tick, 3000);
        }
      } catch {
        if (alive) setLive((prev) => ({ ...prev, working: false, gone: true }));
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [ref.studio, ref.id]);
  return live;
}

function DesignThumb({ html }: { html: string | null }) {
  if (!html) return <div className="shimmer absolute inset-0" />;
  return (
    <iframe
      srcDoc={html}
      title={t("معاينة")}
      tabIndex={-1}
      sandbox="allow-scripts"
      className="pointer-events-none absolute start-0 top-0"
      style={{ width: "1280px", height: "800px", transform: "scale(0.2)", transformOrigin: "top right", border: 0, background: "white" }}
    />
  );
}

function MotionThumb({ project, playing }: { project: MotionProject | null; playing: boolean }) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (project) setTime(project.scene.composition.duration / 3);
  }, [project]);
  if (!project || project.version <= 1) return <div className="shimmer absolute inset-0" />;
  return <ScenePlayer scene={project.scene} kit={project.kit} time={time} playing={playing} loop maxSide={240} onTime={setTime} className="absolute inset-1.5" />;
}

export function StudioCard({ item, fresh }: { item: StudioRef; fresh: boolean }) {
  const navigate = useNavigate();
  const live = useLive(item);
  // Seen working, now settled: say so wherever the user is in the app.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (live.working) wasWorking.current = true;
    else if (wasWorking.current && !live.gone) {
      wasWorking.current = false;
      const design = item.studio === "design";
      notify({
        type: "success",
        title: design ? t("التصميم جاهز") : t("الريل جاهز"),
        description: live.title,
        action: { label: t("افتحه"), onClick: () => navigate(design ? `/designs/${item.id}` : `/motion/${item.id}`) },
      });
    }
  }, [live.working, live.gone, live.title, item.studio, item.id, navigate]);
  const [hover, setHover] = useState(false);
  const design = item.studio === "design";
  const status = live.gone
    ? t("انحذف")
    : live.working
      ? design
        ? t("عم يصمّمه…")
        : t("عم يبني الريل…")
      : design
        ? live.html
          ? t("جاهز — افتحه وكمّل عليه")
          : t("وقف قبل أول نسخة — افتحه")
        : live.project && live.project.version > 1
          ? t("جاهز — افتحه وصدّره")
          : t("وقف قبل أول نسخة — افتحه");

  return (
    <motion.button
      type="button"
      onClick={live.gone ? undefined : () => navigate(design ? `/designs/${item.id}` : `/motion/${item.id}`)}
      disabled={live.gone}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      initial={fresh ? { scale: 0.95, opacity: 0 } : false}
      animate={{ scale: 1, opacity: live.gone ? 0.55 : 1 }}
      whileHover={live.gone ? undefined : { y: -2 }}
      whileTap={live.gone ? undefined : { scale: 0.985 }}
      transition={snappy}
      className={`flex w-full items-stretch gap-3 overflow-hidden rounded-2xl p-2 text-start ${fresh ? "flash-accent" : ""}`}
      style={{ background: "var(--color-surface)" }}
    >
      <span
        className="relative block shrink-0 overflow-hidden rounded-xl"
        style={{ width: design ? 256 : 112, height: design ? 160 : 160, background: "var(--color-surface-2)" }}
        aria-hidden
      >
        {design ? <DesignThumb html={live.html} /> : <MotionThumb project={live.project} playing={hover} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-between py-1.5 pe-2">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--color-ink-muted)" }}>
            {design ? <WandIcon className="h-3.5 w-3.5" /> : <MovieIcon className="h-3.5 w-3.5" />}
            {design ? t("تصميم من المحادثة") : t("ريل من المحادثة")}
          </span>
          <span className="mt-1 line-clamp-2 block text-[15px] font-semibold leading-snug" dir="auto">
            {live.title}
          </span>
        </span>
        <span className="text-xs" style={{ color: live.working ? "var(--color-ink)" : live.gone ? "var(--color-ink-muted)" : "var(--color-success)" }}>
          {live.working ? <ShimmerText>{status}</ShimmerText> : status}
        </span>
      </span>
    </motion.button>
  );
}
