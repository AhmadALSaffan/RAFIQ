import { describe, expect, it } from "vitest";
import lucide from "@iconify-json/lucide/icons.json";
import ph from "@iconify-json/ph/icons.json";
import mdi from "@iconify-json/mdi/icons.json";
import heroicons from "@iconify-json/heroicons/icons.json";
import { bodyToParts } from "./icons";
import { isColourIcon } from "./iconSets";

describe("one-colour icons become paths", () => {
  it("keeps a stroked icon stroked, with its width", () => {
    const parts = bodyToParts(lucide.icons.rocket.body);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.kind === "stroke" && p.width === 2)).toBe(true);
    expect(parts[0].lines.length).toBeGreaterThan(0);
  });

  it("keeps a filled icon filled", () => {
    const parts = bodyToParts(mdi.icons.rocket.body);
    expect(parts.map((p) => p.kind)).toEqual(["fill"]);
  });

  it("carries a duotone's faint layer as opacity", () => {
    const parts = bodyToParts(ph.icons["rocket-duotone"].body);
    expect(parts.some((p) => p.opacity < 0.5)).toBe(true);
    expect(parts.some((p) => p.opacity === 1)).toBe(true);
  });

  it("reads inherited stroke settings and relative arcs", () => {
    const parts = bodyToParts(heroicons.icons["academic-cap"].body);
    expect(parts.every((p) => p.kind === "stroke" && p.width === 1.5)).toBe(true);
  });

  it("knows which sets keep their own colours", () => {
    expect(isColourIcon("fluent-emoji-flat:fire")).toBe(true);
    expect(isColourIcon("circle-flags:sa")).toBe(true);
    expect(isColourIcon("ph:rocket")).toBe(false);
    expect(isColourIcon(undefined)).toBe(false);
  });
});
