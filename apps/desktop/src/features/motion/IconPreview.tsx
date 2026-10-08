/** An icon at button size: one-colour icons in the theme's ink, colour icons in their own. */

import { icon } from "./engine/icons";

export function IconPreview({ name }: { name: string }) {
  const shape = icon(name);
  if (!shape) return <span className="h-7 w-7 rounded" style={{ background: "var(--color-surface-2)" }} />;
  const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(shape.svg)}")`;
  // one-colour icons take the theme's ink (a mask over the text colour); colour icons are pictures
  return shape.kind === "image" ? (
    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shape.svg)}`} alt="" className="h-7 w-7" draggable={false} />
  ) : (
    <span className="h-7 w-7" style={{ background: "currentColor", WebkitMask: `${url} center / contain no-repeat`, mask: `${url} center / contain no-repeat` }} />
  );
}
