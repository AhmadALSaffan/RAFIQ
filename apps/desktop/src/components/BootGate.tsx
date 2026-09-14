import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { waitForBackend } from "../lib/api";
import { easeOutExpo } from "../lib/motion";
import { Logo } from "./Logo";
import { Button } from "./ui";

import { t } from "../i18n";
/**
 * The app's engine is a separate process that needs a second or two to come up — longer on
 * the first launch after an install. Without this the window opens on empty lists and looks
 * broken until the data quietly appears. So: hold the UI behind one honest loading screen,
 * and only let it through once the backend actually answers.
 */
export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    waitForBackend(controller.signal)
      .then(() => setReady(true))
      .catch(() => undefined);
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (ready) return;
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [ready]);

  const slow = elapsed >= 8;
  const stuck = elapsed >= 40;
  // Not a real percentage — it's the wait, shown honestly: fast at first, then patient.
  const progress = Math.min(95, 10 + elapsed * (elapsed < 6 ? 11 : 3));

  return (
    <>
      <AnimatePresence>
        {!ready && (
          <motion.div
            className="fixed inset-0 flex flex-col items-center justify-center gap-4"
            style={{ zIndex: "var(--z-index-modal)" as unknown as number, background: "var(--color-bg)" }}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25, ease: easeOutExpo } }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: easeOutExpo }}
            >
              <Logo className="h-14 w-14" />
            </motion.div>

            <div className="w-56">
              <div className="h-1 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "var(--color-accent)" }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <p className="mt-2.5 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
                {stuck
                  ? t("المحرك تأخّر أكتر من المتوقع.")
                  : slow
                    ? t("أول تشغيل بعد التثبيت بياخد وقت أطول شوي…")
                    : t("جارِ تشغيل محرك رفيق…")}
              </p>
            </div>

            <AnimatePresence>
              {stuck && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center gap-2"
                >
                  <p className="max-w-xs text-center text-[11px] leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
                    {t("إذا ضلّت هيك، سكّر التطبيق وافتحه من جديد. السجل بـ")}{" "}
                    <span className="font-mono" dir="ltr">
                      %APPDATA%/Rafiq/agent.log
                    </span>
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setElapsed(0);
                      setAttempt((n) => n + 1);
                    }}
                  >
                    {t("جرّب مرة ثانية")}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {ready && children}
    </>
  );
}
