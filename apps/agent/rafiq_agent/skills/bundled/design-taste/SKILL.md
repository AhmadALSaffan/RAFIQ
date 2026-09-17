---
name: design-taste
description: How to make an interface that does not look machine-made. Read before any UI, landing page, dashboard, email, slide or poster — with any model, strong or small. Arabic + English. Companion to impeccable (process) and web-interface-guidelines (correctness).
commands:
  - name: taste
    description: راجع الصفحة/التصميم الحالي على قائمة design-taste واذكر كل مخالفة مع إصلاحها
    prompt: |
      اقرأ مهارة design-taste (skill_read design-taste) وملفها PREFLIGHT.md، ثم راجع التصميم أو الصفحة اللي عم نشتغل عليها بند بند:
      1) هل في «قرار» بصري واضح؟ 2) الطباعة: أحجام، أوزان، أطوال أسطر. 3) الألوان: هل في تدرّج بنفسجي/وردي أو ألوان محايدة زجاجية؟ 4) التخطيط: بطاقات متساوية بلا سبب؟ فراغات ميتة؟ 5) النص: عبارات محشوة أو جاهزة؟ 6) الحركة: زايدة أو معدومة؟
      اكتب لكل مخالفة: وين بالضبط، ليش غلط، وشو التعديل الملموس (قيمة، كلمة، بديل). لا تعدّل شي قبل ما أوافق.
  - name: de-ai
    description: أعد كتابة نصوص الواجهة (عناوين، أزرار، أوصاف) بحيث ما تبان مكتوبة بآلة
    prompt: |
      اقرأ قسم «Copy» من مهارة design-taste (skill_read design-taste). خذ كل النصوص الظاهرة بالتصميم الحالي وأعد كتابتها: جملة واحدة محددة بدل العبارات العامة، أفعال حقيقية بدل «Unlock / Empower / Seamless»، أرقام وأسماء حقيقية بدل الوعود، وبدون شرطة طويلة أو ثلاث نقاط تعداد متطابقة. اعرض قبل/بعد بجدول قبل ما تطبّق.
---

# design-taste — حتى ما يبيّن التصميم «مولّد»

The fastest way to spot a generated interface: it has no opinion. Everything is centred,
everything is a card, the gradient is purple-to-pink, the headline says "Unlock the power
of…", three feature tiles each get a rounded icon, and nothing on the page could only
belong to *this* product. This file is the list of decisions that fix that. It is written
so that a small model can follow it literally and a strong model can use it as a check.

**How to use it.** Before you write markup: do §1 and §2 on paper (in your reply, briefly).
While writing: obey §3–§7. Before you show anything: run `PREFLIGHT.md`.

الطريقة: قبل ما تكتب أي كود، اقرأ الملف وقرّر (§1 و§2). أثناء الكتابة التزم بـ §3–§7.
قبل ما تعرض النتيجة، مرّ على `PREFLIGHT.md` بند بند.

---

## §1 Make one decision first / قرار واحد قبل كل شي

Write one sentence: **"This screen exists so that ___ can ___ in under ___."**
Then pick **one** of these as the dominant trait — never all of them:

| Trait | Means | Looks like |
|---|---|---|
| Dense | professional tool, lots on screen | 13–14px body, tight rows, tables, no hero |
| Calm | reading, focus | one column, 17–18px body, wide margins, few colours |
| Loud | marketing, a single message | one huge headline, one image, one button |
| Warm | consumer, friendly | rounded, soft shadows, one saturated accent, photos of people |
| Precise | data, finance, dev | monospace numbers, thin rules, no gradients |

Everything else follows the trait. If you cannot name the trait you are decorating, not designing.

اختار صفة وحدة مسيطرة (كثيف / هادئ / صاخب / دافئ / دقيق). الصفحة اللي «كل شي فيها شوي» هي الصفحة المولّدة.

## §2 The dials / المفاتيح

Decide these numbers and keep them for the whole design. Do not mix.

- **Type scale**: pick a base (15, 16 or 17px) and a ratio (1.2 for dense, 1.25 for calm, 1.333 for loud). Max **4** sizes on one screen.
- **Weights**: exactly two (e.g. 400 + 600). Never 300 for body text. Never 800+ except one display headline.
- **Radius**: one value for controls (6–10px), one for containers (12–16px), or **0** everywhere for precise. Not five different radii.
- **Spacing unit**: 4 or 8. Every gap is a multiple. Vertical rhythm > horizontal symmetry.
- **Line length**: 45–75 characters for Latin, 35–60 for Arabic. Never full-width paragraphs.
- **Colour count**: 1 neutral ramp (5–7 steps) + 1 accent + semantic red/green. That is all.

## §3 Typography / الطباعة

- Headline and body are **different** in size *and* weight *and* often measure — not just size.
- Arabic: use a real Arabic family (IBM Plex Sans Arabic, Noto Naskh/Kufi Arabic, Cairo, Tajawal, Readex Pro). Never fake-bold. Line-height 1.6–1.8 for Arabic body; Latin 1.5.
- Numbers in tables: `font-variant-numeric: tabular-nums`. Currency and dates aligned.
- Letter-spacing: **0** for body; slightly negative (−0.01 to −0.02em) only for large Latin display; never positive tracking on lowercase.
- One display face + one text face at most. Monospace only for code, ids, numbers.
- No text in ALL CAPS longer than two words. No gradient text. No text-shadow.

## §4 Colour / الألوان — the bans and the rules

