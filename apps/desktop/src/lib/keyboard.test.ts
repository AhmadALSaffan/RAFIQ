// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { moveInGroup, ownsKey, rove, roving, typing } from "./keyboard";

function group(role: "tablist" | "radiogroup", dir: "rtl" | "ltr", chosen = 1, count = 3): HTMLElement {
  const box = document.createElement("div");
  box.setAttribute("role", role);
  box.style.direction = dir;
  for (let i = 0; i < count; i++) {
    const b = document.createElement("button");
    b.setAttribute("role", role === "tablist" ? "tab" : "radio");
    b.setAttribute(role === "tablist" ? "aria-selected" : "aria-checked", String(i === chosen));
    b.textContent = `item ${i}`;
    b.addEventListener("click", () => {
      for (const other of box.querySelectorAll("button")) other.setAttribute(role === "tablist" ? "aria-selected" : "aria-checked", String(other === b));
    });
    box.append(b);
  }
  document.body.append(box);
  return box;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tab rows and radio groups", () => {
  it("puts only the chosen item in the Tab order", () => {
    const g = group("tablist", "ltr", 2);
    rove(g);
    expect([...g.querySelectorAll("button")].map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("moves with the reading direction: Left goes forward in Arabic", () => {
    const g = group("radiogroup", "rtl", 0);
    const buttons = [...g.querySelectorAll("button")];
    buttons[0].focus();
    expect(moveInGroup(g, "ArrowLeft")).toBe(buttons[1]);
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].getAttribute("aria-checked")).toBe("true"); // chosen, not only focused
    expect(moveInGroup(g, "ArrowRight")).toBe(buttons[0]);
  });

  it("wraps around, and Home/End jump to the ends", () => {
    const g = group("tablist", "ltr", 0);
    const buttons = [...g.querySelectorAll("button")];
    buttons[0].focus();
    expect(moveInGroup(g, "ArrowUp")).toBe(buttons[2]);
    expect(moveInGroup(g, "Home")).toBe(buttons[0]);
    expect(moveInGroup(g, "End")).toBe(buttons[2]);
    expect(moveInGroup(g, "a")).toBeNull();
  });

  it("skips disabled items", () => {
    const g = group("tablist", "ltr", 0);
    const buttons = [...g.querySelectorAll("button")];
    buttons[1].disabled = true;
    buttons[0].focus();
    expect(moveInGroup(g, "ArrowDown")).toBe(buttons[2]);
  });

  it("keeps the Tab stop on the choice when it changes by mouse", async () => {
    const g = group("tablist", "ltr", 0);
    const cleanup = roving(g);
    const buttons = [...g.querySelectorAll("button")];
    buttons[2].click();
    await new Promise((r) => setTimeout(r, 0)); // the observer runs after the change
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
    cleanup?.();
  });
});

describe("page shortcuts and focused controls", () => {
  it("leaves every key to a text field", () => {
    const input = document.createElement("input");
    expect(typing(input)).toBe(true);
    expect(ownsKey(input, " ")).toBe(true);
    expect(ownsKey(document.createElement("div"), " ")).toBe(false);
  });
});
