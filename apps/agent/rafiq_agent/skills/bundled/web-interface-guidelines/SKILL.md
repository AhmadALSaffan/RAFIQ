---
name: web-interface-guidelines
description: Vercel's checklist for correct web UI — accessibility, focus, forms, animation, typography, images, performance, i18n, dark mode. Read RULES.md and audit the markup/CSS before calling a design "done". Complements design-taste (how it looks) with how it behaves.
commands:
  - name: wig
    description: راجع الملفات/الصفحة الحالية على قواعد Vercel للواجهات (وصولية، نماذج، حركة، أداء) واعرض المخالفات
    prompt: |
      اقرأ ملف RULES.md من مهارة web-interface-guidelines (skill_read web-interface-guidelines RULES.md)، ثم راجع الملفات اللي عم نشتغل عليها بنداً بنداً. اكتب لكل مخالفة: الملف والسطر، القاعدة، والإصلاح المقترح بسطر واحد — مختصر وعالي الإشارة. لا تعدّل شي قبل ما أوافق.
---

# web-interface-guidelines

The rules live in `RULES.md` (MIT, © Vercel — see `LICENSE`). They are the behaviours a
page must get right regardless of how it looks: every icon button has a name, every
control is reachable by keyboard, focus is visible, forms don't lose input, animations
respect reduced motion, text doesn't clip, dark mode isn't an afterthought.

Use it as a **final audit**, after `design-taste` has settled how the screen looks:

1. `skill_read web-interface-guidelines RULES.md`
2. Walk the sections in order; for each rule, either point at the line that satisfies it
   or fix the line that breaks it.
3. Report only violations, one line each: file:line — rule — fix.

المهارة هاي بتراجع *سلوك* الواجهة (وصولية، لوحة مفاتيح، نماذج، حركة، أداء، لغات، وضع داكن)،
مو شكلها. اقرأ `RULES.md` وطبّقها كفحص أخير بعد ما يخلص التصميم.
