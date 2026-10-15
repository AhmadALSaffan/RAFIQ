# Privacy policy

_Last updated: 15 October 2026_

Rafiq is a desktop app that runs on your own Windows computer. There is no Rafiq server and no Rafiq account. This page explains what that means for your data.

## What Rafiq collects

**Nothing.** Rafiq has no analytics, no telemetry, no crash reporting and no tracking. The developer receives no data about you or how you use the app.

## Where your data lives

Everything stays on your computer:

- **Chats, tasks, designs, settings and memory**: in a local database under `%APPDATA%\Rafiq`.
- **API keys and sign-in tokens** (including your GitHub sign-in for Copilot): in Windows Credential Manager, the operating system's secure store. They are never written to Rafiq's database, its logs or its backups.
- **Backups**: saved only where you choose, and they never contain keys or tokens.

## What leaves your computer, and only when you use it

Rafiq connects to other services only to do what you ask:

- **The AI model you choose** (for example GitHub Copilot, OpenAI, Anthropic, DeepSeek or OpenRouter) receives your messages and the files you attach or let it read, so it can answer. Each provider handles that data under its own privacy policy. A local model (Ollama, LM Studio) sends nothing off your computer.
- **GitHub sign-in (Copilot)**: Rafiq uses GitHub's official device sign-in and asks only for the `read:user` scope, to show which account is connected. The token is used to talk to GitHub Copilot and to renew itself. Rafiq never sees your GitHub password.
- **Services you connect yourself** (MCP servers, Jira, Linear, GitHub issues, web search) receive only the requests your chats and tasks make to them.
- **Updates and prices**: Rafiq checks GitHub Releases for new versions and downloads the public model price table from GitHub. No personal data is sent.

## Your control

- Disconnect an account or delete a key at any time in **Settings**. Its token is removed from Windows Credential Manager.
- Remove Rafiq's access to your GitHub account at any time on GitHub: **Settings → Applications → Authorized OAuth Apps → Rafiq**.
- Uninstalling Rafiq and deleting `%APPDATA%\Rafiq` removes all of its local data.

## Children

Rafiq is not directed at children under 13.

## Changes

Changes to this policy are published in this file, in the [Rafiq repository](https://github.com/AhmadALSaffan/RAFIQ).

## Contact

Questions about privacy: [open an issue](https://github.com/AhmadALSaffan/RAFIQ/issues) or contact the developer, [Ahmad AL Saffan](https://github.com/AhmadALSaffan).
