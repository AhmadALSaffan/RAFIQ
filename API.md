# Rafiq local API

The desktop app talks to a local FastAPI server (the "agent"). Anything the app can do,
a script on the same machine can do too — that's what the `rafiq` command uses.

## Finding the agent

While Rafiq is running it writes a discovery file:

```
%APPDATA%\Rafiq\agent.json      →  {"port": 8765, "token": "…", "pid": 12345}
```

The token changes on every launch and the file is removed on shutdown. Every request
needs it:

```
Authorization: Bearer <token>
Accept-Language: ar | en | ru      (optional — the language of messages from the agent)
```

The interactive reference (every route, schema and example) is served by the agent
itself: open `http://127.0.0.1:<port>/docs` in a browser while the app is running.

## The `rafiq` command

Installed next to the app (`rafiq.cmd` in the install folder; add it to `PATH` or call
it by path). It only needs the discovery file above.

```bash
rafiq status                          # version, what's running
rafiq models                          # configured models and whether they work
rafiq tasks [--all]                   # running / waiting tasks (or everything)
rafiq task "rename the images by date" --dir C:\photos --mode plan --wait
rafiq approve <task-id>               # approve a planned task
rafiq task-show <task-id>             # a task's transcript
rafiq chat "what's in this folder?" --model Sonnet
rafiq memories                        # what Rafiq remembers
```

During development (no install) the same thing is `python -m rafiq_agent.cli …` from
`apps/agent` with the venv active.

## Routes worth knowing

Full list at `/docs`; the ones scripts usually want:

| Route | What it does |
|---|---|
| `GET /health` | Is the agent up (no token needed) |
| `GET /diagnostics` | Version, settings, model providers — nothing secret |
| `GET/POST /models` · `POST /models/{id}/test` | Configured models |
| `GET/POST /tasks` · `GET /tasks/{id}` · `POST /tasks/{id}/cancel` | Tasks. `POST` takes `title, prompt, model_id, working_dir?, mode? (auto·plan·step), workspace_id?` |
| `POST /tasks/{id}/plan/approve` `{plan?}` · `POST /tasks/{id}/plan/reject` | Plan-first tasks |
| `POST /tasks/{id}/permission?event_id=&resolution=approved|denied` | Answer a permission prompt |
| `GET /tasks/{id}/changes` · `…/apply` · `…/revert` · `…/describe` · `…/commit {message}` | A task's git changes |
| `WS /tasks/{id}/stream?token=` | Live transcript |
| `GET/POST /chats` · `POST /chats/{id}/messages` (SSE) · `GET /chats/{id}/export?format=html|md` | Chats |
| `GET /designs/{id}/documents` · `GET /designs/{id}/documents/read?path=` | What a design's preview can open: its own documents and the HTML files in its folder |
| `GET/POST/PATCH/DELETE /memories` | What Rafiq remembers |
| `GET/POST/PUT/DELETE /workspaces` | Workspaces (folder, model, instructions) |
| `GET /templates` · `/templates/catalog` · `/templates/export` · `POST /templates/import` | Task templates |
| `GET /schedules` · `POST /schedules/{id}/run` | Scheduled tasks |
| `GET /mcp` · `GET /mcp/requirements` · `POST /mcp/{id}/test` · `POST /mcp/{id}/connect` · `POST /mcp/{id}/logout` | MCP servers. `connect` on an OAuth server returns `authorize_url` to open; the browser lands on `GET /mcp/oauth/callback` (no token needed) |
| `GET /skills` · `POST /skills` · `POST /skills/install {url}` · `DELETE /skills/{name}` | Skills |
| `GET/PUT /settings` | App settings, including the permission policy |
| `POST /backup/save {path}` · `POST /backup/inspect {path}` · `POST /backup/restore-file {path}` · `GET /backup` · `POST /backup/restore` (upload) | One zip with the database, skills and attachments — never a secret. Restoring refuses while anything is running and keeps a copy of what it replaced |

The SSE stream from `POST /chats/{id}/messages` sends `data: {"type": …}` lines:
`start`, `delta` (text), `reasoning`, `tool_call`, `tool_result`, `permission`,
`permission_resolved`, `task_created`, `usage` (what the reply cost), `error`, `stopped`, `done`.

## Rules

- The API binds to `127.0.0.1` only. Don't expose it: the token is the only lock, and the
  agent can run commands and edit files.
- Never write the token anywhere but the discovery file. Never log it.
- Model API keys don't travel through the API — they go to Windows Credential Manager
  on save and only their presence (`has_key`) comes back.
