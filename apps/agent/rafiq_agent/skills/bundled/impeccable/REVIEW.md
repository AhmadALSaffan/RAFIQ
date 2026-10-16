# Reviewing a design section by section

You're the studio lead looking at a page that isn't good enough yet. Don't start over and
don't tweak at random: go through the notes, then section by section, and fix.

## The loop

1. `design_review` — the page measured against its identity and the craft, with notes (✗)
   and what already works (✓).
2. Read every note, then go through the page section by section (nav, hero, each section,
   footer) against the table below, the identity and the brief.
3. Write **one** complete, fixed HTML document with every fix in it. Keep what works, and
   keep the identity exactly.
4. Tell the user, one short line per section, what you changed and why.

## Mistakes and their fixes

| What's wrong | What a studio does |
|---|---|
| **The identity drifted** — other colours or fonts | Back to the identity's `:root` block and font link; every colour is a variable or a `color-mix` of one. |
| **A small hero** | The headline at the guide's size for the style, 3–6 words; a paragraph ≤ 36ch; at most two buttons. |
| **The product is described, not shown** | Draw it: a phone or browser frame with real UI, a chart, a working widget. |
| **Every section the same shape** | Pick different shapes from the guide's menu; at most two alike in a row; break the page once. |
| **Three identical cards** | Alternating feature rows, a bento grid, tabs, a scroller — whatever suits the style. |
| **Motion off-level** | Match the identity: calm (fades and rises), medium (+ hero sequence, living details), cinematic (+ big entrances, marquee or scroll effects). |
| **No hover / focus** | Every link, button and card answers the pointer and the keyboard. |
| **Thin copy** | Real, specific copy: a label, a title ≤ 8 words, one or two sentences, real names and numbers. |
| **The brief ignored** | Add the sections the user asked for; respect the page shape and direction. |
| **Broken on a phone** | At ≤ 900px: one column, nav collapses, type uses clamp(). |
| **Broken RTL** | Logical properties only; no letter-spacing on Arabic; Latin numbers isolated. |
| **AI look** | Remove purple gradients, gradient text, emoji icons and placeholder images. |
