import { describe, expect, it } from "vitest";
import { fieldDir, isolate, isolateMentions, LRI, PDI, splitTokens, stripBidi } from "./bidi";

describe("mentions in Arabic text", () => {
  it("wraps a mention in isolate characters", () => {
    expect(isolate("@src/api.ts")).toBe(`${LRI}@src/api.ts${PDI}`);
  });

  it("strips the invisible characters before the text is sent", () => {
    expect(stripBidi(`شوف ${isolate("@a.ts")} هون`)).toBe("شوف @a.ts هون");
  });

  it("splits text into plain chunks and tokens", () => {
    const chunks = splitTokens("شوف @src/api.ts و #RAF-12 هون");
    expect(chunks.filter((c) => c.token).map((c) => c.text)).toEqual(["@src/api.ts", "#RAF-12"]);
  });

  it("treats a leading slash command as a token", () => {
    expect(splitTokens("/لخّص")[0]).toEqual({ text: "/لخّص", token: true });
  });

  it("isolates mentions in markdown prose", () => {
    const out = isolateMentions("عدّل @src/api.ts اليوم");
    expect(out).toContain(`${LRI}@src/api.ts${PDI}`);
  });

  it("leaves code spans alone so copied code stays clean", () => {
    const out = isolateMentions("شوف `npm i @scope/pkg` وبعدين @file.ts");
    expect(out).toContain("`npm i @scope/pkg`");
    expect(out).toContain(`${LRI}@file.ts${PDI}`);
  });

  it("leaves fenced blocks alone", () => {
    const code = "```js\nimport x from '@scope/y';\n```";
    expect(isolateMentions(code)).toBe(code);
  });
});

describe("fieldDir", () => {
  it("keeps an empty field right-to-left so the Arabic placeholder sits right", () => {
    expect(fieldDir("")).toBe("rtl");
    expect(fieldDir(null)).toBe("rtl");
    expect(fieldDir("   ")).toBe("rtl");
  });

  it("lets the typed text decide once there is any", () => {
    expect(fieldDir("hello")).toBe("auto");
    expect(fieldDir("مرحبا")).toBe("auto");
  });
});
