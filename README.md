<div align="center">

<img src="brand/rafiq-icon.png" alt="Rafiq Icon" width="10%" />

#  Rafiq · رفيق
### An Arabic-first AI agent for Windows that works on your own machine

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

<!-- App demo — replace the src with the uploaded video/GIF link, then remove this comment wrapper.
<div align="center">
  <table>
    <tr>
      <td align="center" style="background:#1a1a1a; border-radius:24px; padding:12px; border: 2px solid #333;">
        <img
          src="DEMO-GIF-URL"
          alt="Rafiq app demo"
          width="780"
          style="border-radius:16px; display:block;"
        />
      </td>
    </tr>
  </table>
</div>

---
-->

## Overview

**Rafiq** (Arabic for *companion*) is a Windows desktop app developed by [AhmadALSaffan](https://github.com/AhmadALSaffan). You connect the AI model you already use — Anthropic, OpenAI, Gemini, DeepSeek, a local Ollama model, and more — and Rafiq gives it real tools to work with on your machine: it reads and writes files, runs commands, designs interfaces with a live preview, and follows up on your Jira, Linear, GitHub, and GitLab issues.

The whole interface is Arabic and right-to-left from the ground up, everything runs locally, and nothing sensitive happens without your approval.

> 🔑 **Bring your own model:** Rafiq has no account system and no cloud of its own. You add an API key for the provider you choose (stored in Windows Credential Manager), sign in with a GitHub account that has Copilot, or run a model locally with Ollama.

---

<!-- Screenshots — fill in once the images are uploaded, then remove this comment wrapper.
## Screenshots

| Chat | Tasks | Designs | My Work |
|:---:|:---:|:---:|:---:|
| <img src="CHAT-URL" width="100%"> | <img src="TASKS-URL" width="100%"> | <img src="DESIGNS-URL" width="100%"> | <img src="WORK-URL" width="100%"> |

---
-->

## Features

- 💬 **Chat** — Stream replies from any connected model with Markdown, image and file attachments, `@` to reference files in the chat's folder, `#` to mention your tracker issues, and `/` commands to adjust reply length, language, temperature, and reasoning
- 🗜️ **Token control** — `/لخّص` folds older messages into a summary so long chats stop resending everything
- 🗂️ **Parallel tasks** — Hand off jobs and Rafiq works through them in the folders you pick, up to 100 at once (you set the limit). Tasks that would edit the same files take turns, and a task can wait for the ones it depends on. Each has live progress, re-run, and a full step-by-step transcript
- 🧩 **Plans → tasks** — Send a plan in chat and the model splits it into tasks, shows their live status in the chat, waits for them to finish, and replies with the results
- 🔁 **Replies that keep going** — Leave a chat mid-reply and the reply keeps being written; come back and it picks up live where it is
- 🌿 **A git worktree per task** — On a git repository, each task works in its own isolated copy (taken from the folder as it is, uncommitted files included), so tasks on one project run side by side; their changes are then applied back to your folder — never committed to your branch
- 🔍 **Review and revert** — Every task on a git folder gets a changes panel: the files, the diff, and one click to revert (or apply changes that didn't apply cleanly)
- 📌 **Project instructions** — Put a `RAFIQ.md` (or `AGENTS.md`) in a project and every chat and task there reads it first: build commands, conventions, what not to touch
- 🔌 **MCP servers** — Connect any Model Context Protocol server (local command or Streamable HTTP); its tools join every chat and task behind their own permission, with its secrets kept in Windows Credential Manager
- 🌍 **Web and browser** — `web_fetch` reads pages and PDFs as text; `web_search` uses Brave, Tavily, or your own SearXNG; and a real browser (Microsoft Edge, with its own profile) lets the agent click, type, and test `localhost` apps
- 🖱️ **Desktop control** — Off by default: screenshots, mouse and keyboard on any app, one run at a time, every action behind its permission
- ⏰ **Scheduled tasks and templates** — Run a task every N minutes, daily, or on chosen weekdays; save tasks you repeat as templates (four ready-made ones included)
- 🚦 **Provider limits** — Requests per provider key are capped (the rest wait instead of failing with 429), rate limits and outages are retried with backoff, and each agent can have a fallback agent
- 🪟 **Runs in the background** — Closing the window keeps Rafiq in the tray with Windows notifications for finished tasks and approvals; it can start with Windows, and it never leaves its agent process running after you quit
- 🎨 **Designs** — A brief (`/impeccable init`), bundled design skills that work with every model, a live HTML preview at phone/tablet/desktop widths, and a one-click hand-off to the session that will build it
- 📥 **My Work** — Issues assigned to you across Jira Cloud, Linear, GitHub Issues, and GitLab Issues in one inbox: change status, comment, or turn an issue into a task
- 🧠 **Any model** — Anthropic, OpenAI, Google Gemini, DeepSeek, Groq, Mistral, xAI, OpenRouter, Azure OpenAI, AWS Bedrock, Google Vertex AI, Cerebras, Fireworks, Together, Qwen (DashScope), Kimi (Moonshot), GLM (Z.ai), Ollama and LM Studio (local), or any OpenAI-compatible endpoint
- 💵 **Cost and budgets** — Every call's tokens and price are recorded per agent and per day; set a daily or monthly limit and Rafiq stops calling the provider once it's reached
- 🎙️ **Dictation** — Speak your message instead of typing it, using the speech model of a provider you already configured
- ✏️ **Edit and fork** — Reword a question you already asked and send it again, or fork a chat from any point to try another direction without losing this one
- ⬆️ **Updates in the app** — Rafiq checks its releases page for a newer signed version, downloads it, and restarts into it
- 🩺 **Diagnostics report** — One click saves a JSON report (version, settings, model providers, MCP server names) with no keys and nothing from your conversations
- 🐙 **GitHub Copilot sign-in** — Connect a GitHub account with an active Copilot plan through GitHub's device flow and the official Copilot SDK — no key, no password in Rafiq; each agent uses the account you pick for it
- 🔗 **OpenRouter sign-in** — Approve Rafiq on openrouter.ai (OAuth PKCE) instead of pasting a key; the issued key goes straight to Windows Credential Manager
- 🧪 **AuthAI (experimental, off by default)** — An optional adapter for the third-party [AuthAI](https://github.com/authai-io/authai) relay. Unofficial and not affiliated with any provider; see the warning in Settings before enabling it
- 🛡️ **Permission policy** — Every tool that writes files, runs commands, manages processes, browses, controls the desktop, calls MCP tools, or edits issues is set to *ask*, *allow*, or *deny* — per category, from Settings
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
> Get-FileHash .\Rafiq_0.3.0_x64-setup.exe -Algorithm SHA256
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
                     Tools   ──► files · shell · processes · issue trackers · skills
                                 (write/exec tools pass the permission policy first)
```

### Project Structure

```text
Rafiq/
├── apps/
│   ├── desktop/                 # Tauri 2 + React + TypeScript + Tailwind
│   │   ├── src/
│   │   │   ├── features/        # chat · tasks · work — one folder per feature
│   │   │   ├── routes/          # models · designs · integrations · settings · about
│   │   │   ├── components/      # shared UI: shell, menus, feedback, page frame
│   │   │   └── lib/             # API client, types, bidi, layout, time helpers
│   │   ├── src-tauri/           # Rust shell: spawns the agent, Windows file icons, installer config
│   │   └── scripts/release.mjs  # release copy + SHA-256 checksum
│   └── agent/                   # Python agent runtime
│       ├── rafiq_agent/
│       │   ├── api/             # FastAPI routes
│       │   ├── core/            # agent loop, chat service, prompts, designs, workspace
│       │   ├── llm/             # LiteLLM wrapper + model discovery
│       │   ├── tools/           # filesystem, shell, process, issues, skills
│       │   ├── integrations/    # Jira, Linear, GitHub, GitLab clients
│       │   ├── skills/bundled/  # design skills shipped with the app
│       │   └── storage/         # SQLAlchemy models + keyring secrets
│       ├── tests/
│       └── rafiq-agent.spec     # PyInstaller build
├── brand/                       # logo sources
├── ARCHITECTURE.md              # layer-by-layer guide (Arabic)
└── GUIDE.md                     # full user & developer guide (Arabic)
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

---

<div align="center">
  Built with ❤️ by <a href="https://github.com/AhmadALSaffan">Ahmed Eliwi AL Saffan · أحمد عليوي السفان</a>
</div>
