---
name: impeccable
description: The design process Rafiq runs before any screen is built — gather the brief (impeccable init), decide the system (type, colour, spacing, motion), produce a single self-contained HTML preview, then critique it against the anti-slop checklist. Use this skill for every design request, and re-read it before each revision.
---

# impeccable — designing before building

Inspired by the design thinking at impeccable.style. This is a process, not a theme:
the same steps produce a calm dashboard, a loud landing page, or an Arabic RTL app.

## 0. Never skip the brief

A design without a brief is decoration. If `design_brief` is not in your context, ask
the questions in `INIT.md` — one message, numbered, no more than nine questions — and
wait for answers before drawing anything.

## 1. Decide the job of the screen

Write one sentence before any markup:

> This screen helps **<who>** do **<what>**, and it feels **<adjective>**.

From that sentence derive:

- **The one action.** Exactly one element wins the eye. A title and a button must not
  fight; pick the winner deliberately.
- **What must never hide.** Price, remaining seats, a destructive consequence, an error.
  Anything the user would be angry to discover later stays visible.
- **The first five seconds.** What is read first, second, third. If you can't rank them,
  the hierarchy isn't done.

## 2. Build the system, then the screen

Decide these before writing markup, and write them down as tokens:

- **Type scale.** One family (two at most). Pick a display size, a body size (15–16px is
  usually right for product UI), and a metadata size. Line-height ~1.5 for text, ~1.2 for
  headings. Weight carries hierarchy better than size alone.
- **Colour.** A neutral ramp (background, surface, border, ink, muted ink) plus **one**
  accent, plus semantic success/danger. The accent is for the one action and for state,
  never for decoration. Check contrast: body text ≥ 4.5:1, large text ≥ 3:1.
- **Spacing.** One 4px-based scale (4, 8, 12, 16, 24, 32, 48). Space inside an element is
  always smaller than the space around it — that's what makes groups read as groups.
- **Shape.** One radius per role (field, card, pill) and stick to it. Mixed radii look
  accidental.
- **Depth.** Prefer a 1px border over a shadow. If you use shadow, one soft elevation for
  overlays only.
- **Motion.** See the rules below.

## 3. Motion rules

- UI transitions: **150–250ms**; nothing that blocks the user goes over 300ms.
- Easing: `ease-out` for things entering or responding to the user, `ease-in-out` for
  things moving between two on-screen states. **Never `ease-in` on entrances** — it feels
  broken. A good default curve is `cubic-bezier(0.16, 1, 0.3, 1)`.
- Animate cheap properties: `transform` and `opacity`. Animating `height`, `top` or
  `box-shadow` on a list is how you get jank.
- Hover: lift ~1px or a background change, ~150ms. Press: scale ~0.96, ~160ms.
- High-frequency actions (typing, scrolling, toggles the user hits repeatedly) get almost
  no animation — motion that's charming once is exhausting the twentieth time.
- Respect `prefers-reduced-motion`: keep the state change, drop the movement.

## 4. States are part of the design

Every screen ships with: **empty**, **loading**, **error**, **partial**, and **too much
data**. An empty state is a chance to teach: one line of what goes here, one action.
Loading uses skeletons shaped like the content, not a spinner in the middle of nothing.
Errors say what happened and what to do next, in the user's language.

## 5. Arabic and RTL

When the interface is Arabic (the default for Rafiq):

- `dir="rtl"` on the root, logical properties everywhere: `margin-inline-start`,
  `padding-inline-end`, `inset-inline-start`. Never `left`/`right`.
- Numbers, code, file paths and URLs stay LTR: wrap them in `<bdi dir="ltr">`.
- Icons that imply direction (back, next, send) mirror; icons of objects (clock, file) do not.
- Pick a typeface with real Arabic (Cairo, Tajawal, IBM Plex Sans Arabic, Noto Sans Arabic).
  Arabic needs a little more line-height than Latin — 1.6–1.75 for body text.
- Write the copy in Arabic first. Translated-sounding Arabic is the fastest way to look cheap.

## 6. The anti-slop checklist

Before you show anything, hunt these down — they are what makes a design look
machine-made:

1. Purple-to-blue gradients doing nothing, or a gradient on a body-text container.
2. "AI beige" and muddy near-greys chosen by accident rather than from a ramp.
3. Emoji used as iconography in a serious product.
4. Italic serif display type on a technical product.
5. Cards inside cards inside cards — borders that never resolve into hierarchy.
6. Two states that look identical (pending vs active, disabled vs read-only).
7. Centre-aligned paragraphs longer than two lines.
8. Text over a busy image with no scrim.
9. Every element the same weight, so nothing is the entry point.
10. Radii, border colours and shadows that vary without reason across the same screen.
11. Placeholder text used as a label (it disappears exactly when it's needed).
12. Icon-only buttons with no accessible name.
13. Lorem ipsum, or fake numbers presented as if they were real data.
14. Animation on everything, especially on things the user triggers constantly.

## 7. Deliverable

Produce **one self-contained HTML document** in a single ```html fenced block:

- Inline `<style>` — no external CSS, no build step, no CDN scripts required.
- CSS custom properties at `:root` for the tokens you decided in step 2, so a developer
  can lift them straight into the real app.
- Real, plausible content in the product's language — never lorem ipsum.
- Responsive: it must survive a 380px-wide window.
- Both themes when the product needs them: define light at `:root`, dark under
  `@media (prefers-color-scheme: dark)`.
- Accessible: labelled controls, focus-visible styles, semantic landmarks.

Above the block, in prose, give: the one-sentence job of the screen, the decisions you
made (type, colour, spacing, motion) with the reason for each, and what you deliberately
left out. Below it, list what you'd test with a user next.

## 8. Revise like an editor

On every revision: re-read this skill and any skill you used, then say out loud which
rule the change serves. If a request would break a rule (e.g. "make everything bigger"),
do it, but name the trade-off in one line. Never silently redesign something the user
didn't ask about — change the smallest thing that solves their note.
