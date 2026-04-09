# AgentRunner — Application Specification

**Version:** 1.0  
**Date:** 2026-04-09  
**Platform:** macOS only  
**Type:** Single-user local Electron desktop application

---

## 1. Overview

AgentRunner is a macOS Electron app that runs AI agent processes on a configurable schedule (cron-style). Users define agents with an execution command, an input prompt, and a schedule. The app manages process lifecycle, captures output, stores artifacts, and provides a UI to browse current and past runs.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| UI | React |
| Scheduling | node-cron |
| Terminal output | node-pty |
| Database | SQLite (run history, metadata) |
| Config format | JSON (on-disk, hand-editable) |
| Markdown rendering | react-markdown + rehype-highlight (syntax highlighting + code blocks) |

---

## 3. Data Directory Structure

All data lives within the app's own directory:

```
<app-directory>/
├── config.json                          # System-level settings
├── agents.json                          # Agent definitions
├── agents/
│   └── <agent-name>/
│       ├── prompt.md                    # Current prompt (mutable by running agents)
│       ├── prompt-history/
│       │   ├── v1_2026-04-09T10-00-00.md
│       │   ├── v2_2026-04-09T12-30-00.md
│       │   └── ...
│       └── runs/
│           └── <run-id>/
│               ├── meta.json            # Run metadata
│               ├── stdout.log           # Captured stdout
│               ├── stderr.log           # Captured stderr
│               └── artifacts/           # Output files produced by the agent
```

---

## 4. System-Level Configuration (`config.json`)

