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
- **CLI remote control** — `agentrunner-cli` lets you manage agents, trigger runs, and view results from the terminal (great for SSH access)

## Screenshots

The UI has a sidebar listing agents (with status indicators), a detail panel showing the selected agent's info, prompt, current run, and run history, and a bottom status bar.

## Requirements

- macOS 13 (Ventura) or later — Apple Silicon or Intel
- Node.js 20+
- npm 9+ (included with Node.js)
- Xcode Command Line Tools (for compiling native dependencies)

## Installation

These steps walk you through building AgentRunner from source and installing it as a regular macOS app. Everything is done in **Terminal** (find it in Applications → Utilities → Terminal).

### 1. Install Xcode Command Line Tools

AgentRunner depends on native modules (`better-sqlite3`, `node-pty`) that must be compiled on your machine. This requires Apple's build tools.

Run this in Terminal:

```bash
xcode-select --install
```

A dialog will appear — click **Install** and wait for it to finish. If you see "already installed", you're good to go.

### 2. Install Node.js

If you don't have Node.js installed, the easiest way is to download the installer from the official website:

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** version (20 or later)
3. Open the downloaded `.pkg` file and follow the prompts

To verify it worked, run:

```bash
node --version   # should print v20.x.x or higher
npm --version    # should print 9.x.x or higher
```

> **Alternative (Homebrew):** If you use Homebrew, you can run `brew install node@20` instead.

### 3. Download AgentRunner

Clone the repository (or download and unzip it):

```bash
git clone <repository-url>
cd agentrunner
```

If you downloaded a ZIP file, unzip it and open Terminal in that folder:

```bash
cd ~/Downloads/agentrunner   # adjust to wherever you unzipped it
```

### 4. Install dependencies

```bash
npm install
```

This downloads all required packages and compiles the native modules for Electron. It may take a few minutes the first time. You'll see a lot of output — warnings are normal, errors are not.

> **Troubleshooting:** If you see errors about `node-gyp`, `better-sqlite3`, or `node-pty` failing to build, make sure Xcode Command Line Tools are installed (step 1). You can also try `sudo xcode-select --reset` and then run `npm install` again.

### 5. Build and package the app

```bash
npm run dist
```

This compiles the TypeScript source, bundles the UI, and packages everything into a macOS `.dmg` installer. It takes 1–3 minutes.

When it finishes, you'll find the output in the `release/` folder:

```
release/
├── AgentRunner-1.0.0.dmg        # Disk image installer
├── AgentRunner-1.0.0-mac.zip    # Zipped .app bundle
└── mac/
    └── AgentRunner.app           # The app itself
```

### 6. Install the app

**Option A — Use the DMG (recommended):**

1. Open `release/AgentRunner-1.0.0.dmg`
2. Drag **AgentRunner** into your **Applications** folder
3. Eject the disk image

**Option B — Direct copy:**

```bash
cp -r release/mac/AgentRunner.app /Applications/
```

### 7. First launch

When you first open AgentRunner, macOS may show a warning because the app isn't signed with an Apple Developer certificate:

1. Open **System Settings → Privacy & Security**
2. Scroll down — you'll see a message about AgentRunner being blocked
3. Click **Open Anyway**

You only need to do this once. After that, the app opens normally.

> **Tip:** AgentRunner runs in the menu bar. If you close the window, look for the icon in your menu bar (top-right of the screen) to reopen it.

## Development

For working on AgentRunner's code, use the development workflow instead of building a `.dmg` each time:

```bash
# Terminal 1: start the TypeScript compiler and Vite dev server
npm run dev

# Terminal 2: launch Electron (wait until Terminal 1 shows "ready")
npm run start
```

Or as a single build-and-run:

```bash
npm run build && npm run start
```

To rebuild the distributable `.dmg` after making changes:

```bash
npm run dist
```

The packaged app is output to `release/`.

## CLI (Remote Control)

AgentRunner includes a command-line tool (`agentrunner-cli`) that communicates with the running desktop app over a Unix domain socket. This is useful for managing agents over SSH without needing the GUI.

