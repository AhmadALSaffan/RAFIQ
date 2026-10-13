import { describePrice } from "../lib/price";
import type { ModelPrice } from "../lib/types";

/** What a model costs, small enough to sit next to its name. */
export function PriceTag({ price, className = "" }: { price: ModelPrice | null | undefined; className?: string }) {
  const text = describePrice(price);
  if (!text) return null;
  const tone = price?.kind === "free" ? "var(--color-success)" : "var(--color-ink-muted)";
  return (
    <span className={`num shrink-0 whitespace-nowrap text-[11px] ${className}`} style={{ color: tone }} title={text.long} aria-label={text.long} dir="ltr">
      {text.short}
    </span>
  );
}
