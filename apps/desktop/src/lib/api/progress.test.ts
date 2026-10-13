// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestCount, quietly, request } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("the progress bar's request count", () => {
  it("counts what the user waits on, not the app's own background checks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })));
    const seen: number[] = [];
    const stop = onRequestCount((n) => seen.push(n));

    await quietly(() => request("/tasks"));
    expect(Math.max(...seen)).toBe(0); // a poll never lights the bar

    await request("/tasks");
    expect(Math.max(...seen)).toBe(1); // a real load does
    expect(seen[seen.length - 1]).toBe(0);
    stop();
  });
});
