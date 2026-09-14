# Design

<!-- impeccable:design-schema 1 -->

## Register

Operate (tool/dashboard). Expression must never obscure the task, state, or a familiar affordance — this governs every choice below.

## Scene

A programmer running Rafiq at their own desk, often for long stretches (a task can run for minutes), frequently at night. They need to read a live transcript, technical payloads (JSON args, shell output, model IDs), and — critically — spot and act on a permission prompt the instant it appears. Low-glare, high-legibility, calm.

## Color strategy: Restrained, brand-driven, light + dark

The user set the brand identity directly: `#e68835` (a warm orange) is the one committed accent, and the app must support both a light and a dark theme with a user-facing toggle (not dark-only). Everything else is a **true neutral gray** (zero chroma) — the earlier draft of this file used a warm-tinted near-black ground, which read as unintentional/odd rather than deliberate, so neutrals were corrected to plain grayscale. The accent is the only hue in the interface; semantic red/green are reserved strictly for danger/success status.

Tokens (defined in `apps/desktop/src/styles/index.css`, switched via `:root[data-theme]` and `prefers-color-scheme`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | oklch(1 0 0) | oklch(0.16 0 0) | app background |
| `--surface` | oklch(0.975 0 0) | oklch(0.21 0 0) | panels, rows |
| `--surface-2` | oklch(0.94 0 0) | oklch(0.27 0 0) | raised/hover surface |
| `--border` | oklch(0.87 0 0) | oklch(0.34 0 0) | hairlines |
| `--ink` | oklch(0.2 0 0) | oklch(0.95 0 0) | primary text |
| `--ink-muted` | oklch(0.46 0 0) | oklch(0.68 0 0) | secondary text (≥4.5:1 on `--surface`) |
| `--accent` / `--pending` | `#e68835` | `#e68835` | brand — interactive + awaiting-permission |
| `--accent-ink` | oklch(0.22 0.03 55) | oklch(0.18 0.03 55) | text on accent fill |
| `--danger` | oklch(0.55 0.22 27) | oklch(0.62 0.19 25) | deny / exec risk / cancel |
| `--success` | oklch(0.6 0.15 145) | oklch(0.7 0.15 145) | completed / approved |

Theme resolution order: an explicit user choice (`localStorage`, toggle in the nav rail) beats `prefers-color-scheme`, which beats the light default. See `apps/desktop/src/lib/theme.ts`.

## Logo

The mark is a white continuous stroke on the brand-orange squircle. Masters in `brand/`; the app uses it in three places through `components/Logo.tsx` — the nav rail (32px, with the running-task glow behind it), the chat welcome screen (64px), and the assistant avatar on every reply (28px). App/window/taskbar icons are generated from `brand/rafiq-icon.png` with `pnpm tauri icon` into `src-tauri/icons/`. Never re-letter the mark in text: it is an image, not the Arabic character it evokes.

## Provider marks

Model providers and trackers are identified by their real logos via `simple-icons` (`components/BrandMark.tsx`). Near-black marks (GitHub, Ollama, Anthropic) render in `--color-ink` so they survive both themes. OpenAI, Groq and xAI aren't in simple-icons — they get a monogram badge tinted with their brand colour rather than a look-alike drawing.

## Typography

System stack — deliberate, not a placeholder: an Operate surface is well served by the OS's own faces, it guarantees correct Arabic shaping/kerning with zero font-loading flash in a native desktop app, and it works fully offline.

- UI (Arabic + Latin): `"Segoe UI Variable", "Segoe UI", Tahoma, ui-sans-serif, system-ui, sans-serif`
- Technical/mono (tool payloads, shell output, model IDs, JSON): `"Cascadia Code", Consolas, ui-monospace, monospace`

Contrast axis is sans (interface) vs. mono (machine output) — never two similar sans faces. Body copy stays ≤75ch; technical panels are allowed to run wider since they're read, not prose.

## Layout & RTL

- Root is `dir="rtl"`; all spacing uses Tailwind logical utilities (`ps-*`/`pe-*`/`ms-*`/`me-*`, `start-*`/`end-*`), never `pl-*`/`pr-*`/`left-*`/`right-*`.
- App shell: a fixed right-hand nav rail (start side in RTL) + main content column. No sidebar-left convention copied from LTR products unreflected.
- Cards used only where they earn it (a model config, a task summary) — never nested. Long transcripts are a plain flowing list with hairline dividers, not a stack of cards.
- Permission requests render as a full-width, non-dismissible-until-acted banner inline in the transcript at the point they occur — never a toast that can be missed, never a modal that hides the transcript behind it.

## Components

- **Buttons**: solid `--accent` fill for the primary action per view (max one), outline/ghost for everything else; `--danger` fill reserved for deny/cancel/delete confirmations.
- **Status pills**: text + a small dot in the semantic color (pending/success/danger/neutral) — never color alone.
- **Tool-call block**: a labeled technical panel (mono font, `--surface-2` background, hairline border — full border, never a colored side-stripe) showing the tool name, args, and result/error.
- **Transcript**: agent messages in UI font, tool calls/results in the technical panel style, permission banners as described above.

## Motion

Library: `motion` (`motion/react`), shared tokens in `apps/desktop/src/lib/motion.ts` — `easeOutExpo` `[0.16, 1, 0.3, 1]` and a critically damped `snappy` spring (no overshoot, no bounce). `MotionConfig reducedMotion="user"` wraps the app; CSS loops (`shimmer`, `pending-ring`) stop under `prefers-reduced-motion`.

- **Focal moment — the agent at work:** transcript blocks arrive with a short rise + de-blur; a tool call and its result render as one card whose output slides open when the result lands; three accent dots pulse under "رفيق عم يفكّر…" while the model is thinking; a pending approval radiates an accent ring until answered. While any task runs, the logo glows and a dot breathes beside "المهام" in the nav.
- **Continuity:** a single shared `layoutId` pill slides between nav items, provider chips, picked model, and task-model cards; pages cross-fade with a 10px rise; forms open/close with a height reveal.
- **Feedback:** buttons press to 0.97; verification success draws its checkmark; errors enter with a small horizontal shake; status pills swap label vertically.
- **Loading:** a shimmer band stands in for lists while data loads (never a bare spinner on a blank page).
- **Attachments:** chips pop in with a progress ring (images) or progress bar (files) while uploading; a dashed accent veil with a bobbing file icon marks a drop target; sent images open in a scale-in lightbox.
- **Background work:** toasts rise from the bottom corner — approval toasts radiate the pending ring and stay until handled; completion toasts auto-dismiss. Tasks created from a chat appear as cards that flash the accent once and track live status.
- **Narrow windows:** the chat list becomes a drawer sliding out from the nav side over a dim backdrop.

Banned by the design rules and deliberately avoided: gradient text (the "thinking" state uses dots, not a text sweep).

## Provenance

This direction was set directly against the Impeccable "Operate" register rules and the product's own operating context (a technical, single-user, extended-session desktop tool) rather than through the full comp-generation/direction-roll pipeline in `new-work.md` — no image-generation tool is available in this environment, which the pipeline itself treats as the code-led path, and the elaborate multi-agent direction-tournament machinery (`concept-seed.mjs`, dedicated asset-producer/finish-reviewer subagents) targets a different harness than is available here. This file will be revised as the UI is actually built and reviewed.
