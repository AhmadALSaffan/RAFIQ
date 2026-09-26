import { describe, expect, it } from "vitest";
import { fold, score } from "./CommandPalette";

describe("fold", () => {
  it("drops harakat, shadda and tatweel", () => {
    expect(fold("الكِتابُ")).toBe("الكتاب");
    expect(fold("جميـــل")).toBe("جميل");
    expect(fold("شدّة")).toBe("شده");
  });

  it("unifies hamza forms, ى and ة", () => {
    expect(fold("أحمد إسراء آمنة")).toBe("احمد اسراء امنه");
    expect(fold("مستشفى")).toBe("مستشفي");
  });

  it("folds case, accents and Arabic-Indic digits", () => {
    expect(fold("Résumé")).toBe("resume");
    expect(fold("٢٠٢٦")).toBe("2026");
  });
});

describe("score", () => {
  const settings = { label: "الإعدادات", keywords: "settings preferences" };

  it("finds an item by its label however it was typed", () => {
    expect(score(settings, "الاعدادات")).toBeGreaterThan(0);
    expect(score({ label: "مهمة جديدة" }, "مهمه")).toBeGreaterThan(0);
  });

  it("finds an item by an English keyword in the Arabic interface", () => {
    expect(score(settings, "settings")).toBeGreaterThan(0);
  });

  it("needs every word", () => {
    expect(score({ label: "تقرير المبيعات الشهرية" }, "تقرير مبيعات")).toBeGreaterThan(0);
    expect(score({ label: "تقرير الطقس" }, "تقرير مبيعات")).toBe(0);
  });

  it("ranks a label that starts with the query above one that only contains it", () => {
    const starts = score({ label: "السجلات" }, "السج");
    const contains = score({ label: "افتح السجلات" }, "السج");
    const keywordOnly = score({ label: "التكلفة", keywords: "logs usage" }, "logs");
    expect(starts).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(keywordOnly);
  });

  it("matches everything when the query is empty", () => {
    expect(score({ label: "أي شي" }, "   ")).toBeGreaterThan(0);
  });
});
