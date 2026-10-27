/**
 * Looking at versions of a design against each other:
 * - the variants the user asked for, side by side, to keep one;
 * - a reply's before and after, one over the other with a handle to slide between them;
 * - the actions under each design reply in the chat (take it back, compare it).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { t } from "../../i18n";
import { Button, DrawnCheck } from "../../components/ui";
import { MaximizeIcon, UndoIcon, XIcon, LayersIcon } from "../../components/Icons";
import type { DesignVariant } from "../../lib/types";
import { guarded, tellFrame } from "./preview";

/** A page is laid out at a desktop width and scaled down to its column — but never so far
 *  it can't be read: a narrow column gets a narrower layout (down to a phone's). */
const PAGE_WIDTH = 1280;
const PHONE_WIDTH = 390;
const MIN_SCALE = 0.42;

/** A page drawn at a real screen width and scaled down to the box it's in. */
function ScaledPage({ html, title }: { html: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.round(Math.min(PAGE_WIDTH, Math.max(PHONE_WIDTH, size.w / MIN_SCALE)));
  const scale = size.w ? Math.min(1, size.w / width) : 0;
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-xl" style={{ background: "white" }}>
      {scale > 0 && (
        <iframe
          srcDoc={guarded(html)}
          title={title}
          sandbox="allow-scripts allow-forms"
          style={{ width, height: size.h / scale, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", top: 0, left: 0 }}
        />
      )}
    </div>
  );
}

/** The variants side by side; one can be opened large, and one kept. */
export function VariantsView({
  variants,
  files,
  working,
  onChoose,
  onClose,
}: {
  variants: DesignVariant[];
  files: { name: string; html: string }[];
  /** The model is still writing them. */
  working: boolean;
  onChoose: (key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [large, setLarge] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  // The one being kept: the others fly off and it spreads over the whole space before it
  // becomes the page.
  const [kept, setKept] = useState<string | null>(null);
  const htmlOf = (v: DesignVariant) => files.find((f) => f.name === v.document)?.html ?? null;
  const focus = kept ?? large;
  const shown = focus ? variants.filter((v) => v.key === focus) : variants;

  async function keep(key: string) {
    setChoosing(key);
    setKept(key);
    try {
      await new Promise((done) => setTimeout(done, 520));
      await onChoose(key);
    } catch {
      setKept(null);
    } finally {
      setChoosing(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <LayersIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-accent)" }} />
          <span className="font-semibold">{t("النسخ البديلة")}</span>
          <span className="truncate" style={{ color: "var(--color-ink-muted)" }}>
            {working ? t("النموذج عم يكتبهم…") : t("كل وحدة باتجاه فني مختلف — اعتمد اللي بتعجبك")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {large && (
            <Button variant="ghost" onClick={() => setLarge(null)}>
              {t("رجوع للمقارنة")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("رجوع للتصميم")}
          </Button>
        </div>
      </div>
      <motion.div layout className="flex min-h-0 flex-1 gap-3 p-3" style={{ background: "var(--color-surface-2)" }}>
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((v, i) => {
            const html = htmlOf(v);
            return (
              <motion.section
                key={v.key}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: large ? 0 : i * 0.06 } }}
                exit={{ opacity: 0, scale: 0.86, y: 28, filter: "blur(4px)", transition: { duration: 0.28, ease: "easeIn" } }}
                transition={{ type: "spring", visualDuration: 0.45, bounce: 0.12 }}
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
              >
                <header className="flex items-center gap-2 px-1">
                  <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--color-surface)", color: "var(--color-ink)" }}>
                    {variants.indexOf(v) + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">
                    {v.name}
                  </span>
                  <AnimatePresence>
                    {kept === v.key && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.4 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", visualDuration: 0.35, bounce: 0.4 }}
                        className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: "var(--color-success)", color: "white" }}
                      >
                        <DrawnCheck className="h-3 w-3" />
                        {t("اعتمدتها")}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {!focus && html && (
                    <button
                      type="button"
                      onClick={() => setLarge(v.key)}
                      aria-label={t("كبّرها")}
                      title={t("كبّرها")}
                      className="rounded-full p-1.5 hover:bg-[var(--color-surface)]"
                      style={{ color: "var(--color-ink-muted)" }}
                    >
                      <MaximizeIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </header>
                {html ? (
                  <ScaledPage html={html} title={v.name} />
                ) : (
                  <div className="shimmer flex min-h-0 flex-1 items-center justify-center rounded-xl p-3 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
                    {working ? t("عم تنكتب…") : t("ما وصلت هالنسخة — اطلبها من النموذج")}
                  </div>
                )}
                <Button
                  variant="accent"
                  className="w-full justify-center"
                  disabled={!html || choosing !== null}
                  onClick={() => void keep(v.key)}
                >
                  {choosing === v.key ? t("عم يعتمد…") : t("اعتمد هاي")}
                </Button>
              </motion.section>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/**
 * Before and after a reply, one over the other: the handle reveals the new version over the
 * old. Both pages scroll together, so the same part is always under the handle.
 */
export function BeforeAfter({
  documents,
  current,
  onDocument,
  before,
  after,
  onClose,
}: {
  /** The documents the reply changed, when it changed more than one. */
  documents: string[];
  current: string;
  onDocument: (name: string) => void;
  /** The version before the reply: null when the reply made this document. */
  before: string | null;
  after: string | null;
  onClose: () => void;
}) {
  const [split, setSplit] = useState(0.5);
  const box = useRef<HTMLDivElement>(null);
  const oldFrame = useRef<HTMLIFrameElement>(null);
  const newFrame = useRef<HTMLIFrameElement>(null);
  const rtl = document.documentElement.dir === "rtl";

  // the two pages scroll as one
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { source?: string; type?: string; r?: number } | null;
      if (data?.source !== "rafiq-preview" || data.type !== "scrolled" || data.r === undefined) return;
      const other = e.source === oldFrame.current?.contentWindow ? newFrame.current : e.source === newFrame.current?.contentWindow ? oldFrame.current : null;
      tellFrame(other, { type: "scroll-to", r: data.r });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const drag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (x: number) => {
      const r = el.getBoundingClientRect();
      const share = Math.min(0.98, Math.max(0.02, (x - r.left) / r.width));
      setSplit(share);
    };
    move(e.clientX);
    const target = e.currentTarget as HTMLElement;
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  // "before" sits on the reading start, "after" on the end
  const afterClip = rtl ? `inset(0 ${100 - split * 100}% 0 0)` : `inset(0 0 0 ${split * 100}%)`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex min-w-0 items-center gap-1">
          <span className="me-1 text-xs font-semibold">{t("قبل وبعد")}</span>
          {documents.length > 1 &&
            documents.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onDocument(name)}
                className="rounded-full px-2.5 py-1 text-xs"
                style={{ background: name === current ? "var(--color-surface-2)" : "transparent", color: name === current ? "var(--color-ink)" : "var(--color-ink-muted)" }}
                dir="auto"
              >
                {name}
              </button>
            ))}
        </div>
        <Button variant="ghost" onClick={onClose}>
          <XIcon className="h-3.5 w-3.5" />
          {t("سكّر المقارنة")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 p-4" style={{ background: "var(--color-surface-2)" }}>
        {after === null ? (
          <div className="shimmer h-full rounded-xl" />
        ) : before === null ? (
          <div className="flex h-full items-center justify-center text-center text-sm" style={{ color: "var(--color-ink-muted)" }}>
            {t("هالمستند انعمل بهالرد — ما في نسخة قبله تنقارن فيها.")}
          </div>
        ) : (
          <div ref={box} className="relative h-full overflow-hidden rounded-xl" style={{ background: "white" }}>
            <iframe ref={oldFrame} srcDoc={guarded(before)} title={t("قبل")} sandbox="allow-scripts allow-forms" className="absolute inset-0 h-full w-full" style={{ border: 0 }} />
            <iframe
              ref={newFrame}
              srcDoc={guarded(after)}
              title={t("بعد")}
              sandbox="allow-scripts allow-forms"
              className="absolute inset-0 h-full w-full"
              style={{ border: 0, clipPath: afterClip, background: "white" }}
            />
            <Tag side="start">{t("قبل")}</Tag>
            <Tag side="end">{t("بعد")}</Tag>
            {/* The handle: a line with a grip; drag it anywhere along the line. */}
            <div
              role="slider"
              aria-label={t("حرّك لتقارن")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split * 100)}
              tabIndex={0}
              onPointerDown={drag}
              onKeyDown={(e) => {
                const step = (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) * 0.04;
                if (step) setSplit((s) => Math.min(0.98, Math.max(0.02, s + step)));
              }}
              className="absolute inset-y-0 z-10 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
              style={{ left: `${split * 100}%` }}
            >
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2" style={{ background: "var(--color-accent)" }} />
              <span className="relative flex h-9 w-6 items-center justify-center rounded-full shadow-lg" style={{ background: "var(--color-accent)", color: "var(--color-accent-ink)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <path d="M4.5 2 1 6l3.5 4V2Zm3 0v8L11 6 7.5 2Z" />
                </svg>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ side, children }: { side: "start" | "end"; children: React.ReactNode }) {
  return (
    <span
      className="pointer-events-none absolute top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow"
      style={{ insetInlineStart: side === "start" ? 12 : undefined, insetInlineEnd: side === "end" ? 12 : undefined, background: "var(--color-surface)", color: "var(--color-ink)" }}
    >
      {children}
    </span>
  );
}

/** Under each design reply that wrote something: take it back, or see what it changed. */
export function DesignReplyActions({ onUndo, onCompare }: { onUndo: () => Promise<void>; onCompare: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="-mt-3 flex items-center gap-1 ps-11 opacity-70 transition-opacity hover:opacity-100">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onUndo();
          } finally {
            setBusy(false);
          }
        }}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        style={{ color: "var(--color-ink-muted)" }}
        title={t("رجّع التصميم متل ما كان قبل هالرد")}
      >
        <UndoIcon className="h-3.5 w-3.5" />
        {busy ? t("عم يرجّع…") : t("رجّع")}
      </button>
      <button
        type="button"
        onClick={onCompare}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: "var(--color-ink-muted)" }}
        title={t("شوف التصميم قبل هالرد وبعده")}
      >
        <LayersIcon className="h-3.5 w-3.5" />
        {t("قبل وبعد")}
      </button>
    </div>
  );
}
