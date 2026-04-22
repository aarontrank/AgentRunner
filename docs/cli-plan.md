# AgentRunner CLI via Unix Domain Socket — Plan

## Architecture

```
┌─────────────────────────────────────────────┐
│  Electron Main Process                       │
│                                              │
│  ┌──────────┐   ┌───────────────────────┐   │
│  │ IPC      │   │ Socket Server          │   │
│  │ handlers │   │ ~/Library/App Support/ │   │
│  │ (UI)     │   │ agentrunner/           │   │
│  └────┬─────┘   │ agentrunner.sock       │   │
│       │         └───────────┬────────────┘   │
│       │                     │                │
│       └──────┬──────────────┘                │
│              ▼                                │
│     Shared service layer                     │
│     (config, database, executor, scheduler)  │
└─────────────────────────────────────────────┘
        ▲                     ▲
        │ IPC                 │ Unix socket (JSON protocol)
        │                     │
   React UI              agentrunner-cli
   (renderer)            (Node.js script)
```

## Components

### 1. Shared service layer (refactor)

Extract the business logic currently inline in `ipc.ts` handlers into a `src/main/services.ts` module. Both the IPC handlers and the socket server call the same functions. This avoids duplicating logic.

### 2. API token auth

- Token stored in `config.json` as `apiToken: string | null`.
- New UI button in Settings: "Generate API Token" → generates a random 32-byte hex token, displays it once, saves to config.
- CLI sends the token in every request. Socket server validates it before processing.
- Token file also written to `~/.agentrunner-token` (readable only by the user, `chmod 600`) so the CLI can auto-read it without the user passing `--token` every time.

### 3. Socket server (`src/main/socket-server.ts`)

- Listens on `~/Library/Application Support/agentrunner/agentrunner.sock`.
- Simple JSON-over-newline protocol: client sends `{method, params, token}\n`, server responds `{ok, data?, error?}\n`.
- Methods map 1:1 to the service layer functions.
- Cleans up stale socket file on startup.
- For `run` with streaming: after the initial response (run ID), the server pushes `{event: "output", data}` lines until the run completes, then sends `{event: "done"}`. Client can opt in with `{method: "run", params: {agentId, stream: true}}`.

### 4. CLI (`src/cli/agentrunner-cli.ts`)

- Single-file Node.js script, compiled alongside the app.
- Installed globally via `npm link` or symlinked to `/usr/local/bin/agentrunner-cli`.
- Parses args with a minimal parser (no heavy deps — just process.argv parsing).
- Connects to the socket, sends JSON, prints results.
- `--json` flag on any command outputs raw JSON; default is formatted tables/text.
- `help` command prints the full command reference.

### 5. Settings UI addition

- Add "API Token" section to `SettingsPanel.tsx`: Generate / Regenerate / Revoke buttons, shows token once on generate.

## Protocol Methods

| CLI Command | Socket Method | Params |
|---|---|---|
| `agents list` | `agents.list` | — |
| `agents show <id>` | `agents.get` | `{id}` |
| `agents create` | `agents.create` | `{name, executionCommand, ...}` |
| `agents edit <id>` | `agents.update` | `{id, ...fields}` |
| `agents delete <id>` | `agents.delete` | `{id}` |
| `agents enable <id>` | `agents.toggle` | `{id}` |
| `agents disable <id>` | `agents.toggle` | `{id}` |
| `runs list [agent-id]` | `runs.list` | `{agentId?}` |
| `runs show <run-id>` | `runs.get` | `{runId}` |
| `runs logs <run-id>` | `runs.logs` | `{runId, stream?: "stderr"}` |
| `runs artifacts <run-id>` | `runs.artifacts` | `{runId}` |
| `run <agent-id>` | `run.start` | `{agentId, stream?: true}` |
| `cancel <run-id>` | `run.cancel` | `{runId}` |
| `prompt show <id>` | `prompt.get` | `{agentId}` |
| `prompt edit <id>` | `prompt.save` | `{agentId, content}` |
| `prompt history <id>` | `prompt.history` | `{agentId}` |
| `config show` | `config.get` | — |
| `config set <k> <v>` | `config.set` | `{key, value}` |
| `status` | `status` | — |

## File Changes

| File | Change |
|---|---|
| `src/main/services.ts` | **New** — extracted business logic from ipc.ts |
| `src/main/ipc.ts` | Refactor to call services.ts |
| `src/main/socket-server.ts` | **New** — Unix socket server |
| `src/main/main.ts` | Start socket server on app ready, stop on quit |
| `src/main/config.ts` | Add `apiToken` to config, add token file helpers |
| `src/shared/types.ts` | Add `apiToken` to `AppConfig` |
| `src/cli/agentrunner-cli.ts` | **New** — CLI entry point |
| `src/renderer/SettingsPanel.tsx` | Add API token generate/revoke UI |
| `package.json` | Add `bin` entry for CLI, build script |
| `README.md` | CLI installation and usage docs |

## Implementation Order

1. Extract `services.ts` from `ipc.ts`
2. Add API token to config + types + token file helpers
3. Build socket server
4. Wire socket server into `main.ts` lifecycle
5. Refactor `ipc.ts` to use services
6. Build CLI
7. Add token management UI to Settings
8. Update `package.json` (bin entry)
9. Update `README.md`
