import type { Transition, Variants } from "motion/react";

export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

/** Critically damped — settles fast with no overshoot. */
export const snappy: Transition = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 };

// Movement stays small on purpose: a few pixels reads as "arrived", more reads as a jump.
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: easeOutExpo } },
};

export const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 3 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: easeOutExpo } },
  exit: { opacity: 0, x: 8, transition: { duration: 0.14, ease: "easeIn" } },
};

export const pressable = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.97 },
  transition: snappy,
};
