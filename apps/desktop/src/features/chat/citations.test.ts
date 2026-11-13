import { describe, expect, it } from "vitest";
import { citationOrder, linkCitations } from "./citations";

const A = "kb-0123456789";
const B = "kb-abcdefabcd";

describe("knowledge-base citations", () => {
  it("turns each cited ID into a link the renderer draws as a chip", () => {
    expect(linkCitations(`Refunds take 14 days [${A}].`)).toBe(`Refunds take 14 days [${A}](#cite-${A}).`);
  });

  it("splits several IDs in one pair of brackets, Arabic comma too", () => {
    expect(linkCitations(`نعم [${A}، ${B}]`)).toBe(`نعم [${A}](#cite-${A})[${B}](#cite-${B})`);
  });

  it("leaves text without citations and look-alikes alone", () => {
    expect(linkCitations("see [1] and [kb-xyz]")).toBe("see [1] and [kb-xyz]");
  });

  it("numbers citations by first use", () => {
    expect(citationOrder(`x [${B}] y [${A}] z [${B}]`)).toEqual([B, A]);
  });
});