```json
{
  "launchOnStartup": true,
  "logRetentionRuns": 5,
  "runRetentionPolicy": "forever",
  "notifications": {
    "onRunComplete": true,
    "onRunFailed": true,
    "onRunTimedOut": true,
    "onRunCancelled": false
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `launchOnStartup` | boolean | `true` | Register as a macOS login item |
| `logRetentionRuns` | number | `5` | Keep stdout/stderr logs for the last N runs per agent. Older logs are deleted; run metadata is preserved. |
| `runRetentionPolicy` | `"forever"` \| `{ "keepLast": number }` \| `{ "keepDays": number }` | `"forever"` | When to auto-delete full run records. |
| `notifications.onRunComplete` | boolean | `true` | macOS notification on successful completion |
| `notifications.onRunFailed` | boolean | `true` | macOS notification on failure |
| `notifications.onRunTimedOut` | boolean | `true` | macOS notification on timeout |
| `notifications.onRunCancelled` | boolean | `false` | macOS notification on manual cancel |

---

## 5. Agent Definition (`agents.json`)

```json
{
  "agents": [
    {
      "id": "vuln-scanner",
      "name": "Vulnerability Scanner",
      "executionCommand": "kiro-cli chat --trust-all-tools",
      "workingDirectory": "/Users/me/projects/myapp",
      "schedule": {
        "cron": "0 9 * * 1",
        "humanReadable": "Every Monday at 9:00 AM"
      },
      "timeoutMinutes": 15,
      "environmentVariables": {
        "IMDB_PORT": "4000"
      },
      "enabled": true,
      "createdAt": "2026-04-09T10:00:00Z",
      "updatedAt": "2026-04-09T10:00:00Z"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique slug identifier (auto-generated from name, editable) |
| `name` | string | yes | Display name |
| `executionCommand` | string | yes | The CLI command to execute (e.g. `kiro-cli chat --trust-all-tools`, `claude --dangerously-skip-permissions`, `codex --ask-for-approval never --sandbox danger-full-access`) |
| `workingDirectory` | string | yes | Absolute path used as cwd for the process |
| `schedule.cron` | string | yes | Standard 5-field cron expression |
| `schedule.humanReadable` | string | no | Auto-generated human-readable description of the cron schedule |
| `timeoutMinutes` | number | yes | Kill the process after this many minutes. Default: `15` |
| `environmentVariables` | object | no | Key-value pairs merged with system env. These take precedence over inherited vars. |
| `enabled` | boolean | yes | Whether the agent's schedule is active |
| `createdAt` | ISO 8601 | yes | Creation timestamp |
| `updatedAt` | ISO 8601 | yes | Last modification timestamp |

### Schedule Configuration

The UI provides two modes for setting the schedule:

1. **Simple mode** — dropdowns/inputs: "Every N minutes", "Daily at HH:MM", "Weekly on DAY at HH:MM", "Monthly on DAY at HH:MM"
2. **Advanced mode** — raw 5-field cron expression input with a preview of the next 5 run times

Both modes produce a cron expression stored in `schedule.cron`. The `humanReadable` field is auto-generated.

---

## 6. Prompt Management

### Storage

- The current prompt lives at `agents/<agent-name>/prompt.md`.
- This file is readable and writable by the running agent process (the path is passed via the `AGENT_PROMPT_FILE` env var).
- Changes made by a running agent are picked up by the **next** scheduled run, not the current one.

### Versioning

- Every time a prompt is saved (via UI edit or detected file change before a run starts), a versioned copy is created in `agents/<agent-name>/prompt-history/` with the naming pattern `v<N>_<ISO-timestamp>.md`.
- Full history is retained (no pruning).
- Each run's `meta.json` records the prompt version used and a snapshot of the prompt content.

### Delivery to Process

The prompt is delivered via stdin redirection:

```
<executionCommand> < <path-to-prompt-snapshot>
```

A temporary snapshot of the prompt is created at run start to ensure the running process gets a consistent prompt even if the file is modified during execution.

---

## 7. Run Lifecycle

### States

```
Scheduled → Running → Completed
                    → Failed
                    → Timed Out
                    → Cancelled
```

| State | Description |
|---|---|
| `Scheduled` | Next run is pending per cron schedule |
| `Running` | Process is currently executing |
| `Completed` | Process exited with code 0 |
| `Failed` | Process exited with non-zero code |
| `Timed Out` | Process was killed after exceeding `timeoutMinutes` |
| `Cancelled` | User manually stopped the process via UI |

### Concurrency

- Different agents may run simultaneously with no restrictions.
- The **same agent** may have multiple concurrent runs (e.g. if a cron trigger fires while a previous run is still active, a new instance starts in parallel).

### Run Metadata (`meta.json`)

```json
{
  "runId": "20260409-090000-a1b2c3",
  "agentId": "vuln-scanner",
  "status": "Completed",
  "startedAt": "2026-04-09T09:00:00Z",
  "completedAt": "2026-04-09T09:12:34Z",
  "exitCode": 0,
  "promptVersion": 3,
  "promptContent": "Find all SQL injection vulnerabilities in...",
  "timeoutMinutes": 15,
  "artifacts": [
    "artifacts/report.md",
    "artifacts/findings.json"
  ]
}
```

### Artifacts

- The app creates a per-run artifacts directory at `agents/<agent-name>/runs/<run-id>/artifacts/`.
- The path is passed to the process as the `AGENT_ARTIFACTS_DIR` environment variable.
- After the process completes, the app scans this directory and records the file list in `meta.json`.

### Environment Variables Passed to Every Run

| Variable | Value |
|---|---|
| `AGENT_ARTIFACTS_DIR` | Absolute path to the run's artifacts directory |
| `AGENT_PROMPT_FILE` | Absolute path to the agent's `prompt.md` file |
| `AGENT_RUN_ID` | The unique run ID |
| `AGENT_NAME` | The agent's ID/slug |
| *(user-defined)* | From `environmentVariables` in agent config |

---

## 8. Log Management

- `stdout` and `stderr` are captured to separate files (`stdout.log`, `stderr.log`) per run.
- For the currently running process, output is streamed live to the UI via node-pty.
- Log files are subject to the `logRetentionRuns` system setting. When a new run completes, if the agent has more than N runs with log files, the oldest log files are deleted. The `meta.json` for those runs is preserved.

---

## 9. UI Layout

### Window Structure

```
┌──────────────────────────────────────────────────────────┐
│  AgentRunner                                    [⚙] [—] │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│  AGENTS      │  AGENT DETAIL PANEL                      │
│              │                                           │
│  ● Vuln Scan │  ┌─ Info Bar ──────────────────────────┐ │
│  ○ Enhance   │  │ Name | Schedule | Next Run | [▶ Run]│ │
│  ○ Refactor  │  └─────────────────────────────────────┘ │
│              │                                           │
│              │  ┌─ Prompt ────────────────────────────┐ │
│              │  │ [Edit] [History]                     │ │
│              │  │ Current prompt content preview...    │ │
│              │  └─────────────────────────────────────┘ │
│              │                                           │
│              │  ┌─ Current Run ───────────────────────┐ │
│              │  │ Status: Running | Started: 9:00 AM  │ │
│              │  │ [stdout] [stderr]  [Cancel]         │ │
│              │  │ > live terminal output...            │ │
│              │  └─────────────────────────────────────┘ │
│              │                                           │
│              │  ┌─ Run History ───────────────────────┐ │
│              │  │ Run #5 | Completed | 9:00-9:12      │ │
│              │  │ Run #4 | Failed    | 8:00-8:03      │ │
│              │  │ Run #3 | Completed | 7:00-7:15      │ │
│              │  └─────────────────────────────────────┘ │
│              │                                           │
│  [+ New]     │                                           │
├──────────────┴───────────────────────────────────────────┤
│  Status: 2 agents running | Next run: Vuln Scan @ 10:00 │
└──────────────────────────────────────────────────────────┘
```

### Sidebar (Agent List)

- Lists all defined agents by name.
- Visual indicator for agent state:
  - `●` (filled dot / green) — currently running
  - `○` (hollow dot / gray) — idle/scheduled
  - `⊘` (disabled indicator) — agent is disabled
- `[+ New]` button at the bottom to create a new agent.
- Right-click context menu: Edit, Duplicate, Delete, Enable/Disable.

### Agent Detail Panel

#### Info Bar
- Agent name (editable inline)
- Schedule display (human-readable + cron expression)
- Next scheduled run time
- `[▶ Run Now]` button — triggers an immediate run outside the schedule
- `[Edit]` button — opens agent configuration modal

#### Prompt Section
- Shows a preview of the current prompt content (first ~10 lines).
- `[Edit]` — opens a full-screen editor for the prompt with markdown preview.
- `[History]` — opens a panel showing all prompt versions with timestamps. Clicking a version shows a diff against the current version. Option to restore a previous version.

#### Current Run Section
- Visible only when a run is active (or the most recent run if nothing is active).
- Shows: status badge, start time, prompt version used.
- Two tabs: `stdout` and `stderr` — each shows live-streaming terminal output.
- `[Cancel]` button — sends SIGTERM, waits 5 seconds, then SIGKILL if still alive.

#### Run History Section
- Scrollable list of past runs, newest first.
- Each row shows: run number, status badge (color-coded), start time, completion time, duration, prompt version.
- Clicking a run expands it to show:
  - The prompt content used for that run.
  - stdout/stderr logs (if still retained).
  - Artifacts list:
    - `.md` files — rendered inline with syntax-highlighted code blocks.
    - All other files — shown as a file name + size with an "Open in Finder" button.
  - `[Delete Run]` button — permanently removes the run directory and database record after confirmation.

### Settings Panel (⚙ gear icon)

Accessible from the top-right gear icon. Sections:

- **General**: Launch on startup toggle.
- **Log Retention**: Number input for `logRetentionRuns`.
- **Run Retention**: Dropdown for policy (forever, keep last N, keep N days).
- **Notifications**: Toggle for each notification type (complete, failed, timed out, cancelled).

All settings are persisted to `config.json` and can also be hand-edited.

### Status Bar

Bottom bar showing:
- Number of currently running agents.
- Next upcoming scheduled run (agent name + time).

---

## 10. System Tray

- The app installs a macOS menu bar (tray) icon.
- **Left-click**: Toggle main window visibility.
- **Right-click**: Context menu:
  - Agent statuses (name + running/idle/disabled)
  - Separator
  - "Open AgentRunner"
  - "Settings"
  - Separator
  - "Quit"
- When the window is closed (red button), the app minimizes to tray instead of quitting.
- macOS native notifications are sent based on `config.json` notification settings.

---

## 11. Agent CRUD Operations

### Create Agent
1. Click `[+ New]` in sidebar.
2. Modal form with fields: Name, Execution Command, Working Directory (with folder picker), Schedule (simple/advanced toggle), Timeout, Environment Variables (key-value pair editor).
3. On save: generates agent ID from name, creates directory structure, creates empty `prompt.md`, writes to `agents.json`.

### Edit Agent
1. Click `[Edit]` in the info bar or right-click → Edit in sidebar.
2. Same modal as create, pre-filled with current values.
3. On save: updates `agents.json`, updates `updatedAt`.

### Delete Agent
1. Right-click → Delete in sidebar.
2. Confirmation dialog: "Delete agent 'X' and all its runs? This cannot be undone."
3. On confirm: removes agent from `agents.json`, deletes `agents/<agent-name>/` directory, removes all database records.

### Duplicate Agent
1. Right-click → Duplicate in sidebar.
2. Creates a copy with name "X (Copy)" and a new ID. Copies the current prompt. Does not copy run history.

### Enable/Disable Agent
1. Right-click → Enable/Disable in sidebar.
2. Toggles `enabled` field. Disabled agents do not trigger scheduled runs but retain all data and can still be run manually.

---

## 12. Database Schema (SQLite)

```sql
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    execution_command TEXT NOT NULL,
    working_directory TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    timeout_minutes INTEGER NOT NULL DEFAULT 15,
    environment_variables TEXT, -- JSON string
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Scheduled','Running','Completed','Failed','Timed Out','Cancelled')),
    started_at TEXT,
    completed_at TEXT,
    exit_code INTEGER,
    prompt_version INTEGER,
    prompt_content TEXT,
    timeout_minutes INTEGER,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE prompt_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_agent_id ON runs(agent_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX idx_prompt_versions_agent ON prompt_versions(agent_id, version);
```

Note: The SQLite database is the source of truth for run history and prompt versions. The `agents.json` file is the source of truth for agent configuration (synced to the `agents` table on app start and on config change). This allows hand-editing of `agents.json` while keeping query-friendly run data in SQLite.

---

## 13. Process Execution Flow

```
1. Cron triggers (or user clicks "Run Now")
2. Create run directory: agents/<agent-id>/runs/<run-id>/artifacts/
3. Snapshot current prompt.md → temp file
4. Record prompt version in prompt_versions table (if changed since last version)
5. Insert run record into SQLite (status: Running)
6. Spawn child process:
     cd <workingDirectory>
     env AGENT_ARTIFACTS_DIR=<abs-path> \
         AGENT_PROMPT_FILE=<abs-path-to-prompt.md> \
         AGENT_RUN_ID=<run-id> \
         AGENT_NAME=<agent-id> \
         <user-env-vars> \
     <executionCommand> < <prompt-snapshot-temp-file>
7. Stream stdout → stdout.log + UI (via node-pty)
   Stream stderr → stderr.log + UI
8. Start timeout timer
9. On process exit:
   a. Record exit code, completion time, status in SQLite
   b. Scan artifacts/ directory, record files in artifacts table
   c. Clean up temp prompt snapshot
   d. Apply log retention policy (delete oldest logs if > N runs)
   e. Send macOS notification per config
```

---

## 14. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘ + N` | New agent |
| `⌘ + R` | Run selected agent now |
| `⌘ + ,` | Open settings |
| `⌘ + W` | Minimize to tray |
| `⌘ + Q` | Quit application |
| `⌘ + E` | Edit selected agent's prompt |
| `Esc` | Close modal / panel |

---

## 15. Notifications

Uses macOS native `Notification` API via Electron. Each notification includes:

- **Title**: "AgentRunner — \<Agent Name\>"
- **Body**: Status message (e.g. "Run completed in 12m 34s", "Run failed with exit code 1", "Run timed out after 15 minutes")
- **Click action**: Opens the app and navigates to the relevant run.

---

## 16. Error Handling

| Scenario | Behavior |
|---|---|
| Execution command not found | Run status → Failed, stderr captures error, notification sent |
| Working directory doesn't exist | Run status → Failed, error logged before process spawn |
| Prompt file missing/empty | Run status → Failed, error logged |
| Process timeout | SIGTERM → 5s grace → SIGKILL, status → Timed Out |
| Disk full | Log error to app log, notification sent, run status → Failed |
| SQLite corruption | App shows error banner, attempts WAL recovery |
| agents.json parse error | App shows error banner with details, uses last known good config from SQLite |

---

## 17. Future Considerations (Out of Scope for v1)

- Windows/Linux support
- Agent dependencies (run B after A completes)
- Remote agent execution
- Agent templates / marketplace
- Webhook/API triggers
- Multi-user / team sharing
- Encrypted secrets in environment variables
- Run comparison (diff artifacts between two runs)
