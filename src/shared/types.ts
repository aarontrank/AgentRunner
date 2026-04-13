// CLI preset — controls which structured options panel appears in the form
export type CliPreset = 'custom' | 'claude' | 'kiro' | 'codex';

// Claude Code-specific options (map to CLI flags at spawn time)
export interface ClaudeOptions {
  model?: string;                                          // --model
  maxTurns?: number;                                       // --max-turns
  outputFormat?: 'text' | 'stream-json';                  // --output-format
  sessionMode?: 'fresh' | 'continue';                     // --continue
  permissionMode?: 'bypass' | 'allowedTools' | 'default'; // --dangerously-skip-permissions | --allowedTools | (none)
  allowedTools?: string;                                   // comma-separated, e.g. "Bash,Read,Write"
}

// Agent definition matching agents.json schema
export interface Agent {
  id: string;
  name: string;
  executionCommand: string;
  workingDirectory: string;
  schedule: { cron: string; humanReadable?: string };
  timeoutMinutes: number;
  environmentVariables?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  cliPreset?: CliPreset;
  claudeOptions?: ClaudeOptions;
}

// Run states
export type RunStatus = 'Scheduled' | 'Running' | 'Completed' | 'Failed' | 'Timed Out' | 'Cancelled';

// Run record
export interface Run {
  runId: string;
  agentId: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  promptVersion?: number;
  promptContent?: string;
  timeoutMinutes: number;
}

// Artifact record
export interface Artifact {
  id?: number;
  runId: string;
  fileName: string;
  filePath: string;
  fileSize?: number;
}

// Prompt version record
export interface PromptVersion {
  id?: number;
  agentId: string;
  version: number;
  content: string;
  createdAt: string;
}

// System config matching config.json
export interface AppConfig {
  launchOnStartup: boolean;
  logRetentionRuns: number;
  runRetentionPolicy: 'forever' | { keepLast: number } | { keepDays: number };
  notifications: {
    onRunComplete: boolean;
    onRunFailed: boolean;
    onRunTimedOut: boolean;
    onRunCancelled: boolean;
  };
}

// IPC channel names
export const IPC = {
  // Agent CRUD
  AGENTS_LIST: 'agents:list',
  AGENT_GET: 'agent:get',
  AGENT_CREATE: 'agent:create',
  AGENT_UPDATE: 'agent:update',
  AGENT_DELETE: 'agent:delete',
  AGENT_DUPLICATE: 'agent:duplicate',
  AGENT_TOGGLE: 'agent:toggle',

  // Runs
  RUN_START: 'run:start',
  RUN_CANCEL: 'run:cancel',
  RUNS_LIST: 'runs:list',
  RUN_GET: 'run:get',
  RUN_DELETE: 'run:delete',
  RUN_OUTPUT: 'run:output',
  RUN_STATUS_CHANGED: 'run:statusChanged',

  // Prompt
  PROMPT_GET: 'prompt:get',
  PROMPT_SAVE: 'prompt:save',
  PROMPT_HISTORY: 'prompt:history',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',

  // Artifacts
  ARTIFACTS_LIST: 'artifacts:list',
  ARTIFACT_OPEN: 'artifact:open',
  ARTIFACT_CONTENT: 'artifact:content',

  // Logs
  LOG_GET: 'log:get',

  // CLAUDE.md (read/write file in agent's workingDirectory)
  CLAUDE_MD_GET: 'claudemd:get',
  CLAUDE_MD_SAVE: 'claudemd:save',
} as const;
