/* EasyUI (rainbow-button) by Suraj Maurya, MIT — adapted for Rafiq (theme tokens, CSS in index.css). See THIRD_PARTY_NOTICES.md. */
import { motion, type HTMLMotionProps } from "motion/react";

/**
 * The one button on a screen that should be impossible to miss: a slowly turning rainbow
 * edge with a soft glow underneath. Keep it for that one action.
 */
export function RainbowButton({ className = "", children, ...rest }: HTMLMotionProps<"button">) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      className={`rainbow-button relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
