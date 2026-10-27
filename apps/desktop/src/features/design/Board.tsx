/**
 * An app design on a board: the identity sheet, then every screen in a phone frame, laid out
 * side by side in the order of the user's journey. Drag the background to move, Ctrl+wheel
 * (or the buttons) to zoom; a button in a screen that links to another one brings it into
 * view. The screens stay live — they scroll, animate and answer the pointer.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { t } from "../../i18n";
import { PickIcon } from "../../components/Icons";
import { boardItems, framed, PHONE, screenFor, SHEET_WIDTH, STATUS_BAR_SVG, type BoardItem } from "./boardLayout";
import { PickComposer, PickHint, usePicker } from "./PickComposer";

const GAP = 72;
const PAD = 96;

export function Board({
  title,
  files,
  dir,
  nonce,
  onAsk,
}: {
  title: string;
  files: { name: string; html: string }[];
  dir: "rtl" | "ltr";
  nonce: number;
  /** Send a request about a picked part to the design chat. */
  onAsk?: (text: string) => void;
}) {
  const items = useMemo(() => boardItems(files), [files]);
  const sheets = items.filter((i) => i.kind === "brand");
  const screens = items.filter((i) => i.kind === "screen");
  const view = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ s: 0.5, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const fitted = useRef(false);
  // Picking parts of the screens to ask about (one request for all of them).
  const picker = usePicker(
    () => frames.current,
    (id) => items.find((i) => i.id === id)?.label ?? id,
  );
  const pickingOn = picker.picking || picker.items.length > 0;

  const fit = useCallback(() => {
    const v = view.current;
    const b = board.current;
    if (!v || !b) return;
    const w = b.scrollWidth;
    const h = b.scrollHeight;
    // the zoom bar sits at the bottom: the board fits above it
    const room = v.clientHeight - 64;
    const s = Math.min(1, v.clientWidth / w, room / h);
    setCam({ s, x: (v.clientWidth - w * s) / 2, y: Math.max(0, (room - h * s) / 2) });
  }, []);

  // the whole board in view the first time it has something on it
  useLayoutEffect(() => {
    if (fitted.current || !items.length) return;
    fitted.current = true;
    fit();
  }, [fit, items.length]);

  const zoomAt = useCallback((k: number, cx: number, cy: number) => {
    setCam((c) => {
      const s = Math.min(2, Math.max(0.08, c.s * k));
      return { s, x: cx - (cx - c.x) * (s / c.s), y: cy - (cy - c.y) * (s / c.s) };
    });
  }, []);

  // the wheel: Ctrl zooms at the pointer, otherwise the board moves (React's wheel is passive)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setCam((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // what the screens say: an identity sheet's height, and a link to another screen
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { source?: string; type?: string; h?: number; page?: string } | null;
      const from = [...frames.current.entries()].find(([, f]) => f.contentWindow === e.source)?.[0];
      if (!from || !data) return;
      if (data.source === "rafiq-board" && data.type === "height" && data.h) {
        setHeights((all) => ({ ...all, [from]: Math.max(400, Math.min(6000, data.h!)) }));
      }
      // a drag inside a screen where nothing scrolls moves the board
      if (data.source === "rafiq-board" && data.type === "pan") {
        const pan = data as { dx?: number; dy?: number };
        setCam((c) => ({ ...c, x: c.x + (pan.dx ?? 0) * c.s, y: c.y + (pan.dy ?? 0) * c.s }));
      }
      if (data.source === "rafiq-preview" && data.type === "missing" && data.page) {
        const target = screenFor(items, data.page);
        if (target) bringIntoView(target.id);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [items]);

  function bringIntoView(id: string) {
    const v = view.current;
    const el = board.current?.querySelector<HTMLElement>(`[data-board-id="${CSS.escape(id)}"]`);
    if (!v || !el) return;
    const vr = v.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setCam((c) => ({ ...c, x: c.x + vr.left + vr.width / 2 - (r.left + r.width / 2), y: c.y + vr.top + vr.height / 2 - (r.top + r.height / 2) }));
    setFocus(id);
    window.setTimeout(() => setFocus((f) => (f === id ? null : f)), 1400);
  }

  const frameRef = (id: string) => (el: HTMLIFrameElement | null) => {
    if (el) frames.current.set(id, el);
    else frames.current.delete(id);
  };

  if (!items.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs" style={{ color: "var(--color-ink-muted)" }}>
        {t("الشاشات بتطلع هون على لوحة وحدة، كل شاشة بإطار جوال، أول ما النموذج يكتبها.")}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 select-none overflow-hidden">
      <div
        ref={view}
        className="absolute inset-0"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          backgroundColor: "var(--color-surface-2)",
          backgroundImage: "radial-gradient(color-mix(in oklch, var(--color-ink) 16%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * cam.s}px ${24 * cam.s}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("iframe")) return;
          const start = { px: e.clientX, py: e.clientY, x: cam.x, y: cam.y };
          setDragging(true);
          const move = (ev: PointerEvent) => setCam((c) => ({ ...c, x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py }));
          const up = () => {
            setDragging(false);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <div
          ref={board}
          dir={dir}
          className="absolute left-0 top-0 flex flex-col"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`, transformOrigin: "0 0", padding: PAD, gap: GAP, width: "max-content" }}
        >
          <header>
            <h2 className="text-[44px] font-extrabold leading-none tracking-tight" style={{ color: "var(--color-ink)" }} dir="auto">
              {title}
            </h2>
            <p className="mt-2 text-base" style={{ color: "var(--color-ink-muted)" }}>
              {t("{0} شاشة", { 0: screens.length })}
            </p>
          </header>
          {sheets.length > 0 && (
            <div className="flex items-start" style={{ gap: GAP }}>
              {sheets.map((item) => (
                <Card key={item.id} item={item} focused={focus === item.id}>
                  <iframe
                    ref={frameRef(item.id)}
                    key={nonce}
                    srcDoc={framed(item.html)}
                    title={item.label}
                    sandbox="allow-scripts allow-forms"
                    onLoad={(e) => picker.onFrameLoad(e.currentTarget, item.id)}
                    className="block rounded-[20px]"
                    style={{ width: SHEET_WIDTH, height: heights[item.id] ?? 900, border: 0, background: "white", pointerEvents: dragging ? "none" : undefined }}
                  />
                </Card>
              ))}
            </div>
          )}
          <div className="flex items-start" style={{ gap: GAP }}>
            {screens.map((item, n) => (
              <Card key={item.id} item={item} index={n} focused={focus === item.id}>
                <Phone>
                  <iframe
                    ref={frameRef(item.id)}
                    key={nonce}
                    srcDoc={framed(item.html)}
                    title={item.label}
                    sandbox="allow-scripts allow-forms"
                    onLoad={(e) => picker.onFrameLoad(e.currentTarget, item.id)}
                    className="block"
                    style={{ width: PHONE.width, height: PHONE.height, border: 0, borderRadius: PHONE.screenRadius, background: "white", pointerEvents: dragging ? "none" : undefined }}
                  />
                </Phone>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {picker.picking && !picker.items.length && (
          <div key="hint" className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <PickHint board />
          </div>
        )}
        {picker.items.length > 0 && onAsk && (
          <div key="composer" className="absolute inset-x-0 bottom-14 flex justify-center">
            <PickComposer picker={picker} onSend={onAsk} />
          </div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1 shadow-lg" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }} dir="ltr">
        {onAsk && (
          <>
            <button
              type="button"
              onClick={() => (pickingOn ? picker.reset() : picker.start())}
              aria-pressed={pickingOn}
              title={t("حدد أجزاء من الشاشات واطلب تعديلها")}
              className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors hover:bg-[var(--color-surface-2)]"
              style={pickingOn ? { background: "var(--color-accent)", color: "var(--color-accent-ink)" } : { color: "var(--color-ink)" }}
            >
              <PickIcon className="h-3.5 w-3.5" />
              {t("حدد وعدّل")}
            </button>
            <span className="mx-0.5 h-4 w-px" style={{ background: "var(--color-border)" }} />
          </>
        )}
        <ZoomButton label={t("صغّر")} onClick={() => view.current && zoomAt(0.8, view.current.clientWidth / 2, view.current.clientHeight / 2)}>
          −
        </ZoomButton>
        <ZoomButton label={t("اللوحة كلها")} onClick={fit} wide>
          {Math.round(cam.s * 100)}%
        </ZoomButton>
        <ZoomButton label={t("كبّر")} onClick={() => view.current && zoomAt(1.25, view.current.clientWidth / 2, view.current.clientHeight / 2)}>
          +
        </ZoomButton>
      </div>
    </div>
  );
}

function Card({ item, index, focused, children }: { item: BoardItem; index?: number; focused: boolean; children: React.ReactNode }) {
  return (
    <figure className="m-0 flex flex-col gap-3.5" data-board-id={item.id}>
      <figcaption className="text-[15px]" style={{ color: "var(--color-ink-muted)" }} dir="auto">
        {index !== undefined && (
          <b className="num me-1.5" style={{ color: "var(--color-ink)" }}>
            {String(index + 1).padStart(2, "0")}
          </b>
        )}
        {item.label}
      </figcaption>
      <motion.div
        animate={{ boxShadow: focused ? "0 0 0 6px var(--color-accent)" : "0 0 0 0px transparent" }}
        transition={{ duration: 0.3 }}
        style={{ borderRadius: item.kind === "screen" ? PHONE.radius : 20 }}
      >
        {children}
      </motion.div>
    </figure>
  );
}

/** A phone around a screen: the frame, the island, the status bar and the home indicator
 *  (white, blended to show on any screen). */
function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative"
      style={{
        width: PHONE.width + PHONE.bezel * 2,
        height: PHONE.height + PHONE.bezel * 2,
        padding: PHONE.bezel,
        borderRadius: PHONE.radius,
        background: "#0c0c0d",
        boxShadow: "inset 0 0 0 2px #2b2b2e, 0 40px 90px -40px rgba(0,0,0,.6)",
      }}
    >
      {children}
      <div
        className="pointer-events-none absolute flex items-center justify-between"
        style={{ top: PHONE.bezel, left: PHONE.bezel, right: PHONE.bezel, height: 54, padding: "0 30px 0 38px", color: "#fff", mixBlendMode: "difference", font: "600 16px/1 -apple-system, 'SF Pro Text', system-ui, sans-serif" }}
        dir="ltr"
      >
        <span>9:41</span>
        <span dangerouslySetInnerHTML={{ __html: STATUS_BAR_SVG }} />
      </div>
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[20px]" style={{ top: PHONE.bezel + 11, width: 124, height: 36, background: "#000" }} />
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full" style={{ bottom: PHONE.bezel + 8, width: 134, height: 5, background: "#fff", mixBlendMode: "difference" }} />
    </div>
  );
}

function ZoomButton({ label, onClick, wide, children }: { label: string; onClick: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`num h-7 rounded-full text-xs transition-colors hover:bg-[var(--color-surface-2)] ${wide ? "min-w-14 px-2" : "w-8"}`}
      style={{ color: "var(--color-ink)" }}
    >
      {children}
    </button>
  );
}
