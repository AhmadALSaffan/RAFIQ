/**
 * A streamed reply revealed word by word at an even pace, instead of in the lumps the
 * network delivers. The pace adapts: a small backlog reveals a word or two a frame, a big
 * one catches up quickly, so the text never falls far behind what has arrived. When the
 * stream ends the rest appears at once. (After the "Streaming Text" component on
 * 21st.dev, written for Rafiq.)
 */

import { useEffect, useRef, useState } from "react";

/** How much of `target` to show next, from `shown` characters: whole words, never half. */
export function nextReveal(target: string, shown: number): number {
  if (shown >= target.length) return target.length;
  const backlog = target.length - shown;
  // ~2 words a frame normally; more when far behind (a quarter of the backlog's words).
  const words = Math.max(2, Math.ceil(backlog / 24));
  let at = shown;
  for (let n = 0; n < words && at < target.length; n++) {
    const space = target.slice(at).search(/\s\S/);
    at = space === -1 ? target.length : at + space + 1;
  }
  return at;
}

export function useSmoothText(target: string, live: boolean): string {
  const [shown, setShown] = useState(live ? 0 : target.length);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!live) {
      setShown(targetRef.current.length);
      return;
    }
    let frame = 0;
    const tick = () => {
      setShown((s) => {
        const t = targetRef.current;
        return s > t.length ? t.length : nextReveal(t, s);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  return live ? target.slice(0, shown) : target;
}
