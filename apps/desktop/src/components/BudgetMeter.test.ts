import { describe, expect, it } from "vitest";
import { budgetState, money } from "./BudgetMeter";

describe("budget meter", () => {
  it("has nothing to show without a limit", () => {
    expect(budgetState(3, null)).toEqual({ ratio: 0, tone: "none" });
    expect(budgetState(3, 0)).toEqual({ ratio: 0, tone: "none" });
  });

  it("warms up near the limit and turns red at it", () => {
    expect(budgetState(0.5, 1).tone).toBe("ok");
    expect(budgetState(0.85, 1).tone).toBe("near");
    expect(budgetState(1, 1).tone).toBe("over");
    expect(budgetState(2.5, 1)).toEqual({ ratio: 2.5, tone: "over" });
  });

  it("writes small amounts with enough digits to see them", () => {
    expect(money(0)).toBe("$0");
    expect(money(0.0042)).toBe("$0.0042");
    expect(money(1.5)).toBe("$1.50");
  });
});
