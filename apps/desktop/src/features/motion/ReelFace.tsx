/**
 * A reel's card face outside its project: the still the project saved of itself, or, before
 * it was ever opened in this version of the app, a plain face with its shape and length.
 * Nothing here loads the engine.
 */

import { MovieIcon } from "../../components/Icons";
import { t } from "../../i18n";
import { posterFor } from "./posters";

export function ReelFace({ id, width, height, duration, className = "" }: { id: string; width?: number; height?: number; duration?: number; className?: string }) {
  const poster = posterFor(id);
  if (poster) {
    return <img src={poster} alt="" draggable={false} className={`absolute inset-0 h-full w-full object-contain ${className}`} />;
  }
  const portrait = width && height ? height > width : false;
  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${className}`} style={{ color: "var(--color-ink-muted)" }}>
      <span
        className="grid place-items-center rounded-lg border"
        style={{ borderColor: "var(--color-border)", width: portrait ? 34 : 56, height: portrait ? 56 : 34, color: "var(--color-accent)" }}
      >
        <MovieIcon className="h-4 w-4" />
      </span>
      {width && height ? (
        <span className="num text-[11px]" dir="ltr">
          {width}×{height}
          {duration ? ` · ${t("{0} ث", { 0: Math.round(duration) })}` : ""}
        </span>
      ) : null}
    </div>
  );
}
