/* EasyUI (breadcrumb) by Suraj Maurya, MIT — adapted for Rafiq (router-free crumbs, theme tokens, RTL, language). See THIRD_PARTY_NOTICES.md. */
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { t } from "../../i18n";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /** Runs when the crumb is chosen; without an href the crumb is a button. */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

const spring = { type: "spring", stiffness: 500, damping: 40, mass: 0.6 } as const;

/** Points along the path: left in English, right in Arabic. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rtl:-scale-x-100" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Where the user is, as a path. A soft pill follows the pointer from crumb to crumb, and a
 * long path folds its middle into "…" until it's asked for.
 */
export function Breadcrumb({ items, ariaLabel = t("المسار"), maxItems = 4 }: { items: BreadcrumbItem[]; ariaLabel?: string; maxItems?: number }) {
  const uid = useId();
  const reduced = useReducedMotion() ?? false;
  const list = useRef<HTMLOListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const canCollapse = items.length > maxItems;
  const tail = Math.max(1, maxItems - 2);
  const hiddenTo = items.length - tail;
  const collapsed = canCollapse && !expanded;

  useEffect(() => {
    if (expanded) list.current?.querySelector<HTMLElement>("[data-revealed]")?.focus();
  }, [expanded]);

  const entries: (number | "more")[] = [];
  items.forEach((_, i) => {
    if (collapsed && i >= 1 && i < hiddenTo) {
      if (i === 1) entries.push("more");
    } else entries.push(i);
  });

  const base = "relative flex h-7 items-center rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
  const sep = (
    <span aria-hidden className="opacity-50">
      <Chevron />
    </span>
  );

  return (
    <nav aria-label={ariaLabel}>
      <ol ref={list} onMouseLeave={() => setHover(null)} className="flex flex-wrap items-center gap-x-0.5 gap-y-1" style={{ color: "var(--color-ink-muted)" }}>
        {entries.map((entry, n) => {
          if (entry === "more") {
            return (
              <motion.li key="more" layout={reduced ? false : "position"} className="flex items-center gap-0.5">
                {sep}
                <button
                  type="button"
                  aria-label={t("اعرض باقي المسار")}
                  onClick={() => setExpanded(true)}
                  className="grid h-7 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                >
                  …
                </button>
              </motion.li>
            );
          }
          const item = items[entry];
          const last = entry === items.length - 1;
          const revealed = expanded && canCollapse && entry >= 1 && entry < hiddenTo;
          const pill =
            hover === entry && !reduced ? (
              <motion.span layoutId={`${uid}-hover`} transition={spring} className="absolute inset-0 rounded-md" style={{ background: "var(--color-surface-2)" }} />
            ) : null;
          const label = <span className="relative max-w-[28ch] truncate" dir="auto">{item.label}</span>;
          const interactive = !last && (item.href || item.onClick);
          const events = {
            onMouseEnter: () => setHover(entry),
            onFocus: () => setHover(entry),
            onBlur: () => setHover(null),
            "data-revealed": revealed && entry === 1 ? "" : undefined,
          };
          return (
            <motion.li
              key={entry}
              layout={reduced ? false : "position"}
              initial={revealed && !reduced ? { opacity: 0, x: 6 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={spring}
              className="flex items-center gap-0.5"
            >
              {n > 0 && sep}
              {!interactive ? (
                <span aria-current={last ? "page" : undefined} className={`${base} ${last ? "font-medium" : ""}`} style={last ? { color: "var(--color-ink)" } : undefined}>
                  {label}
                </span>
              ) : item.href ? (
                <a href={item.href} onClick={item.onClick} className={`${base} transition-colors hover:text-[var(--color-ink)]`} {...events}>
                  {pill}
                  {label}
                </a>
              ) : (
                <button type="button" onClick={item.onClick} className={`${base} transition-colors hover:text-[var(--color-ink)]`} {...events}>
                  {pill}
                  {label}
                </button>
              )}
            </motion.li>
          );
        })}
      </ol>
    </nav>
  );
}
