import { describe, expect, it } from "vitest";
import { offerText } from "./Suggestions";
import { firstSeats } from "../../routes/CouncilPage";

describe("offers", () => {
  it("says each offer from its numbers", () => {
    const weekly = offerText({ kind: "schedule", draft: { prompt: "p", count: 4, kind: "weekly", weekday: 6, hour: 9 } });
    expect(weekly).toContain("4");
    expect(weekly).toContain("09:00");
    const moved = offerText({ kind: "folder", draft: { prompt: "p", count: 5, watch: "C:/u/Downloads", watch_filter: "*.pdf", to_dir: "C:/u/Docs/bills" } });
    expect(moved).toContain("Downloads");
    expect(moved).toContain("bills");
    expect(moved).toContain("pdf");
    expect(moved).not.toContain("*");
    expect(offerText({ kind: "template", draft: { prompt: "p", count: 6, kind: "often" } })).toContain("6");
  });
});

describe("the council's seats", () => {
  const models = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("keeps the models used last time, as long as they're still there", () => {
    expect(firstSeats(models, ["c", "d"])).toEqual(["c", "d"]);
    expect(firstSeats(models, ["c", "gone"])).toEqual(["a", "b", "c"]);
    expect(firstSeats(models, [])).toEqual(["a", "b", "c"]);
  });
});