### Setup

**1. Build the CLI:**

```bash
npm run build:cli
```

**2. Install it globally (makes `agentrunner-cli` available anywhere):**

```bash
npm link
```

Or create a symlink manually:

```bash
ln -sf "$(pwd)/dist/cli/agentrunner-cli.js" /usr/local/bin/agentrunner-cli
```

**3. Generate an API token:**

Open AgentRunner → Settings (gear icon) → **CLI Access** → click **Generate Token**.

The token is automatically saved to `~/.agentrunner-token` so the CLI picks it up. You can also set the `AGENTRUNNER_TOKEN` environment variable instead.

**4. Verify it works:**

```bash
agentrunner-cli status
```

> **Note:** The AgentRunner desktop app must be running for the CLI to work. The CLI is a thin client — all logic runs in the Electron app.

### Commands

```
agentrunner-cli agents list                     List all agents
agentrunner-cli agents show <id>                Show agent details
agentrunner-cli agents create --name <n> --command <c> --workdir <d> [--cron <expr>] [--timeout <min>]
                                                Create a new agent
agentrunner-cli agents edit <id> [--name <n>] [--command <c>] [--workdir <d>] [--cron <expr>]
                                                Update an agent
agentrunner-cli agents delete <id>              Delete an agent
agentrunner-cli agents enable <id>              Enable an agent
agentrunner-cli agents disable <id>             Disable an agent

agentrunner-cli runs list [agent-id]            List recent runs
agentrunner-cli runs show <run-id>              Show run details
agentrunner-cli runs logs <run-id> [--stderr]   Print run stdout (or stderr)
agentrunner-cli runs artifacts <run-id>         List run artifacts

agentrunner-cli run <agent-id>                  Start an ad-hoc run (streams output live)
agentrunner-cli cancel <run-id>                 Cancel a running agent

agentrunner-cli prompt show <agent-id>          Print current prompt
agentrunner-cli prompt edit <agent-id>          Edit prompt in $EDITOR
agentrunner-cli prompt history <agent-id>       List prompt versions

agentrunner-cli config show                     Print app config
agentrunner-cli config set <key> <value>        Update a config setting

agentrunner-cli status                          Overview: agent counts, running agents
agentrunner-cli help                            Show help
```

### JSON Output

Add `--json` to any command for machine-readable output:

```bash
agentrunner-cli agents list --json
agentrunner-cli runs list my-agent --json | jq '.[0].status'
```

### SSH Workflow

Once the CLI is installed and a token is generated, you can manage AgentRunner remotely:

```bash
ssh my-mac
agentrunner-cli status                          # check what's running
agentrunner-cli run vuln-scanner                # kick off a run, watch output live
agentrunner-cli runs logs <run-id>              # review past output
agentrunner-cli agents create --name "nightly-tests" --command "kiro-cli chat --trust-all-tools --no-interactive" --workdir ~/projects/myapp --cron "0 2 * * *"
```

## Project Structure

```
src/
├── cli/
│   └── agentrunner-cli.ts  # CLI entry point (standalone Node.js script)
├── main/                   # Electron main process
│   ├── main.ts             # App entry: window, tray, lifecycle
│   ├── preload.ts          # Secure IPC bridge (contextBridge)
│   ├── database.ts         # SQLite schema, migrations, CRUD
│   ├── config.ts           # config.json / agents.json management
│   ├── services.ts         # Shared business logic (used by IPC + socket server)
│   ├── ipc.ts              # IPC handlers for all renderer ↔ main communication
│   ├── socket-server.ts    # Unix domain socket server for CLI access
│   ├── scheduler.ts        # node-cron scheduling engine
│   └── executor.ts         # Process spawning, output capture, artifact detection
├── renderer/               # React UI (bundled by Vite)
│   ├── App.tsx             # Main app shell: sidebar, detail panel, status bar
│   ├── AgentForm.tsx       # Create/edit agent modal
│   ├── SettingsPanel.tsx   # App settings modal (includes API token management)
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
