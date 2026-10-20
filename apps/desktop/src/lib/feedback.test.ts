import { describe, expect, it } from "vitest";
import { FEEDBACK_EMAIL, issueUrl, mailUrl, systemLines } from "./feedback";

const draft = { kind: "idea" as const, title: "رفيق يقرأ Excel", details: "بدي يحلل الجدول ويرسم.", withSystem: true };
const system = systemLines("0.5.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "ar");

describe("feedback", () => {
  it("names the version, Windows and the language — nothing else", () => {
    expect(system).toBe("Rafiq 0.5.1 · Windows 10/11 · UI: ar");
  });

  it("fills a GitHub issue with a tagged title, the details and the system line", () => {
    const url = new URL(issueUrl(draft, system));
    expect(url.origin + url.pathname).toBe("https://github.com/AhmadALSaffan/RAFIQ/issues/new");
    expect(url.searchParams.get("title")).toBe("[Suggestion] رفيق يقرأ Excel");
    expect(url.searchParams.get("body")).toBe(`بدي يحلل الجدول ويرسم.\n\n---\n${system}`);
    expect(url.searchParams.get("labels")).toBe("enhancement");
    expect(new URL(issueUrl({ ...draft, kind: "bug", withSystem: false }, system)).searchParams.get("body")).toBe("بدي يحلل الجدول ويرسم.");
  });

  it("writes an email to the developer with %20 spaces", () => {
    const url = mailUrl({ ...draft, kind: "bug" }, system);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?subject=`)).toBe(true);
    expect(url).not.toContain("+");
    expect(decodeURIComponent(url.split("subject=")[1].split("&")[0])).toBe("Rafiq — Bug: رفيق يقرأ Excel");
  });

  it("trims long details so the address still opens", () => {
    const long = { ...draft, details: "ا".repeat(6000) };
    expect(mailUrl(long, system).length).toBeLessThanOrEqual(1900);
    expect(issueUrl(long, system).length).toBeLessThanOrEqual(7000);
    expect(decodeURIComponent(mailUrl(long, system))).toContain("…");
  });
});
