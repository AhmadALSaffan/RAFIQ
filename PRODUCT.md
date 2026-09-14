# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Tauri 2 (Rust shell) + React + TypeScript + Tailwind CSS, RTL/Arabic-first UI. Backend is a local Python FastAPI sidecar process (agent runtime, tool system, SQLite). Explicitly chosen by the user, not delegated.

## Users

A single primary user: a programmer running Rafiq on their own Windows machine to hand off coding/computer tasks to an autonomous agent instead of doing them by hand. Arabic-speaking, comfortable with technical UI (model IDs, API keys, permission policies).

## Product Purpose

Rafiq lets the user configure one or more LLM "models" (provider + credentials) and give an agent a task; the agent then works the task autonomously using real computer-control tools (filesystem, shell, browser, full mouse/keyboard desktop control) until it's done, streaming its progress live. Success = the user can watch a task run, see exactly what the agent is doing/about to do, intervene when a risky action needs approval, and trust the result.

## Positioning

Unlike a cloud chat assistant, Rafiq runs entirely locally: it's a real computer-control agent (not chat-only) with credentials stored in the OS keychain rather than a vendor's cloud, and every write/exec-class tool call is gated by an explicit, visible permission prompt rather than running silently. The user brings their own model credentials across multiple providers instead of being locked to one vendor.

## Operating Context

Runs as a native-feeling desktop app on Windows 11. One agent task executes at a time (v1) — no multi-session juggling. The whole UI is Arabic-first and right-to-left; this is a hard product requirement, not a locale afterthought.

## Capabilities and Constraints

- Model management: add/edit/remove LLM provider configs (Anthropic, OpenAI, Ollama, DeepSeek, and other providers via a unifying LLM abstraction); credentials never displayed once saved.
- Task execution: one task at a time; task = title + prompt + chosen model; live streamed transcript (agent messages, tool calls, results) persisted so it survives reopening.
- Tool system: filesystem, shell, process, browser automation, and full desktop mouse/keyboard control — the last of these gated behind an explicit one-time Settings opt-in.
- Permission model: tools are classified read-only (auto-allowed) vs. write/exec (default: ask, with inline approve/deny and an optional "allow for rest of task"); policy configurable per category in Settings.
- Issue trackers: Jira Cloud, Linear, GitHub Issues and GitLab Issues connect with the user's own token (stored in the OS keychain like model keys). The app lists issues assigned to the user, mentions them in chat, comments on them, and transitions them to done — both through UI commands and through agent tools, so a task can report its own result. Other trackers (ClickUp, Asana, Trello, Notion, Azure DevOps…) are not implemented yet; the connector registry is built so each is a self-contained client class.
- Secrets: raw API keys live in the OS credential store (keyring), never in the SQLite database in plaintext.
- Open/undecided: exact list of "other popular models" beyond the four named is not fixed — the LLM abstraction should make adding one low-effort rather than requiring a fixed roster.

## Brand Commitments

Name: **Rafiq** (رفيق — Arabic for "companion" / "close friend"). The name itself sets the tone: a capable companion working alongside the user, not a faceless SaaS console.

Logo: a white single-stroke mark on the brand-orange rounded square, made by the user in Recraft. Source export and the cleaned master live in `brand/` (`source-recraft-export.png`, `rafiq-icon.png`, plus `rafiq-glyph.png` — the stroke alone on transparent).

Brand accent color: `#e68835` (warm orange), explicitly chosen by the user — the single committed accent against neutral grayscale UI. The app supports both light and dark themes with a user toggle (not dark-only).

## Evidence on Hand

None yet — no existing screens, logo, or brand assets. This is a from-scratch build.

## Product Principles

1. Visibility over automation-for-its-own-sake: the user should always be able to see what the agent is doing or about to do, especially for write/exec-class actions.
2. Local-first and provider-neutral: the app is a control surface over the user's own credentials and machine, not a hosted product with its own account system.
3. Arabic/RTL is the default reading direction of the product, not a translated afterthought bolted onto an LTR layout.
4. One task at a time, done clearly, beats a busy multi-task dashboard — the v1 experience should feel calm and legible even though the underlying capability (full desktop control) is powerful.

## Accessibility & Inclusion

Right-to-left Arabic layout is a functional requirement across every screen (mirrored layout, RTL-aware icons/directionality, Arabic web font), not just translated strings in an LTR grid.
