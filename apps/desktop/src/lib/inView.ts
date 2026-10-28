import { useEffect, useState, type RefObject } from "react";

/** Whether the element is on screen (or within `margin` of it): live previews mount only then,
 *  so a long chat or a full designs page doesn't run every design at once. */
export function useInView(ref: RefObject<Element | null>, margin = "200px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin]);
  return inView;
}
