import { describe, expect, it } from "vitest";
import { earlierStart, firstStart, PAGE, startIncluding, WINDOW } from "./transcriptWindow";

describe("transcript window", () => {
  it("opens a long chat on its latest messages, a short one whole", () => {
    expect(firstStart(500)).toBe(500 - WINDOW);
    expect(firstStart(WINDOW)).toBe(0);
    expect(firstStart(3)).toBe(0);
  });

  it("adds older messages a batch at a time, stopping at the first", () => {
    expect(earlierStart(460)).toBe(460 - PAGE);
    expect(earlierStart(PAGE / 2)).toBe(0);
    expect(earlierStart(0)).toBe(0);
  });

  it("reaches back to a message it has to jump to, with some context above", () => {
    expect(startIncluding(100, 460)).toBe(90);
    expect(startIncluding(4, 460)).toBe(0);
    // Already on the page: nothing changes.
    expect(startIncluding(470, 460)).toBe(460);
  });
});
