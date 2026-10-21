import { describe, expect, it } from "vitest";
import { isolatedRuns, lineDirs, noteHeadings, wordsDir } from "./noteBidi";

const runsOf = (text: string, dir: "rtl" | "ltr" = "rtl") => isolatedRuns(text, dir).map((r) => text.slice(r.from, r.to));

describe("line direction", () => {
  it("follows the words, not the first letter", () => {
    expect(wordsDir("React بيشتغل مع Tauri بشكل ممتاز")).toBe("rtl");
    expect(wordsDir("Next.js بيشتغل مع React")).toBe("rtl");
    expect(wordsDir("Meeting with أحمد tomorrow at noon")).toBe("ltr");
    expect(wordsDir("- [ ] `npm run build`")).toBeNull();
    expect(wordsDir("اشتغلت على Tauri و React و TypeScript")).toBe("rtl");
  });

  it("keeps code left to right and carries a direction over blank lines", () => {
    const lines = ["# ملاحظاتي", "", "```js", "const x = 1;", "```", "Install it first", "---"];
    expect(lineDirs(lines, "ltr")).toEqual(["rtl", "rtl", "ltr", "ltr", "ltr", "ltr", "ltr"]);
  });
});

describe("isolated phrases", () => {
  it("keeps an English phrase together, with its numbers", () => {
    expect(runsOf("استخدمت React Native 0.76 مع Expo.")).toEqual(["React Native 0.76", "Expo"]);
    expect(runsOf("ثبّت Windows 11 و Office")).toEqual(["Windows 11", "Office"]);
    expect(runsOf("حجم التطبيق صار 8 MB بس")).toEqual(["8 MB"]);
    expect(runsOf("عندي 2024 سيارة")).toEqual([]);
  });

  it("brings the symbols stuck to a word, not the sentence's punctuation", () => {
    expect(runsOf("بتعلم C++ هلق")).toEqual(["C++"]);
    expect(runsOf("ربط الـ API تبع الواجهة")).toEqual(["API"]);
    expect(runsOf("مراجعة الكود مع @ahmad قبل الـ release.")).toEqual(["@ahmad", "release"]);
    expect(runsOf("راسل @ahmad و #tag، شكراً")).toEqual(["@ahmad", "#tag"]);
    expect(runsOf("شغل على **React** Native بسرعة")).toEqual(["**React** Native"]);
  });

  it("keeps brackets with the side that opened them", () => {
    expect(runsOf("مكتبة (Tauri) ممتازة")).toEqual(["Tauri"]);
    expect(runsOf("نسخة Tauri (beta) جديدة")).toEqual(["Tauri (beta)"]);
    expect(runsOf("اقرأ [React](https://react.dev) أول")).toEqual(["[React](https://react.dev)"]);
    expect(runsOf("React (نسخة 18) حلوة")).toEqual(["React"]);
  });

  it("isolates Arabic inside an English line too", () => {
    expect(runsOf("Meeting with أحمد السفان at 10", "ltr")).toEqual(["أحمد السفان"]);
  });

  it("counts offsets in UTF-16, like the editor", () => {
    const text = "😀 كلام English";
    const [run] = isolatedRuns(text, "rtl");
    expect(text.slice(run.from, run.to)).toBe("English");
  });
});

describe("outline", () => {
  it("lists headings outside code", () => {
    expect(noteHeadings("# أ\nنص\n```\n# not\n```\n## **ب**")).toEqual([
      { line: 0, level: 1, text: "أ" },
      { line: 5, level: 2, text: "ب" },
    ]);
  });
});
