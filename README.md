<div align="center">

<img src="brand/rafiq-icon.png" alt="Rafiq Icon" width="10%" />

#  Rafiq · رفيق
### An Arabic-first AI agent for Windows that works on your own machine

[![CI](https://img.shields.io/github/actions/workflow/status/AhmadALSaffan/RAFIQ/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white)](https://github.com/AhmadALSaffan/RAFIQ/actions/workflows/ci.yml)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Agent%20Runtime-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?style=flat-square)](#-getting-started)
[![RTL](https://img.shields.io/badge/UI-Arabic%20RTL-E68835?style=flat-square)](#overview)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange?style=flat-square)](#)

<!--
### Website
[![Website](https://img.shields.io/badge/Website-000000?style=for-the-badge&logo=netlify&logoColor=white)](https://YOUR-SITE-HERE)
-->

---
</div>

<div align="center">

https://github.com/user-attachments/assets/3da54706-52ca-4fb2-87bd-c5f5a4b4518c

</div>

---

## Overview

**Rafiq** (Arabic for *companion*) is a Windows desktop app developed by [AhmadALSaffan](https://github.com/AhmadALSaffan). You connect the AI model you already use — Anthropic, OpenAI, Gemini, DeepSeek, a local Ollama model, and more — and Rafiq gives it real tools to work with on your machine: it reads and writes files, runs commands, writes Word documents in proper Arabic, designs interfaces with a live preview, and works on your issues in Jira, Linear, GitHub, GitLab and eight more trackers. Select text in any program and one shortcut translates, fixes or answers it.

The whole interface is Arabic and right-to-left from the ground up, everything runs locally, and nothing sensitive happens without your approval.

> 🔑 **Bring your own model:** Rafiq has no account system and no cloud of its own. You add an API key for the provider you choose (stored in Windows Credential Manager), sign in with a GitHub account that has Copilot, or run a model locally with Ollama.

---

## Videos

<div align="center">

| Rafiq works on your issues | Select text anywhere · Word in Arabic | The welcome |
|:---:|:---:|:---:|
| [<img src="docs/videos/integrations.webp" width="100%" alt="Rafiq splits an issue, asks before writing, and moves it along with the task">](docs/videos/integrations.mp4) | [<img src="docs/videos/rafiq-0.5.webp" width="100%" alt="Select text in an email, press the shortcut, translate">](docs/videos/rafiq-0.5.mp4) | [<img src="docs/videos/typewriter-dark.webp" width="100%" alt="The start button types its label">](docs/videos/typewriter-dark.mp4) |
| 12 trackers; the model splits issues and starts tasks with your approval, and the issue moves from *To Do* to *In Review* with a branch and a pull request. **54 s** | Press Ctrl+Shift+Space over selected text: translate, fix, rephrase, summarise, reply — and Word documents that read right to left. **47 s** | The welcome's start button types itself out, and again on hover. **10 s** · [light](docs/videos/typewriter-light.mp4) |

<sub>Click a preview for the full video.</sub>

</div>

---

## Screenshots

<div align="center">

| Home | Chat |
|:---:|:---:|
| <img src="docs/screenshots/home.webp" width="100%"> | <img src="docs/screenshots/chat.webp" width="100%"> |
| How your day is going at a glance: today's tasks and spending, this month against its limit, recent chats, the next scheduled run, a world clock, and a box to start a chat — with ideas to start from — on the model you pick. | Stream a reply from any model you connected; a plan turns into tasks you can follow right in the chat. `/` commands, `@` for files and `#` for issues. |

| Tasks | One task, start to finish |
|:---:|:---:|
| <img src="docs/screenshots/tasks.webp" width="100%"> | <img src="docs/screenshots/task.webp" width="100%"> |
| Hand work off and watch it run: what's running, waiting, done or stopped, and every task one click away. | Every step numbered, every tool call and its output, and what the task cost. |

| Designs | Write your own skills |
|:---:|:---:|
| <img src="docs/screenshots/design.webp" width="100%"> | <img src="docs/screenshots/skills.webp" width="100%"> |
| Design the interface before you build it: a live preview beside the conversation that shaped it, with every version kept. | Write or edit a skill with its files and `/` commands; it's checked as you type and previewed as the model will read it. |

| Models | Cost |
|:---:|:---:|
| <img src="docs/screenshots/models.webp" width="100%"> | <img src="docs/screenshots/cost.webp" width="100%"> |
| Every model you connected, cloud or local, with its status, its fallback and what it cost over the last 30 days. | Today, this month and the tokens behind them, daily and monthly limits, and the spend of each model. |

| Schedules | All your designs |
|:---:|:---:|
| <img src="docs/screenshots/schedules.webp" width="100%"> | <img src="docs/screenshots/designs.webp" width="100%"> |
| Tasks that start on their own, every day, on chosen weekdays or every few hours, with the next run set large. | Every design as a live thumbnail, the skills the model designs with, and one click to install more. |

| Connections | Ctrl+K opens everything |
|:---:|:---:|
| <img src="docs/screenshots/integrations.webp" width="100%"> | <img src="docs/screenshots/palette.webp" width="100%"> |
| Twelve issue trackers, connected once and brought into any chat with `#`; rules, notices, team channels and a log you can undo. | Every page, command, chat, task and design in one box, from anywhere in the app. |

| Settings | About |
|:---:|:---:|
| <img src="docs/screenshots/settings.webp" width="100%"> | <img src="docs/screenshots/about.webp" width="100%"> |
| Language, layout, the quick-ask shortcut and your own quick actions, backups, and every permission — with a path at the top. | What Rafiq is, what it can do, and who made it. |

| Suggestions | |
|:---:|:---:|
| <img src="docs/screenshots/feedback.webp" width="100%"> | |
| An idea or a problem, sent as a GitHub issue ready to post or as an email — nothing leaves until you send it. | |

<sub>Screenshots of Rafiq 0.5.1 in the dark theme; the app has a light theme too.</sub>

</div>

---

## Features

### New in 0.4.29 – 0.5.1

- ✂️ **Act on any selected text** — Select text in any program and press the quick-ask shortcut: the box opens on it with translate, fix, rephrase, summarise and reply, or a question about it. Rafiq copies with Ctrl+Insert (never interrupting a terminal) and puts your clipboard back as it was
- ⚡ **Your own quick actions** — "Make it formal", "Turn it into a tweet"… up to 20, beside the built-in ones (Settings → General)
- 📄 **Word documents in proper Arabic** — A `word_write` tool turns Markdown into a `.docx` that reads right to left: an Arabic font, tables read from the right, bullets on the right, and English kept in order inside Arabic
- 🔗 **Twelve trackers** — Jira, Linear, GitHub, GitLab, Azure DevOps, Trello, Asana, ClickUp, YouTrack, Bitbucket, Gitea and Plane; a code sign-in for GitHub and GitLab, and a read-only switch per account
- 🤖 **The model works on your issues, and asks first** — It reads, splits, creates, edits, links and comments on issues, and starts tasks and schedules of its own; every write shows a card with *Allow*, *Deny* and *Always allow*, kept in Settings → Permissions
- 🚦 **Issues that move with the task** — *In Progress* when a task starts, *In Review* or *Done* when it ends, on a branch named after the issue, with a commit, a push or a pull request that closes it
- 🗂️ **A Work page** — List and board (drag between columns), bulk changes, a side panel with the work Rafiq did, reviews, notices, saved views and Ctrl+N to create an issue
- 🔔 **Notices, rules and team channels** — Watch for assignments, mentions, reviews and comments; rules prepare a task or a plan for matching issues; Slack, Teams and Discord webhooks; every change on a tracker logged and undoable
- 💬 **Suggestions** — A page to send an idea or a problem as a GitHub issue ready to post, or as an email; nothing leaves until you send it
- 🏠 **A richer Home** — Ideas to start from, the model in a liquid menu, a departures-board world clock, this month's spending, and the quick-ask shortcut at a glance
- ⬆️ **Updates you can't miss** — When a new version is out, the app shows what's new and installs it before carrying on
- ✨ **A finer feel** — Skeletons while loading, a breadcrumb with a hover pill, a 404 page with digits that lean from the pointer, and an error screen instead of a blank window when a page breaks

### Everything else

- 💬 **Chat** — Stream replies from any connected model with Markdown, image and file attachments, `@` to reference files in the chat's folder, `#` to mention your tracker issues, and `/` commands to adjust reply length, language, temperature, and reasoning
- 🗜️ **Token control** — Rafiq describes only the tools a chat can actually use, caps every reply, reads files in pages, and folds long chats into a summary. **Save tokens** (Settings → Cost, or per chat) names the skills instead of describing every one — ~8,200 characters of fixed overhead per message instead of ~13,600 — and **economy mode** takes it to ~160. Every reply shows what it cost. See [docs/TOKENS.md](docs/TOKENS.md)
- 🗂️ **Parallel tasks** — Hand off jobs and Rafiq works through them in the folders you pick, up to 100 at once (you set the limit). Tasks that would edit the same files take turns, and a task can wait for the ones it depends on. Each has live progress, re-run, and a full step-by-step transcript
- 🧩 **Plans → tasks** — Send a plan in chat and the model splits it into tasks, shows their live status in the chat, waits for them to finish, and replies with the results
- 🔁 **Replies that keep going** — Leave a chat mid-reply and the reply keeps being written; come back and it picks up live where it is
- 🌿 **A git worktree per task** — On a git repository, each task works in its own isolated copy (taken from the folder as it is, uncommitted files included), so tasks on one project run side by side; their changes are then applied back to your folder — never committed to your branch
- 🔍 **Review, revert, commit** — Every task on a git folder gets a changes panel: the files, the diff, one click to revert (or apply changes that didn't apply cleanly), and a commit of just that task's files — with a commit message and PR description the model writes from the diff
- ▶️ **Resume a failed task** — A task that failed, was cancelled, or was cut off when the app closed can carry on from where it stopped: the agent is handed what it already did, so finished steps aren't repeated, and on a git folder the review covers both runs together. “Run it again” is still there to start over from the top
- 🗺️ **Plan first, or step by step** — A task can write its plan and wait for your approval (edit it first if you like) before touching anything, or ask before every single write and command
- 👀 **See the diff before you allow it** — When a task or chat wants to write a file, the permission card shows exactly what will change, not just the file name
- 🧠 **Memory across chats** — “Remember that I…” and Rafiq keeps it (behind its own permission, so you see what's saved); every later chat and task knows it, and Settings lets you edit or delete anything
- 🗂️ **Workspaces** — A project's folder, default model and standing instructions in one place; switch workspace and chats, tasks and designs filter to it
- 📤 **Share a chat** — Export any chat as a single self-contained HTML page (light and dark, tool cards included) or as Markdown
- 🔎 **Search inside your chats** — The box above the chat list looks through every message, not just titles, with Arabic folded the way people write it (harakat, hamza forms, «ال», a leading «و» or «ب»): a line from the matching message with the words marked, and one click opens the chat at that message
- 🗄️ **Archive** — Move a chat out of the list without deleting it; search still finds it, and writing in it brings it back
- ⌨️ **Ctrl+K opens everything** — Every page, settings section and command, plus your chats, tasks and designs, in one box; Arabic folded as you type, English keywords welcome, and chats searched inside their messages
- 🎨 **A new look** — Bold headings, big numbers and calm blocks in light and dark, tabs on top for what you have open, a slim icon rail, and a home screen with how your day is going
- ✍️ **Write your own skills** — Write or edit a skill with its reference files and / commands inside the app; it's checked as you type and previewed as the model will read it, and a built-in skill can be copied and made your own
- 🕰️ **Design history** — Every version of every design screen; compare any two side by side or line by line, and bring an old one back
- 💰 **A budget per workspace** — Give each workspace its own daily spending limit; when one reaches it, only its chats and tasks pause until tomorrow
- 🧩 **Templates with blanks** — Write `{{branch}}`, `{{folder}}` or any name in a task template; Rafiq asks for each before the task starts, and fills the folder, git branch and date itself
- 🗓️ **Schedule history** — Every run of a scheduled task, on time or by hand, with how it went: duration, cost, the gist of its report, or why it failed or never started
- 🛡️ **Permissions per MCP tool** — Let a server's read-only tools run on their own, ask before the ones that change things, and allow or block any single tool
- ⭐ **Bookmarks** — Star any message, yours or Rafiq's; the chat header lists the starred ones and takes you straight back to each, and Ctrl+K finds them across every chat
- 📝 **Prompt library** — Save any message you sent as a reusable prompt, with `{{variables}}` for the parts that change; `/prompt` (or Ctrl+K) fills them in and drops the text in the message box
- ⚡ **Quick ask from anywhere** — Ctrl+Shift+Space (or a shortcut you pick in Settings) opens a small always-on-top box over any app, on the text you selected if any: ask, read the answer, and carry the chat on in Rafiq with one click
- 💾 **Backup and restore** — Settings → General saves chats, tasks, settings, models, memory, skills and attachments in one zip — never a key — and restores it after showing what's inside, keeping a copy of what it replaces
- 📜 **Logs in the app** — Rafiq's own log and each MCP server's, with a filter, copy and live refresh; keys, tokens and passwords are masked before they reach the screen
- 🧩 **Skills you install** — Paste a GitHub repository, a folder in one, a raw `SKILL.md` or a zip and it becomes a skill; skills can bring their own `/` commands, announced when they land. Two bundled design skills (`design-taste`, Vercel's `web-interface-guidelines`) keep generated UI from looking generated
- ⌨️ **`rafiq` on the command line** — `rafiq task "…" --wait`, `rafiq chat "…"`, `rafiq tasks`, `rafiq approve` — from any terminal while the app runs (see `API.md`)
- 📌 **Project instructions** — Put a `RAFIQ.md` (or `AGENTS.md`) in a project and every chat and task there reads it first: build commands, conventions, what not to touch
- 🔌 **MCP servers, one click** — A catalogue of official servers with their logos: sign in through the browser (Notion, Linear, Atlassian, Sentry, Stripe, Figma — OAuth with PKCE, tokens in Windows Credential Manager, refreshed automatically), paste one token (GitHub, Supabase, Brave, Slack), or just connect (Playwright, Fetch, Context7, Docker…). No command lines unless you pick “custom”. Rafiq says when Node, uv or Docker is missing and turns a failed connection into a reason you can act on (a 401 is “token wrong or expired”, not “TaskGroup error”)
- 🌍 **Web and browser** — `web_fetch` reads pages and PDFs as text; `web_search` uses Brave, Tavily, or your own SearXNG; and a real browser (Microsoft Edge, with its own profile) lets the agent click, type, and test `localhost` apps
- 🖱️ **Desktop control** — Off by default: screenshots, mouse and keyboard on any app, one run at a time, every action behind its permission
- ⏰ **Scheduled tasks and templates** — Run a task every N minutes, daily, or on chosen weekdays; save tasks you repeat as templates, import and export them as JSON, or pull from the community catalogue
- 🚦 **Provider limits** — Requests per provider key are capped (the rest wait instead of failing with 429), rate limits and outages are retried with backoff, and each agent can have a fallback agent
- 🪟 **Runs in the background** — Closing the window keeps Rafiq in the tray with Windows notifications for finished tasks and approvals; it can start with Windows, and it never leaves its agent process running after you quit
- 🎨 **Designs** — A brief (`/impeccable init`), bundled design skills that work with every model, a live HTML preview at phone/tablet/desktop widths, and a one-click hand-off to the session that will build it. You choose what the preview shows: every document of the design (a second screen adds one instead of replacing the first) and every HTML file in the design's folder, including ones the model wrote with its own tools
- 📥 **My Work** — Issues assigned to you across all twelve trackers in one place: change status, comment, or turn an issue into a task
- 🧠 **Any model** — Anthropic, OpenAI, Google Gemini, DeepSeek, Groq, Mistral, xAI, OpenRouter, Azure OpenAI, AWS Bedrock, Google Vertex AI, Cerebras, Fireworks, Together, Qwen (DashScope), Kimi (Moonshot), GLM (Z.ai), Ollama and LM Studio (local), or any OpenAI-compatible endpoint
- 💵 **Cost and budgets** — Every call's tokens and price are recorded per agent and per day; set a daily or monthly limit and Rafiq stops calling the provider once it's reached
- 🎙️ **Dictation** — Speak your message instead of typing it, using the speech model of a provider you already configured
- ✏️ **Edit and fork** — Reword a question you already asked and send it again, or fork a chat from any point to try another direction without losing this one
- ⬆️ **Updates in the app** — Rafiq checks its releases page (or the beta channel) for a newer signed version, downloads it, and restarts into it
- 🩺 **Diagnostics report** — One click saves a JSON report (version, settings, model providers, MCP server names) with no keys and nothing from your conversations
- 🐙 **GitHub Copilot sign-in** — Connect a GitHub account with an active Copilot plan through GitHub's device flow and the official Copilot SDK — no key, no password in Rafiq; each agent uses the account you pick for it
- 🔗 **OpenRouter sign-in** — Approve Rafiq on openrouter.ai (OAuth PKCE) instead of pasting a key; the issued key goes straight to Windows Credential Manager
- 🧪 **AuthAI (experimental, off by default)** — An optional adapter for the third-party [AuthAI](https://github.com/authai-io/authai) relay. Unofficial and not affiliated with any provider; see the warning in Settings before enabling it
- 🛡️ **Permission policy** — Every tool that writes files, runs commands, manages processes, browses, controls the desktop, calls MCP tools, edits issues, starts tasks, publishes to git or posts to a team channel is set to *ask*, *allow*, or *deny* — per category, from Settings
- 🔐 **Local-first** — Chats, tasks, and designs live in a local SQLite database; API keys go to Windows Credential Manager, never into the database
- 🌐 **Arabic, English, Russian** — Arabic-first and right-to-left, with full English and Russian translations (left-to-right) switchable from Settings — including messages from the agent
- 🌗 **Light & dark** — A warm `#e68835` accent and both themes

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| UI | React 19 · TypeScript · Tailwind CSS 4 · Motion |
| Agent runtime | Python 3.11+ · FastAPI · Uvicorn |
| Model layer | LiteLLM · GitHub Copilot SDK (optional) |
| Tools | MCP Python SDK · Microsoft Edge over the DevTools protocol · Win32 input · git worktrees |
| Database | SQLite via SQLAlchemy (async) + aiosqlite |
| Secrets | `keyring` → Windows Credential Manager |
| Packaging | PyInstaller (agent) · NSIS installer (Tauri bundler) · signed updates (Tauri updater) |
| Quality | Vitest · ESLint · pytest · Ruff |

---

## 🚀 Getting Started

### Prerequisites

- Windows 10 or 11 (x64)
- An API key for at least one supported provider — or [Ollama](https://ollama.com/) running locally

For building from source you also need:

- [Node.js](https://nodejs.org/) 20+ and pnpm 10 (`corepack enable`)
- [Python](https://www.python.org/) 3.11+
- [Rust](https://rustup.rs/) with Visual Studio Build Tools (*Desktop development with C++*)

### 1 — Download the Installer

To try Rafiq directly on Windows:

<!-- Link this to the release once it is published. -->
[⬇️ Download for Windows](https://github.com/AhmadALSaffan/Rafiq/releases/latest)

Run `Rafiq_<version>_x64-setup.exe`. It installs for the current user (no administrator rights needed), in Arabic or English, and adds Rafiq to the Start menu and desktop.

> ⚠️ The installer is not code-signed yet, so Windows SmartScreen may show a warning. Choose **More info → Run anyway**. You can check the download against `SHA256SUMS.txt` from the same release:
>
> ```powershell
> Get-FileHash .\Rafiq_0.5.3_x64-setup.exe -Algorithm SHA256
> ```

### 2 — Clone the Repository (Developers)

```bash
git clone https://github.com/AhmadALSaffan/Rafiq.git
cd Rafiq
pnpm install
```

### 3 — Set Up the Agent

```bash
cd apps/agent
python -m venv .venv
.venv\Scripts\pip install -e ".[dev,copilot]"
```

### 4 — Run

```bash
cd apps/desktop
pnpm tauri dev
```

Tauri picks a free port and a random token, starts the agent from `apps/agent/.venv`, and hands both to the UI — there is no separate server to start.

### 5 — Test

```bash
cd apps/desktop && pnpm check          # TypeScript + ESLint + Vitest
cd apps/agent && .venv\Scripts\ruff check . && .venv\Scripts\python -m pytest -q
```

### 6 — Build the Installer

```bash
cd apps/desktop
pnpm release
```

This runs the checks, freezes the agent with PyInstaller, builds the NSIS installer, and writes a release-ready copy to `release/Rafiq_<version>_x64-setup.exe` together with `release/SHA256SUMS.txt`.

---

## Configuration

Rafiq works without any configuration. These optional environment variables are read by the agent:

```env
RAFIQ_DATA_DIR=        # where the database, attachments, and your own skills live (default: %APPDATA%\Rafiq)
RAFIQ_WORKSPACE_DIR=   # where tasks and designs without a chosen folder save files (default: Documents\Rafiq)
RAFIQ_TOKEN=           # bearer token for the local API (set automatically by the desktop app)
RAFIQ_CORS_ORIGINS=    # comma-separated allowed origins (defaults cover the app and the dev server)
RAFIQ_GITHUB_CLIENT_ID= # GitHub OAuth App (device flow) used for Copilot sign-in — set this in a fork
```

### Where your data lives

| What | Where |
|---|---|
| Chats, tasks, designs, settings | `%APPDATA%\Rafiq\rafiq.db` |
| Attachments | `%APPDATA%\Rafiq\attachments` |
| Your own skills | `%APPDATA%\Rafiq\skills` |
| Files from tasks and designs with no folder | `Documents\Rafiq\tasks\…` and `Documents\Rafiq\designs\…` |
| API keys, account tokens, tracker tokens | Windows Credential Manager |
| Agent log (installed app) | `%APPDATA%\Rafiq\agent.log` |
| MCP server logs | `%APPDATA%\Rafiq\logs` |
| Discovery file for the `rafiq` command (while running) | `%APPDATA%\Rafiq\agent.json` |

All of these sit outside the install folder, so updating or reinstalling Rafiq never touches your data.

---

## Architecture

```text
┌──────────────────────────── Rafiq.exe (Tauri 2 · Rust) ────────────────────────────┐
│  React UI (RTL)  ──HTTP / SSE / WebSocket + bearer token──►  rafiq-agent (FastAPI) │
│        ▲                                                         │                 │
│        └── picks a free port + random token, spawns the agent ◄──┘                 │
└────────────────────────────────────────────────────────────────────────────────────┘
                                                                    │
                     LiteLLM ──► the provider you chose (or local Ollama)
                     Tools   ──► files · shell · Word · web · 12 issue trackers · skills · MCP
                                 (write/exec tools pass the permission policy first)
```

### Project Structure

```text
Rafiq/
├── apps/
│   ├── desktop/                          # Tauri 2 · React 19 · TypeScript · Tailwind 4 (Arabic-first, RTL)
│   │   ├── src/
│   │   │   ├── main.tsx · App.tsx        # entry and routes (anything else lands on the 404 page)
│   │   │   ├── routes/                   # one file per page
│   │   │   │   ├── HomePage.tsx          #   the day at a glance, ideas to start from, the world clock
│   │   │   │   ├── QuickAsk.tsx          #   the box the global shortcut opens: selected text, quick actions
│   │   │   │   ├── ModelsPage.tsx        #   providers, keys and sign-ins, model discovery
│   │   │   │   ├── IntegrationsPage.tsx  #   the twelve trackers, rules, channels, the action log
│   │   │   │   ├── DesignsPage.tsx · DesignWorkspace.tsx · MotionPage.tsx · MotionWorkspace.tsx
│   │   │   │   ├── SettingsPage.tsx      #   every section, with a path at the top
│   │   │   │   ├── FeedbackPage.tsx      #   suggestions, sent as a GitHub issue or an email
│   │   │   │   ├── NotFoundPage.tsx      #   the 404 page, and the error screen of a page that breaks
│   │   │   │   └── AboutPage.tsx · GuidePage.tsx · DesignSystemPage.tsx
│   │   │   ├── features/
│   │   │   │   ├── chat/                 #   chat page, composer, transcript, activity panel, work status
│   │   │   │   ├── tasks/                #   list, detail, new task, changes panel, templates, schedules
│   │   │   │   ├── work/                 #   "My Work": list, board, issue panel, create issue, notices
│   │   │   │   ├── integrations/         #   connect a tracker, account settings, rules, channels, log
│   │   │   │   ├── design/               #   design skills, version history, identity builder, fonts
│   │   │   │   ├── motion/               #   the motion editor and its engine
│   │   │   │   ├── settings/             #   sections: general, MCP, memory, usage, logs, motion, backup
│   │   │   │   ├── accounts/             #   sign-in with a provider account
│   │   │   │   └── updates/              #   the update card and the forced-update dialog
│   │   │   ├── components/
│   │   │   │   ├── Shell.tsx             #   rail, tabs, toasts, an error boundary around each page
│   │   │   │   ├── FirstRun.tsx          #   the welcome
│   │   │   │   ├── CommandPalette.tsx    #   Ctrl+K
│   │   │   │   ├── steps.tsx             #   tool cards and the permission card (with its diff)
│   │   │   │   ├── arc/                  #   adapted from Arc UI: toasts, tabs, timeline, drawer, code block…
│   │   │   │   ├── easy/                 #   adapted from EasyUI: gooey menu, breadcrumb, matrix clock,
│   │   │   │   │                         #   skeleton, not-found, typewriter and rainbow buttons
│   │   │   │   └── …                     #   Markdown, DiffView, Illustration, brand blocks, icons
│   │   │   ├── lib/                      # api/ (one module per domain), types, quickAsk, feedback,
│   │   │   │                             #   permissions, issueNotices, bidi, time, links, theme
│   │   │   ├── i18n/                     # en.ts · ru.ts (Arabic is the source) + a coverage test
│   │   │   └── styles/                   # theme tokens for light and dark
│   │   ├── src-tauri/                    # the Rust shell
│   │   │   ├── src/lib.rs                #   spawns the agent, tray, the quick-ask window and its shortcut
│   │   │   ├── src/selection.rs          #   reads the selected text and puts the clipboard back
│   │   │   ├── src/update.rs · job.rs · file_icon.rs
│   │   │   └── resources/rafiq.cmd       #   the `rafiq` command installed beside the app
│   │   ├── e2e/                          # Playwright smoke test against a fake model
│   │   └── scripts/                      # build-app.mjs (PyInstaller + Tauri) · release.mjs
│   └── agent/                            # Python 3.11+ · FastAPI · SQLite — the whole agent runtime
│       ├── rafiq_agent/
│       │   ├── main.py · cli.py          # the app (routers, lifespan, the tracker watcher) · the `rafiq` command
│       │   ├── api/                      # routes, one module per domain: chats · tasks · models ·
│       │   │                             #   integrations · designs · motion · settings · memory · …
│       │   ├── core/
│       │   │   ├── loop.py               #   the tool-use loop every provider goes through
│       │   │   ├── chat_service.py       #   one chat turn: context, streaming, permissions
│       │   │   ├── agent_runtime.py      #   one task: its tools and the permission policy
│       │   │   ├── manager.py            #   parallel tasks: claims, dependencies, the queue
│       │   │   ├── issues.py             #   tracker actions, recorded with how to undo them
│       │   │   ├── issue_lifecycle.py    #   an issue moving along with its task: branch, PR, comment
│       │   │   ├── issue_watch.py        #   notices and rules from the connected trackers
│       │   │   ├── gitops.py · task_git.py · git_describe.py
│       │   │   ├── designs.py · identity.py · design_slop.py · studio.py · motion.py
│       │   │   └── memory.py · search.py · schedules.py · prompts.py · …
│       │   ├── integrations/
│       │   │   ├── providers/            #   Jira · Linear · GitHub · GitLab · Azure DevOps · Trello · Asana ·
│       │   │   │                         #   ClickUp · YouTrack · Bitbucket · Gitea · Plane
│       │   │   ├── tools.py              #   the issue tools the model uses
│       │   │   └── base.py · channels.py · oauth.py · markup.py
│       │   ├── tools/                    # filesystem · shell · process · web · browser · desktop ·
│       │   │                             #   office (Word) · tasks · task_admin · notify · memory · skills · motion
│       │   ├── llm/                      # LiteLLM · Copilot SDK · discovery · presets · resilience · pricing · usage
│       │   ├── auth/                     # API keys and account sign-in (GitHub Copilot, OpenRouter)
│       │   ├── motion/                   # scenes, checks, export, fonts, media
│       │   ├── mcp_bridge.py · mcp_oauth.py
│       │   ├── skills/ · schemas/ · storage/ · data/
│       │   └── i18n.py · locales.py      # the agent speaks the UI's language too
│       ├── tests/                        # pytest
│       └── rafiq-agent.spec              # PyInstaller build
├── cloud/supabase/                       # the GitHub Marketplace webhook and its tables
├── updates/beta.json                     # the beta channel's update manifest
├── docs/                                 # screenshots/ · videos/ · TOKENS.md
├── site/ · site-src/                     # the website (static, generated by site-src/build.py)
├── brand/                                # logo sources
├── .github/workflows/                    # CI, and a daily keep-alive
├── API.md                                # the local API and the `rafiq` command
├── ARCHITECTURE.md · GUIDE.md            # layer-by-layer guide · full user and developer guide (Arabic)
├── DESIGN.md · PRODUCT.md                # the design system and the product decisions
├── PRIVACY.md · SUPPORT.md · THIRD_PARTY_NOTICES.md
└── README.md
```

For a deeper tour — every layer, and "where do I change…" — see [ARCHITECTURE.md](ARCHITECTURE.md). The complete Arabic guide, including every chat command, is in [GUIDE.md](GUIDE.md).

---

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/your-feature`
3. Run the checks: `pnpm check` in `apps/desktop`, `ruff` + `pytest` in `apps/agent`
4. Commit your changes: `git commit -m "feat: add your feature"`
5. Push to the branch: `git push origin feature/your-feature`
6. Open a Pull Request

---

## License

```text
No license has been chosen for Rafiq yet — any help, feedback, or contributions are more than welcome!
```

The bundled design skills by [Emil Kowalski](https://github.com/emilkowalski/skills) are MIT-licensed; their license ships alongside them in `apps/agent/rafiq_agent/skills/bundled/`.

Some interface components are adapted from [Arc UI](https://uiarc.dev) and [EasyUI](https://easyui.site) (both MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

<div align="center">
  Built with ❤️ by <a href="https://github.com/AhmadALSaffan">Ahmed Eliwi AL Saffan · أحمد عليوي السفان</a>
</div>
