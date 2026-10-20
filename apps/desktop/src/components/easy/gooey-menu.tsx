/* EasyUI (gooey-menu) by Suraj Maurya, MIT — adapted for Rafiq (options with icons, an overlay that doesn't push the page, theme tokens, RTL, language). See THIRD_PARTY_NOTICES.md. */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export interface GooeyOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

const PILL_H = 40;
const GAP = 8;
const ROW_H = 38;
const PAD = 6;
const MAX_ROWS = 7;

const DROP = { type: "spring", stiffness: 240, damping: 17, mass: 1 } as const;
const GROW = { type: "spring", stiffness: 210, damping: 22, mass: 1 } as const;
const SNAP = { type: "spring", stiffness: 240, damping: 20, mass: 0.9 } as const;
const ROW = { type: "spring", stiffness: 420, damping: 26 } as const;

/**
 * A pill that pours down into its list: the panel is drawn as one liquid blob with the pill
 * (an SVG metaball filter) and springs back up when an option is chosen. The list floats
 * over the page, so opening it moves nothing else.
 */
export function GooeyMenu({
  options,
  value,
  onChange,
  placeholder,
  width = 260,
  ariaLabel,
  empty,
  footer,
}: {
  options: GooeyOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  width?: number;
  ariaLabel: string;
  /** Shown in the list when there are no options. */
  empty?: string;
  /** Something below the options (a setting for the chosen one); the liquid grows to fit it. */
  footer?: ReactNode;
}) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLLIElement>(null);
  const [footH, setFootH] = useState(0);

  useEffect(() => {
    const node = foot.current;
    if (!open || !node) return;
    const measure = () => setFootH(node.offsetHeight);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open, options, value]);

  const rows = Math.max(1, Math.min(options.length, MAX_ROWS));
  const panelH = rows * ROW_H + PAD * 2 + (footer ? footH + 4 : 0);
  const panelY = PILL_H + GAP;

  function choose(i: number) {
    const option = options[i];
    if (option) onChange(option.id);
    setOpen(false);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % Math.max(1, options.length));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    }
  }

  // A surface in both themes, so every brand mark — dark ones and white ones — stays visible.
  const fill = { background: "var(--color-surface-2)" };
  return (
    <div ref={box} className="relative select-none" style={{ width, height: PILL_H }}>
      <svg width="0" height="0" aria-hidden className="absolute">
        <defs>
          <filter id={`goo-${uid}`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -14" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* The liquid: the pill and the panel, blurred together into one shape. */}
      <div className="pointer-events-none absolute start-0 top-0 z-30" style={{ width, height: panelY + panelH, filter: reduced ? undefined : `url(#goo-${uid})`, isolation: "isolate" }}>
        <div className="absolute start-0 top-0" style={{ ...fill, width, height: PILL_H, borderRadius: PILL_H / 2 }} />
        <motion.div
          className="absolute start-0 top-0"
          style={{ ...fill, width, height: panelH, borderRadius: 18, transformOrigin: "50% 0%" }}
          initial={false}
          animate={open ? { y: panelY, scaleY: 1, opacity: 1 } : { y: 0, scaleY: PILL_H / panelH, opacity: reduced ? 0 : 1 }}
          transition={reduced ? { duration: 0 } : open ? { y: DROP, scaleY: { ...GROW, delay: 0.05 } } : { y: SNAP, scaleY: SNAP }}
        />
      </div>

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className="absolute start-0 top-0 z-40 flex items-center justify-between gap-2 px-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        style={{ width, height: PILL_H, borderRadius: PILL_H / 2, color: "var(--color-ink)" }}
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
          {current?.icon}
          <span className="truncate">{current?.label ?? placeholder}</span>
        </span>
        <motion.svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" animate={{ rotate: open ? 180 : 0 }} className="shrink-0 opacity-70">
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={options[active] ? `${uid}-${active}` : undefined}
            className="absolute start-0 z-40 m-0 list-none overflow-y-auto p-0"
            style={{ top: panelY, width, maxHeight: panelH, paddingBlock: PAD, color: "var(--color-ink)" }}
            initial="closed"
            animate="open"
            exit="closed"
            variants={{
              open: { transition: { staggerChildren: 0.03, delayChildren: 0.1 } },
              closed: { transition: { staggerChildren: 0.012, staggerDirection: -1 } },
            }}
          >
            {options.length === 0 && empty && (
              <li className="mx-1.5 flex items-center px-3 text-[13px] opacity-70" style={{ height: ROW_H }}>
                {empty}
              </li>
            )}
            {options.map((option, i) => (
              <motion.li
                key={option.id}
                id={`${uid}-${i}`}
                role="option"
                aria-selected={option.id === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                variants={{ open: { opacity: 1, y: 0, transition: ROW }, closed: { opacity: 0, y: -8, transition: SNAP } }}
                className="mx-1.5 flex cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] transition-colors"
                style={{ height: ROW_H, background: i === active ? "color-mix(in oklch, var(--color-ink) 8%, transparent)" : "transparent" }}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.id === value && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />}
              </motion.li>
            ))}
            {footer && (
              <li ref={foot} className="mx-1.5 mt-1 border-t pt-1" style={{ borderColor: "color-mix(in oklch, var(--color-ink) 12%, transparent)" }}>
                {footer}
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
