import { describe, expect, it } from "vitest";
import { chunks, languageOf, MAX_SPOKEN, speakable } from "./speech";
import { SentenceEnd, MIN_SPEECH_MS, SILENCE_MS, SPEECH_LEVEL } from "./voiceInput";

describe("reading replies out loud", () => {
  it("says the words, not the markup", () => {
    const md = "## العنوان\n\n**مهم:** شوف [الرابط](https://x.y) و `npm i`.\n\n```js\nconsole.log(1)\n```\n- أول نقطة\n> اقتباس\nhttps://example.com";
    const said = speakable(md);
    expect(said).toContain("العنوان");
    expect(said).toContain("مهم: شوف الرابط و npm i.");
    expect(said).toContain("أول نقطة");
    expect(said).not.toMatch(/[#*`>]|https?:|console/);
  });

  it("cuts a long reply at a sentence", () => {
    const long = "جملة قصيرة هون. ".repeat(600);
    const said = speakable(long);
    expect(said.length).toBeLessThanOrEqual(MAX_SPOKEN);
    expect(said.endsWith(".")).toBe(true);
  });

  it("picks the reply's language for Windows' voices", () => {
    expect(languageOf("أهلا وسهلا with a word")).toBe("ar");
    expect(languageOf("Привет, как дела")).toBe("ru");
    expect(languageOf("Hello there")).toBe("en");
  });

  it("feeds the speech engine short pieces made of whole sentences", () => {
    const pieces = chunks("أول جملة. تاني جملة! " + "ب".repeat(500), 220);
    expect(pieces[0]).toBe("أول جملة. تاني جملة!");
    expect(pieces.every((p) => p.length <= 220)).toBe(true);
    expect(pieces.join("").replace(/\s/g, "").length).toBe(("أولجملة.تانيجملة!" + "ب".repeat(500)).length);
  });
});

describe("knowing when the user stopped talking", () => {
  const feed = (end: SentenceEnd, level: number, from: number, to: number) => {
    let result: "wait" | "done" = "wait";
    for (let ms = from; ms <= to && result === "wait"; ms += 50) result = end.feed(level, ms);
    return result;
  };

  it("waits through silence before any speech", () => {
    const end = new SentenceEnd();
    expect(feed(end, 0, 0, 10_000)).toBe("wait");
    expect(end.heard).toBe(false);
  });

  it("ends a moment after speech stops, not during a short pause", () => {
    const end = new SentenceEnd();
    expect(feed(end, SPEECH_LEVEL * 2, 0, 1000)).toBe("wait");
    expect(feed(end, 0, 1050, 1050 + SILENCE_MS - 200)).toBe("wait");
    expect(feed(end, 0, 1050 + SILENCE_MS - 150, 1050 + SILENCE_MS + 200)).toBe("done");
    expect(end.heard).toBe(true);
  });

  it("ignores a click too short to be a sentence", () => {
    const end = new SentenceEnd();
    feed(end, SPEECH_LEVEL * 3, 0, MIN_SPEECH_MS - 100);
    expect(feed(end, 0, MIN_SPEECH_MS, MIN_SPEECH_MS + SILENCE_MS * 3)).toBe("wait");
  });
});
