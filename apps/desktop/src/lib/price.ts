import { t } from "../i18n";
import type { ModelPrice } from "./types";

/** Dollars, as people read prices: $3, $0.30, $1.25, $0.075. */
export function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.1) return `$${Number(value.toPrecision(2))}`;
  if (value < 10) return `$${value.toFixed(2).replace(/\.00$/, "")}`;
  return `$${Math.round(value * 10) / 10}`;
}

/** The short form (input → output) and the sentence a tooltip or screen reader gets. */
export function describePrice(price: ModelPrice | null | undefined): { short: string; long: string } | null {
  if (!price || price.kind === "unknown") return null;
  if (price.kind === "free") return { short: t("مجاني"), long: t("مجاني — بيشتغل على جهازك.") };
  if (price.kind === "subscription") return { short: t("ضمن الاشتراك"), long: t("ضمن اشتراكك، بدون كلفة لكل توكن.") };
  if (price.input == null || price.output == null) return null;
  const cached = price.cached_input != null ? t(" (المتكرر من المحادثة: {0})", { 0: usd(price.cached_input) }) : "";
  return {
    short: `${usd(price.input)} / ${usd(price.output)}`,
    long: t("لكل مليون توكن: اللي بتبعته {0}{1}، واللي بيكتبه {2}.", { 0: usd(price.input), 1: cached, 2: usd(price.output) }),
  };
}

/** For "cheapest first": what a typical turn weighs (it reads more than it writes). */
export function priceRank(price: ModelPrice | null | undefined): number {
  if (!price) return Number.POSITIVE_INFINITY;
  if (price.kind === "free" || price.kind === "subscription") return 0;
  if (price.kind === "unknown" || price.input == null || price.output == null) return Number.POSITIVE_INFINITY;
  return price.input * 3 + price.output;
}
