import { describe, expect, it } from "vitest";
import { describePrice, priceRank, usd } from "./price";

describe("model prices", () => {
  it("reads like a price", () => {
    expect(usd(3)).toBe("$3");
    expect(usd(0.3)).toBe("$0.30");
    expect(usd(1.25)).toBe("$1.25");
    expect(usd(0.075)).toBe("$0.075");
    expect(usd(15)).toBe("$15");
    expect(usd(0)).toBe("$0");
  });

  it("says input / output, and what each kind means", () => {
    expect(describePrice({ kind: "paid", input: 3, output: 15 })?.short).toBe("$3 / $15");
    expect(describePrice({ kind: "paid", input: 3, output: 15, cached_input: 0.3 })?.long).toContain("$0.30");
    expect(describePrice({ kind: "unknown", input: null, output: null })).toBeNull();
    expect(describePrice(null)).toBeNull();
    expect(describePrice({ kind: "free", input: 0, output: 0 })?.short).toBeTruthy();
  });

  it("orders cheapest first, with unknown prices last", () => {
    const list = [
      { id: "unknown", p: { kind: "unknown" as const, input: null, output: null } },
      { id: "sonnet", p: { kind: "paid" as const, input: 3, output: 15 } },
      { id: "flash", p: { kind: "paid" as const, input: 0.3, output: 1.2 } },
      { id: "local", p: { kind: "free" as const, input: 0, output: 0 } },
    ];
    expect(list.sort((a, b) => priceRank(a.p) - priceRank(b.p)).map((x) => x.id)).toEqual(["local", "flash", "sonnet", "unknown"]);
  });
});
