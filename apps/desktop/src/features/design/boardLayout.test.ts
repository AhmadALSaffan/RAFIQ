import { describe, expect, it } from "vitest";
import { boardHtml, boardItems, screenFor } from "./boardLayout";

const doc = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`;

describe("the app board", () => {
  it("puts the identity sheet first and keeps the screens in the model's order", () => {
    const items = boardItems([
      { name: "home", html: doc("الرئيسية") },
      { name: "brand", html: doc("الهوية") },
      { name: "cart", html: doc("السلة") },
      { name: "empty", html: "  " },
    ]);
    expect(items.map((i) => [i.id, i.kind, i.label])).toEqual([
      ["brand", "brand", "الهوية"],
      ["home", "screen", "الرئيسية"],
      ["cart", "screen", "السلة"],
    ]);
  });

  it("finds the screen a link names, however it's written", () => {
    const items = boardItems([{ name: "cart", html: doc("Cart") }]);
    for (const link of ["cart.html", "./cart.html", "#cart", "Cart", "cart.html?x=1"]) expect(screenFor(items, link)?.id, link).toBe("cart");
    expect(screenFor(items, "checkout.html")).toBeNull();
  });

  it("writes one file with every screen framed and its HTML kept safe in the attribute", () => {
    const items = boardItems([
      { name: "brand", html: doc("Brand") },
      { name: "home", html: `<!doctype html><title>Home</title><p class="x">"quoted" & more</p>` },
    ]);
    const html = boardHtml("Shop", items, "ltr", "1 screens");
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('id="b-home"');
    expect(html).toContain('class="phone"');
    expect(html).toContain("&quot;quoted&quot; &amp; more");
    expect(html.match(/<iframe/g)).toHaveLength(2);
    expect(html).toContain("<p>1 screens</p>");
  });
});
