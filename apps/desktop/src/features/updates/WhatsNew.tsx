/**
 * The "What's new" dialog (lib/whatsNew.ts): once, on the first launch after an update —
 * the release's video on top, its main points under it. The About page opens it again.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconCircleCheckFilled, IconExternalLink, IconSparkles, IconX } from "@tabler/icons-react";
import { getSettings, listModels } from "../../lib/api";
import { imageFor, markSeen, newsFor, OPEN_EVENT, readSeen, releaseUrl, shouldShow, videoUrl, youtubeId, type ReleaseNews } from "../../lib/whatsNew";
import { openExternal } from "../../lib/links";
import { easeOutExpo } from "../../lib/motion";
import { Button } from "../../components/ui";
import { locale, t } from "../../i18n";

export function WhatsNew() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const version = __APP_VERSION__;
  const news = newsFor(version);

  useEffect(() => {
    let alive = true;
    Promise.all([getSettings(), listModels()])
      .then(([settings, models]) => {
        if (!alive) return;
        const usedBefore = Boolean(settings.onboarded) || models.length > 0;
        const closed = readSeen();
        if (shouldShow(version, closed, usedBefore)) setOpen(true);
        // A first install starts counting from here, so its first update shows.
        else if (closed === null && !usedBefore) markSeen(version);
      })
      .catch(() => undefined);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => {
      alive = false;
      window.removeEventListener(OPEN_EVENT, reopen);
    };
  }, [version]);

  // Seen only once the user closes it themselves.
  const close = () => {
    markSeen(version);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      markSeen(version);
      setOpen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, version]);

  if (!news || ["/quick", "/lite"].includes(location.pathname)) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center p-6"
          style={{ background: "color-mix(in oklch, var(--color-bg) 72%, transparent)", backdropFilter: "blur(8px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
          role="dialog"
          aria-modal="true"
          aria-label={t("شو الجديد")}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: easeOutExpo }}
            className="relative flex max-h-[90vh] w-full max-w-[760px] flex-col overflow-hidden rounded-3xl shadow-2xl"
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
          >
            <button
              type="button"
              onClick={close}
              aria-label={t("إغلاق")}
              className="absolute end-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full transition-colors"
              style={{ background: "color-mix(in oklch, black 45%, transparent)", color: "white" }}
            >
              <IconX size={16} />
            </button>

            {imageFor(news, locale()) ? (
              <img src={imageFor(news, locale())} alt="" className="aspect-video w-full shrink-0 object-cover" draggable={false} />
            ) : (
              <Video news={news} />
            )}

            <div className="min-h-0 overflow-y-auto px-7 pb-6 pt-5">
              <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-accent)" }}>
                <IconSparkles size={14} />
                {t("الجديد بـ رفيق {0}", { 0: version })}
              </p>
              <h2 className="mt-1.5 text-2xl font-extrabold leading-snug" style={{ fontFamily: "var(--font-display)" }}>
                {news.title()}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {news.points().map((point, i) => (
                  <motion.li
                    key={point}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.05, duration: 0.3, ease: easeOutExpo }}
                    className="flex items-start gap-2.5 text-sm leading-relaxed"
                  >
                    <IconCircleCheckFilled size={18} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} />
                    <span>{point}</span>
                  </motion.li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button variant="accent" onClick={close}>
                  {t("يلا نجرّب")}
                </Button>
                <Button variant="ghost" onClick={() => void openExternal(releaseUrl(version))}>
                  <IconExternalLink size={15} />
                  {t("كل التفاصيل")}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The release's video; while it loads, a quiet placeholder; offline or missing, nothing. */
function Video({ news }: { news: ReleaseNews }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const player = useRef<HTMLVideoElement>(null);
  // A closed dialog lets its video go: an element taken off the page keeps its decoder
  // (a few hundred MB of a laptop's shared graphics memory) until it's collected.
  useEffect(() => {
    const video = player.current;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);
  const url = videoUrl(news, locale());
  const youtube = youtubeId(url);
  if (state === "failed") return null;
  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden" style={{ background: "var(--color-surface-2)" }}>
      {state === "loading" && <div className="absolute inset-0 animate-pulse" style={{ background: "var(--color-surface-2)" }} />}
      {youtube ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&mute=1&loop=1&playlist=${youtube}&rel=0&modestbranding=1`}
          title={news.title()}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={() => setState("ready")}
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <video
          ref={player}
          src={url}
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="metadata"
          onCanPlay={() => setState("ready")}
          onError={() => setState("failed")}
          className="h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: state === "ready" ? 1 : 0 }}
        />
      )}
    </div>
  );
}
