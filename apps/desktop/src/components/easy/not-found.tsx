/* EasyUI (not-found) by Suraj Maurya, MIT — adapted for Rafiq (an error screen too, theme tokens, RTL, language). See THIRD_PARTY_NOTICES.md. */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

const SPRINGS = [
  { stiffness: 280, damping: 24, mass: 0.6 },
  { stiffness: 220, damping: 20, mass: 0.8 },
  { stiffness: 300, damping: 26, mass: 0.55 },
];
const gentle = { type: "spring", stiffness: 170, damping: 26, mass: 0.9 } as const;

/** One big character that leans away from the pointer and springs back. */
function Digit({ char, index, area, reduced }: { char: string; index: number; area: React.RefObject<HTMLElement | null>; reduced: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const cfg = SPRINGS[index % SPRINGS.length];
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rrx = useMotionValue(0);
  const rry = useMotionValue(0);
  const rrz = useMotionValue(0);
  const rs = useMotionValue(1);
  const x = useSpring(rx, cfg);
  const y = useSpring(ry, cfg);
  const rotateX = useSpring(rrx, cfg);
  const rotateY = useSpring(rry, cfg);
  const rotateZ = useSpring(rrz, cfg);
  const scale = useSpring(rs, { stiffness: 400, damping: 25 });

  const reset = useCallback(() => {
    for (const v of [rx, ry, rrx, rry, rrz]) v.set(0);
    rs.set(1);
  }, [rx, ry, rrx, rry, rrz, rs]);

  useEffect(() => {
    const node = el.current;
    if (!node || reduced) return;
    const move = (e: Event) => {
      const { x: px, y: py } = (e as CustomEvent<{ x: number; y: number }>).detail;
      const box = area.current?.getBoundingClientRect();
      const own = node.getBoundingClientRect();
      if (!box) return;
      const dx = own.left + own.width / 2 - box.left - px;
      const dy = own.top + own.height / 2 - box.top - py;
      const d = Math.hypot(dx, dy) || 1;
      const radius = 200;
      if (d >= radius) return reset();
      const f = Math.pow((radius - d) / radius, 1.4);
      rx.set((dx / d) * f * 30);
      ry.set((dy / d) * f * 30);
      rrx.set((-dy / radius) * f * 14);
      rry.set((dx / radius) * f * 14);
      rrz.set((dx / radius) * f * 6);
      rs.set(1 + f * 0.03);
    };
    node.addEventListener("nf:move", move);
    node.addEventListener("nf:leave", reset);
    return () => {
      node.removeEventListener("nf:move", move);
      node.removeEventListener("nf:leave", reset);
    };
  }, [area, reduced, reset, rx, ry, rrx, rry, rrz, rs]);

  return (
    <motion.div
      ref={el}
      data-nf-digit
      onClick={() => {
        if (reduced) return;
        ry.set(-16);
        rrz.set((index % 2 ? -1 : 1) * 6);
        rs.set(1.06);
        setTimeout(reset, 180);
      }}
      style={reduced ? undefined : { x, y, rotateX, rotateY, rotateZ, scale, transformStyle: "preserve-3d" }}
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...gentle, delay: index * 0.05 }}
      className="inline-flex cursor-pointer select-none px-1 sm:px-2"
      aria-hidden
    >
      <span className="num pointer-events-none text-8xl font-bold tracking-tighter md:text-9xl" style={{ color: "var(--color-ink)" }}>
        {char}
      </span>
    </motion.div>
  );
}

/**
 * A page that isn't there, or one that broke: big characters that lean away from the
 * pointer, a plain sentence about what happened, and the way back.
 */
export function NotFound({ code, badge, title, description, children }: { code: string; badge?: string; title: string; description?: string; children?: ReactNode }) {
  const area = useRef<HTMLElement>(null);
  const reduced = useReducedMotion() ?? false;
  const send = (name: string, detail?: { x: number; y: number }) =>
    area.current?.querySelectorAll("[data-nf-digit]").forEach((d) => d.dispatchEvent(new CustomEvent(name, { detail })));

  return (
    <section
      ref={area}
      onPointerMove={(e) => {
        if (reduced || !area.current) return;
        const box = area.current.getBoundingClientRect();
        send("nf:move", { x: e.clientX - box.left, y: e.clientY - box.top });
      }}
      onPointerLeave={() => !reduced && send("nf:leave")}
      className="relative mx-auto flex w-full max-w-xl flex-col items-center justify-center py-10 text-center"
      aria-labelledby="not-found-title"
    >
      {badge && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={gentle}
          className="num mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-widest"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink-muted)" }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-accent)" }} aria-hidden />
          <span dir="ltr">{badge}</span>
        </motion.div>
      )}
      <div dir="ltr" className="my-2 flex items-center justify-center gap-1 [perspective:1000px] sm:gap-2" aria-hidden>
        {Array.from(code).map((c, i) => (
          <Digit key={`${c}-${i}`} char={c} index={i} area={area} reduced={reduced} />
        ))}
      </div>
      <motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...gentle, delay: 0.12 }} className="mx-auto mt-6 max-w-sm space-y-2">
        <h1 id="not-found-title" className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          {title}
        </h1>
        {description && (
          <p className="text-sm leading-relaxed" style={{ color: "var(--color-ink-muted)" }} dir="auto">
            {description}
          </p>
        )}
      </motion.div>
      {children && (
        <motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...gentle, delay: 0.18 }} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {children}
        </motion.div>
      )}
    </section>
  );
}
