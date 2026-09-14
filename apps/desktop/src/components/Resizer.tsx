import { useRef, useState } from "react";

import { t } from "../i18n";
/**
 * The drag handle between two columns. The app is RTL, so a drag to the left has to make a
 * right-hand column *wider* — hence the direction factor read off the document.
 */
export function Resizer({
  value,
  min,
  max,
  onChange,
  label,
  onDoubleClick,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  label: string;
  onDoubleClick?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: 0 });

  function begin(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: value };
    setDragging(true);
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const delta = (e.clientX - start.current.x) * (rtl ? -1 : 1);
    onChange(Math.min(max, Math.max(min, start.current.width + delta)));
  }

  function end(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        // In RTL, ArrowLeft grows the column that sits to the handle's right.
        const step = e.shiftKey ? 32 : 8;
        if (e.key === "ArrowLeft") onChange(Math.min(max, value + step));
        else if (e.key === "ArrowRight") onChange(Math.max(min, value - step));
        else return;
        e.preventDefault();
      }}
      title={t("{0} — اسحب للتحكم، أو دبل كليك للرجوع للافتراضي", { 0: label })}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none"
      style={{ cursor: "col-resize" }}
    >
      <span
        className="pointer-events-none absolute inset-y-0 start-1/2 w-px -translate-x-1/2 transition-colors duration-150 group-hover:bg-[var(--color-accent)] group-focus-visible:bg-[var(--color-accent)]"
        style={{ background: dragging ? "var(--color-accent)" : "transparent" }}
      />
    </div>
  );
}
