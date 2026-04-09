# AgentRunner

A macOS desktop app that runs AI agent processes on a configurable schedule. Define agents with an execution command, a prompt, and a cron schedule — AgentRunner handles process lifecycle, captures output, stores artifacts, and provides a UI to browse current and past runs.

Built with Electron, React, SQLite, and node-cron.

## Features

- **Cron-based scheduling** — run agents on any cron schedule (hourly, daily, weekly, or custom)
- **Manual runs** — trigger any agent immediately with "Run Now"
- **Live output streaming** — watch stdout/stderr in real-time as agents execute
- **Artifact capture** — automatically detects new/modified files in the working directory and copies them to a per-run artifacts folder
- **Markdown viewer** — `.md` artifacts render inline with syntax-highlighted code blocks
- **Prompt management** — edit prompts with a split-pane markdown editor, version history with restore
- **Run history** — browse past runs with status, duration, exit codes, logs, and artifacts
- **System tray** — minimizes to menu bar, sends macOS notifications on run completion/failure
- **Hand-editable config** — `agents.json` and `config.json` are human-readable JSON files

## Screenshots

The UI has a sidebar listing agents (with status indicators), a detail panel showing the selected agent's info, prompt, current run, and run history, and a bottom status bar.

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js 20+
- npm 9+

## Getting Started

```bash
# Install dependencies
npm install

# Development (two terminals)
npm run dev       # Terminal 1: starts tsc watch + Vite dev server
npm run start     # Terminal 2: launches Electron (after Vite shows "ready")

# Or, single command build + run
npm run build && npm run start

# Package as a distributable .app / .dmg
npm run dist
```

The packaged app is output to `release/`.

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── main.ts             # App entry: window, tray, lifecycle
│   ├── preload.ts          # Secure IPC bridge (contextBridge)
│   ├── database.ts         # SQLite schema, migrations, CRUD
│   ├── config.ts           # config.json / agents.json management
│   ├── ipc.ts              # IPC handlers for all renderer ↔ main communication
│   ├── scheduler.ts        # node-cron scheduling engine
│   └── executor.ts         # Process spawning, output capture, artifact detection
├── renderer/               # React UI (bundled by Vite)
│   ├── App.tsx             # Main app shell: sidebar, detail panel, status bar
│   ├── AgentForm.tsx       # Create/edit agent modal
│   ├── SettingsPanel.tsx   # App settings modal
│   ├── PromptEditor.tsx    # Full-screen prompt editor with markdown preview
│   ├── RunDetail.tsx       # Run viewer: output tabs, artifacts, prompt used
│   ├── styles.css          # All styles
│   ├── main.tsx            # React entry point
│   └── index.html          # HTML shell
├── shared/
│   └── types.ts            # TypeScript types and IPC channel constants
assets/                     # App icon (PNG) and tray icons
build/                      # macOS .icns icon for electron-builder
```

## Data Directory

All runtime data is stored in `~/Library/Application Support/agentrunner/`:

```
data/
├── config.json             # App settings
├── agents.json             # Agent definitions (source of truth for config)
└── agents/
    └── <agent-id>/
        ├── prompt.md       # Current prompt
        ├── prompt-history/  # Versioned prompt snapshots
        └── runs/
            └── <run-id>/
                ├── meta.json
                ├── stdout.log
                ├── stderr.log
                └── artifacts/   # Captured output files
agentrunner.db              # SQLite database (run history, prompt versions)
```

## Agent Configuration

Agents are defined in `agents.json` and can be created via the UI or hand-edited:

```json
{
  "agents": [
    {
      "id": "vuln-scanner",
      "name": "Vulnerability Scanner",
      "executionCommand": "kiro-cli chat --trust-all-tools --no-interactive",
      "workingDirectory": "/Users/me/projects/myapp",
      "schedule": {
        "cron": "0 9 * * 1",
        "humanReadable": "Every Monday at 9:00 AM"
      },
      "timeoutMinutes": 15,
      "environmentVariables": {
        "MY_VAR": "value"
      },
      "enabled": true,
      "createdAt": "2026-04-09T10:00:00Z",
      "updatedAt": "2026-04-09T10:00:00Z"
    }
  ]
}
```

## How Runs Work

1. Cron triggers (or user clicks "Run Now")
2. The current `prompt.md` is snapshotted and versioned (if changed)
3. The working directory is snapshotted (file mtimes recorded)
4. The execution command is spawned with the prompt piped to stdin
5. stdout/stderr are captured to log files and streamed live to the UI
6. On completion, new/modified files in the working directory are copied to the run's `artifacts/` folder
7. Artifacts are recorded in SQLite and viewable in the UI
8. Log retention policy is applied (configurable, default: keep last 5 runs' logs)
9. macOS notification is sent based on settings

### Environment Variables

Every agent process receives these environment variables:

| Variable | Description |
|---|---|
| `AGENT_ARTIFACTS_DIR` | Absolute path to the run's artifacts directory |
| `AGENT_PROMPT_FILE` | Absolute path to the agent's `prompt.md` |
| `AGENT_RUN_ID` | Unique run identifier |
| `AGENT_NAME` | Agent ID/slug |
| *(user-defined)* | From `environmentVariables` in agent config |

## App Settings

Configurable via the gear icon or by editing `config.json`:

| Setting | Default | Description |
|---|---|---|
| `launchOnStartup` | `true` | Register as macOS login item |
| `logRetentionRuns` | `5` | Keep stdout/stderr for the last N runs per agent |
| `notifications.onRunComplete` | `true` | Notify on successful completion |
| `notifications.onRunFailed` | `true` | Notify on failure |
| `notifications.onRunTimedOut` | `true` | Notify on timeout |
| `notifications.onRunCancelled` | `false` | Notify on manual cancel |

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 30 |
| UI | React 18 |
| Build | Vite + TypeScript |
| Scheduling | node-cron |
| Database | SQLite (better-sqlite3) |
| Markdown | react-markdown + rehype-highlight |
| Packaging | electron-builder |

## License

MIT