**Banned (these are the tells):**
- purple→pink, blue→purple, teal→purple gradients on anything;
- glassmorphism (translucent panels with blur) on light backgrounds;
- pure `#000` on pure `#fff`;
- five pastel badge colours; rainbow tag clouds;
- a coloured "glow" behind cards; neon borders;
- the same accent for every button on the page.

**Do instead:**
- Neutrals carry warmth or coolness: off-white `#faf9f7`/`#f7f7f8`, ink `#1a1a1a`/`#141414`, not grey `#333`.
- One accent, used for **one** primary action per view and for focus rings. Everything else is neutral.
- Dark mode is its own palette (not inverted): surfaces `#111`→`#1c1c1c`→`#262626`, text `#ededed`, muted `#9a9a9a`, accent slightly desaturated.
- Contrast: body ≥ 4.5:1, large text ≥ 3:1. Check muted text — it is usually the failure.
- Borders: 1px at 8–12% ink, never 2px grey. Shadows: one soft layer (`0 1px 2px rgba(0,0,0,.06)`) or none.

## §5 Layout / التخطيط

- **Not everything is a card.** Cards are for things you compare or act on individually. Text, forms, settings lists: no card, just spacing and one rule line.
- **Asymmetry is allowed.** A 7/5 or 2/3 split beats three equal columns. Left-align (start-align) text blocks; centre only a single short headline.
- **Icons are not decoration.** Delete the icon-in-a-rounded-square above each feature. Keep icons in nav, buttons with a verb, status.
- **Hero**: one headline (≤ 8 words), one sub-line (≤ 20 words), one button, optionally one real screenshot. No three-button hero. No fake browser mockup with blurred text.
- **Empty states**: one sentence + one action. No illustration of a sad box.
- **Tables** over tiles for anything with more than two attributes.
- **Vertical spacing**: sections separated by 64–96px on marketing, 24–32px in apps. Inside a section, related items 8–12px apart, unrelated 24px+.
- Max content width 1100–1200px for pages, 720px for reading. Phone: 16px side padding, single column, no horizontal scroll.
- RTL: logical properties (`margin-inline-start`, `padding-inline`, `text-align: start`); mirror chevrons and progress; **do not** mirror logos, clocks, media controls, or code blocks.

## §6 Copy / النص — this is where most generated pages fail

Banned words and shapes: *unlock, empower, seamless, effortless, elevate, supercharge, leverage, next-level, revolutionize, cutting-edge, robust, delve, in today's fast-paced world, whether you're X or Y*. Banned shapes: three bullets that each start with a bold two-word label; an em-dash every sentence; a rhetorical question headline; "Welcome to…"; exclamation marks; emojis in UI text.

Write like a person who built it:
- Headline states the outcome with a concrete noun: **"Tasks that run while you sleep"** not "Empower your workflow".
- Buttons are verbs with objects: **"Start a task"**, **"Connect GitHub"** — not "Get started", "Learn more".
- Numbers beat adjectives: "3 providers, one API key each" beats "many integrations".
- One idea per sentence. Sentences of different lengths. Cut the last sentence of every paragraph; it is usually a summary.
- Arabic copy: write the dialect the product speaks (فصحى for formal, Levantine/Gulf for friendly) and keep it consistent; avoid literal translations of English marketing.

## §7 Motion / الحركة

- Purpose only: reveal state change, preserve context, guide attention. No decorative floating blobs, no parallax, no typing-effect headlines, no counting numbers.
- Durations 120–200ms for controls, 250–400ms for panels. Easing `cubic-bezier(.2,.8,.2,1)` or similar ease-out; never linear, never bounce in a serious product.
- Respect `prefers-reduced-motion`.
- Hover: change one property (background or border), not scale + shadow + colour.

## §8 Components — defaults that read as designed

- **Button**: height 36–40px, padding-inline 14–16px, radius from §2, weight 500–600, one primary per view; secondary is outlined or ghost, not a second colour.
- **Input**: 1px border 12% ink, radius from §2, focus = 2px accent ring, label above (never placeholder-only).
- **Nav**: text links, current item bold or with a 2px start-side bar — not a pill for every item.
- **Badge/status**: dot + word, or muted background + ink text. Not a bright solid chip.
- **Modal**: max 520px, title 18px 600, one primary action at the end.
- **Toast**: one line, dismissible, bottom-start in RTL.
- **Avatars/photos**: real crops, not gradient circles with initials for everyone.

## §9 For small or weak models / للنماذج الأضعف

If you are unsure, use exactly this and nothing else:

```
base 16px · scale 1.25 → 16 / 20 / 25 / 31 · weights 400 + 600 · line-height 1.6 (ar 1.75)
radius 8px controls, 12px containers · spacing 8px grid
light: bg #faf9f7 · surface #ffffff · ink #1a1a1a · muted #6b6b6b · border rgba(0,0,0,.1) · accent #e68835
dark:  bg #111111 · surface #1a1a1a · ink #ededed · muted #9a9a9a · border rgba(255,255,255,.1) · accent #f0a15c
max-width 1120px page / 720px text · section gap 80px · one primary button per view
fonts: "IBM Plex Sans Arabic", "Inter", system-ui
```

Then check `PREFLIGHT.md`. If any item fails, fix it before showing the result.

## §10 What "done" looks like / متى بيكون خلص

A stranger can say what the product does in 5 seconds; the primary action is obvious; nothing on the screen could be deleted without losing information; it survives phone width and dark mode; and there is at least one detail that is specific to this product (a real screenshot, a real number, a real sentence) that a template could not have produced.
