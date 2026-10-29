/**
 * "Ask about my screen": the picture of the screen, shown full size over that same screen,
 * where the user drags out the part they mean. Enter takes the whole screen, Esc gives up.
 * The part comes back as a PNG, cut from the full-resolution picture.
 */

import { useEffect, useRef, useState } from "react";
import { pickedArea, type Area } from "../lib/quickAsk";
import { t } from "../i18n";

export function ScreenPicker({ src, onPick, onCancel }: { src: string; onPick: (png: Blob) => void; onCancel: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [area, setArea] = useState<Area | null>(null);

  async function cut(part: Area | null) {
    const el = img.current;
    if (!el || !el.naturalWidth) return;
    const box = el.getBoundingClientRect();
    const scale = el.naturalWidth / box.width;
    const whole = { x: 0, y: 0, width: box.width, height: box.height };
    const r = part ?? whole;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(r.width * scale));
    canvas.height = Math.max(1, Math.round(r.height * scale));
    canvas.getContext("2d")?.drawImage(el, r.x * scale, r.y * scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && onPick(blob), "image/png");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void cut(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const point = (e: React.PointerEvent) => {
    const box = img.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  return (
    <div
      className="fixed inset-0 select-none"
      style={{ cursor: "crosshair", zIndex: 50, background: "#000" }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = point(e);
        setStart(p);
        setArea({ x: p.x, y: p.y, width: 0, height: 0 });
      }}
      onPointerMove={(e) => start && setArea(pickedArea(start, point(e)))}
      onPointerUp={(e) => {
        if (!start) return;
        const picked = pickedArea(start, point(e));
        setStart(null);
        // A click without a drag means "all of it".
        void cut(picked.width < 8 || picked.height < 8 ? null : picked);
      }}
    >
      <img ref={img} src={src} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
      {/* Everything but the chosen part is dimmed. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id="rafiq-pick">
            <rect width="100%" height="100%" fill="white" />
            {area && <rect x={area.x} y={area.y} width={area.width} height={area.height} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#rafiq-pick)" />
        {area && area.width > 0 && (
          <rect x={area.x} y={area.y} width={area.width} height={area.height} fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray="6 4" />
        )}
      </svg>
      {!start && (
        <div
          className="pointer-events-none absolute start-1/2 top-6 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg rtl:translate-x-1/2"
          style={{ background: "rgba(20,20,22,0.85)", color: "#fff" }}
        >
          {t("اسحب لتحدد الجزء اللي بدك تسأل عنه · Enter للشاشة كلها · Esc للإلغاء")}
        </div>
      )}
    </div>
  );
}
