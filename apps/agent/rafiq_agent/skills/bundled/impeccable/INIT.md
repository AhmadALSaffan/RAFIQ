# impeccable init — the brief

Before the questions, the user **builds the visual identity** (colours, fonts, shape, depth,
density, motion, theme — see core/identity.py); it arrives as «هوية التصميم» with a
`:root` block to copy as is. The questions below are about the product; they arrive as
`design_brief`.

| # | Question (Arabic) | Field | Why it changes the design |
| --- | --- | --- | --- |
| 1 | شو بدك تصمّم؟ | `kind` | A dashboard, a landing page and a mobile app have different densities and entry points. |
| 2 | شو بيعمل المنتج بجملة وحدة؟ | `what` | The one sentence every screen has to serve. |
| 3 | مين المستخدم؟ | `who` | Expertise sets density, jargon, and how much hand-holding the empty states need. |
| 4 | شو أهم إجراء بالشاشة الأولى؟ | `action` | The one element that wins the eye. |
| 5 | شكل الصفحة؟ | `layout` | A long story, a short focused page, a card grid, an editorial page, or app screens. |
| 6 | شو لازم يكون فيها؟ | `sections` | The sections the user needs; they come first in the plan. |
| 7 | لغة الواجهة واتجاهها | `direction` | RTL Arabic is the default here; it changes layout, icons, and type choice. |
| 8 | في منتجات شكلها بيعجبك؟ | `references` | References carry taste faster than adjectives. |
| 9 | في قيود؟ (تقنية، وقت، إمكانية وصول، أجهزة) | `constraints` | A design that can't be built is a drawing. |

## Rules for the interview

- Anything the user leaves empty: pick a sensible default, **say which default you picked**
  and why, and move on. Never block on a blank field.
- Don't ask again for something already in the brief.
- If two answers conflict (e.g. "hospital records" + "playful"), name the conflict in one
  line and propose the resolution you're taking.
