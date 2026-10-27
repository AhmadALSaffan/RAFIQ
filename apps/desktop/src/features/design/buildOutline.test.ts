import { describe, expect, it } from "vitest";
import { buildOutline } from "./buildOutline";

describe("buildOutline", () => {
  it("is nothing before any HTML", () => {
    expect(buildOutline("Here's the plan for the page…")).toBeNull();
  });

  it("follows the parts of the document being written", () => {
    const text = 'Sure.\n```html\n<!doctype html><body><header id="top">x</header><section aria-label="Pricing plans"><h2>Plans</h2></section><section><h2>Our <b>team</b></h2>';
    expect(buildOutline(text)).toEqual({
      finished: [],
      current: {
        name: null,
        parts: [
          { label: "top", done: true },
          { label: "Pricing plans", done: true },
          { label: "Our team", done: false },
        ],
      },
    });
  });

  it("names documents by the fence word or the file comment, and lists finished ones", () => {
    const text = "```html dashboard.html\n<main></main>\n```\n```html\n<!-- file: home -->\n<nav>";
    expect(buildOutline(text)).toEqual({ finished: ["dashboard"], current: { name: "home", parts: [{ label: "nav", done: false }] } });
  });

  it("has no current document once every block closed", () => {
    expect(buildOutline("```html\n<section></section>\n```\nDone.")).toEqual({ finished: [null], current: null });
  });
});
