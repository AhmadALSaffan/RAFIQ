/**
 * Page-wide shortcuts (Space plays, arrows nudge…) next to controls that need the same keys.
 * Whoever has the keyboard focus wins: a text field keeps every key; a button reached by
 * keyboard keeps Space and Enter; a list, a row of tabs or a slider keeps its arrows. After a
 * mouse click the focus isn't "visible", so the shortcuts work as the mouse user expects.
 */

const CONTROL = "button, a[href], summary, [role=button], [role=switch], [role=tab], [role=option], [role=menuitem], [role=radio], [role=slider]";
const WALKED = "[role=tab], [role=option], [role=menuitem], [role=radio], [role=slider]";

/** Typing somewhere: text fields, selects, sliders and editable text keep every key. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return el === document.activeElement; // an engine without :focus-visible
  }
}

/** Should a page-wide shortcut leave this key to the focused element? */
export function ownsKey(target: EventTarget | null, key: string): boolean {
  if (typing(target)) return true;
  const el = (target as HTMLElement | null)?.closest?.(CONTROL);
  if (!el || !focusVisible(el)) return false;
  if (key === " " || key === "Enter") return true;
  return /^(Arrow|Home$|End$|PageUp$|PageDown$)/.test(key) && el.matches(WALKED);
}

// ── Tab rows and radio groups ──────────────────────────────────────────────────────────
//
// The ARIA pattern: the group is one stop in the Tab order (its chosen item), and the
// arrow keys move the choice. Right and Left follow the reading direction, so in Arabic
// Left goes forward.

const GROUP = "[role=tablist], [role=radiogroup]";

function items(group: HTMLElement): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>("[role=tab], [role=radio]")).filter(
    (el) => el.closest(GROUP) === group && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
  );
}

/** Only the chosen item (or the first) is in the Tab order. */
export function rove(group: HTMLElement): void {
  const all = items(group);
  const chosen = all.find((el) => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true") ?? all[0];
  for (const el of all) {
    const index = el === chosen ? 0 : -1;
    if (el.tabIndex !== index) el.tabIndex = index;
  }
}

/** Arrow keys (and Home/End) move the choice to the next item and focus it. */
export function moveInGroup(group: HTMLElement, key: string): HTMLElement | null {
  const all = items(group);
  const at = all.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || !all.length) return null;
  const rtl = getComputedStyle(group).direction === "rtl";
  const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
  const to = key === "Home" ? 0 : key === "End" ? all.length - 1 : key in step ? (at + step[key] + all.length) % all.length : null;
  if (to === null) return null;
  const next = all[to];
  next.focus();
  next.click();
  return next;
}

/**
 * `ref={roving}` on a tablist or radiogroup makes it keyboard-complete: one Tab stop, the
 * arrows to move, and it keeps up when the choice changes by mouse.
 */
export function roving(group: HTMLElement | null): (() => void) | undefined {
  if (!group) return undefined;
  const update = () => rove(group);
  const onKey = (e: KeyboardEvent) => {
    if (moveInGroup(group, e.key)) e.preventDefault();
  };
  update();
  const watch = new MutationObserver(update);
  watch.observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "aria-checked", "disabled"] });
  group.addEventListener("keydown", onKey);
  return () => {
    watch.disconnect();
    group.removeEventListener("keydown", onKey);
  };
}
