import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import { Agent, ClaudeOptions, IPC, RunStatus } from '../shared/types';
import {
  getPromptPath, getRunDir, getArtifactsDir, getConfig,
  getPromptHistoryDir,
} from './config';
import {
  dbRunInsert, dbRunUpdateStatus, dbRunsForAgent,
  dbArtifactInsert, dbPromptLatestVersion, dbPromptLatestContent, dbPromptInsert,
} from './database';
import { sendNotification } from './main';

// Resolve the user's full login shell PATH (packaged apps get a minimal /bin/sh PATH)
let userPath: string | null = null;

export function initShellPath(): Promise<void> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const child = spawn(shell, ['-ilc', 'echo __PATH__=$PATH'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', () => {
      const match = out.match(/__PATH__=(.+)/);
      if (match) userPath = match[1].trim();
      resolve();
    });
    child.on('error', () => resolve());
    setTimeout(() => resolve(), 3000); // don't hang forever
  });
}

// Track active processes: runId -> ChildProcess
const activeProcesses = new Map<string, ChildProcess>();

// Guard: prevent finishRun from executing twice for the same run (e.g. timeout + close)
const finishedRuns = new Set<string>();

// Track runs that were explicitly cancelled so close handler uses 'Cancelled' status
const cancelledRuns = new Set<string>();

export function getActiveProcesses() { return activeProcesses; }
export function getFinishedRuns() { return finishedRuns; }
export function getCancelledRuns() { return cancelledRuns; }

export function isAgentRunning(agentId: string): boolean {
  for (const [, proc] of activeProcesses) {
    if ((proc as any).__agentId === agentId && !proc.killed) return true;
  }
  return false;
}

// Build the final shell command string from an agent's preset + options
export function buildCommand(agent: Agent): string {
  const preset = agent.cliPreset || 'custom';

  if (preset === 'claude') {
    const opts: ClaudeOptions = agent.claudeOptions || {};
    const parts: string[] = [agent.executionCommand || 'claude'];

    if (opts.model) parts.push('--model', opts.model);
    if (opts.maxTurns) parts.push('--max-turns', String(opts.maxTurns));
    if (opts.outputFormat) {
      parts.push('--output-format', opts.outputFormat);
      if (opts.outputFormat === 'stream-json') parts.push('--verbose');
    }
    if (opts.sessionMode === 'continue') parts.push('--continue');

    const perm = opts.permissionMode ?? 'bypass';
    if (perm === 'bypass') {
      parts.push('--dangerously-skip-permissions');
    } else if (perm === 'allowedTools' && opts.allowedTools) {
      parts.push('--allowedTools', opts.allowedTools);
    }

    return parts.join(' ');
  }

  // kiro: append --agent if specified
  if (preset === 'kiro' && agent.kiroAgent) {
    return agent.executionCommand + ' --agent ' + agent.kiroAgent;
  }

  // codex, custom, kiro without agent: use executionCommand as-is
  return agent.executionCommand;
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.next', '__pycache__', '.venv']);

function snapshotDir(dir: string): Map<string, number> {
  const snap = new Map<string, number>();
  function walk(d: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (e.isFile()) {
        try { snap.set(full, fs.statSync(full).mtimeMs); } catch {}
      }
    }
  }
  walk(dir);
  return snap;
}

function captureChangedFiles(workDir: string, before: Map<string, number>, artDir: string) {
  const after = snapshotDir(workDir);
  for (const [filePath, mtime] of after) {
    if (!before.has(filePath) || before.get(filePath)! < mtime) {
      const rel = path.relative(workDir, filePath);
      const dest = path.join(artDir, rel);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(filePath, dest);
      } catch {}
    }
  }
}

function scanArtifacts(baseDir: string, dir: string, runId: string) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scanArtifacts(baseDir, full, runId); }
    else if (e.isFile()) {
      const stat = fs.statSync(full);
      const rel = path.relative(baseDir, full);
      dbArtifactInsert({ run_id: runId, file_name: rel, file_path: full, file_size: stat.size });
    }
  }
}

export async function executeRun(agent: Agent, win: BrowserWindow | null): Promise<string> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${uuid().slice(0, 6)}`;
  const runDir = getRunDir(agent.id, runId);
  const artifactsDir = getArtifactsDir(agent.id, runId);
  fs.mkdirSync(artifactsDir, { recursive: true });

  // Snapshot prompt
  const promptPath = getPromptPath(agent.id);
  const promptContent = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : '';

  if (!promptContent.trim()) {
    dbRunInsert({ run_id: runId, agent_id: agent.id, status: 'Failed', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), exit_code: 1, prompt_version: null, prompt_content: '', timeout_minutes: agent.timeoutMinutes, kiro_agent: agent.kiroAgent ?? null });
    notify(agent, 'Failed', 'Prompt file is missing or empty');
    return runId;
  }

  // Version the prompt if changed
  const lastVer = dbPromptLatestVersion(agent.id);
  let promptVersion = lastVer;
  const lastContent = dbPromptLatestContent(agent.id);
  if (lastVer === 0 || lastContent !== promptContent) {
    promptVersion = lastVer + 1;
    dbPromptInsert({ agent_id: agent.id, version: promptVersion, content: promptContent, created_at: new Date().toISOString() });
  }

  // Write temp snapshot for stdin
  const snapshotPath = path.join(os.tmpdir(), `agentrunner-prompt-${runId}.md`);
  fs.writeFileSync(snapshotPath, promptContent);

  // Validate working directory
  if (!fs.existsSync(agent.workingDirectory)) {
    dbRunInsert({ run_id: runId, agent_id: agent.id, status: 'Failed', started_at: new Date().toISOString(), completed_at: new Date().toISOString(), exit_code: 1, prompt_version: promptVersion, prompt_content: promptContent, timeout_minutes: agent.timeoutMinutes, kiro_agent: agent.kiroAgent ?? null });
    notify(agent, 'Failed', `Working directory does not exist: ${agent.workingDirectory}`);
    return runId;
  }

  // Snapshot working directory file mtimes before run
  const preRunSnapshot = snapshotDir(agent.workingDirectory);

  const startedAt = new Date().toISOString();
  dbRunInsert({ run_id: runId, agent_id: agent.id, status: 'Running', started_at: startedAt, completed_at: null, exit_code: null, prompt_version: promptVersion, prompt_content: promptContent, timeout_minutes: agent.timeoutMinutes, kiro_agent: agent.kiroAgent ?? null });

  // Notify renderer
  win?.webContents.send(IPC.RUN_STATUS_CHANGED, { runId, agentId: agent.id, status: 'Running' });

  // Build env
  const env = {
    ...process.env,
    ...(userPath ? { PATH: userPath } : {}),
    ...(agent.environmentVariables || {}),
    AGENT_ARTIFACTS_DIR: path.resolve(artifactsDir),
    AGENT_PROMPT_FILE: path.resolve(promptPath),
    AGENT_RUN_ID: runId,
    AGENT_NAME: agent.id,
  };

  // Spawn: command < prompt-snapshot
  const stdinStream = fs.createReadStream(snapshotPath);
  const stdoutLog = fs.createWriteStream(path.join(runDir, 'stdout.log'));
  const stderrLog = fs.createWriteStream(path.join(runDir, 'stderr.log'));

  const command = buildCommand(agent);
  const proc = spawn(command, [], {
    cwd: agent.workingDirectory,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });

  (proc as any).__agentId = agent.id;
  activeProcesses.set(runId, proc);

  // Pipe prompt to stdin
  stdinStream.pipe(proc.stdin!);

  // Capture output
  proc.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    stdoutLog.write(text);
    win?.webContents.send(IPC.RUN_OUTPUT, { runId, agentId: agent.id, stream: 'stdout', data: text });
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    stderrLog.write(text);
    win?.webContents.send(IPC.RUN_OUTPUT, { runId, agentId: agent.id, stream: 'stderr', data: text });
  });

  // Timeout
  const timeoutMs = (agent.timeoutMinutes || 15) * 60 * 1000;
  const timer = setTimeout(() => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
      finishRun(runId, agent, 'Timed Out', null, win, runDir, snapshotPath, stdoutLog, stderrLog, preRunSnapshot, startedAt);
    }
  }, timeoutMs);

  proc.on('close', (code) => {
    clearTimeout(timer);
    const status: RunStatus = cancelledRuns.has(runId) ? 'Cancelled' : (code === 0 ? 'Completed' : 'Failed');
    finishRun(runId, agent, status, code, win, runDir, snapshotPath, stdoutLog, stderrLog, preRunSnapshot, startedAt);
  });

  proc.on('error', (err) => {
    clearTimeout(timer);
    stderrLog.write(err.message);
    finishRun(runId, agent, 'Failed', 1, win, runDir, snapshotPath, stdoutLog, stderrLog, preRunSnapshot, startedAt);
  });

  return runId;
}

function finishRun(
  runId: string, agent: Agent, status: RunStatus, exitCode: number | null,
  win: BrowserWindow | null, runDir: string, snapshotPath: string,
  stdoutLog: fs.WriteStream, stderrLog: fs.WriteStream,
  preRunSnapshot: Map<string, number>, startedAt: string,
) {
  // Guard: only run once per runId (timeout + close can both fire)
  if (finishedRuns.has(runId)) return;
  finishedRuns.add(runId);

  activeProcesses.delete(runId);
  cancelledRuns.delete(runId);
  stdoutLog.end();
  stderrLog.end();

  const completedAt = new Date().toISOString();
  dbRunUpdateStatus(runId, status, completedAt, exitCode);

  // Capture changed/new files from working directory into artifacts
  const artDir = path.join(runDir, 'artifacts');
  captureChangedFiles(agent.workingDirectory, preRunSnapshot, artDir);

  // Scan artifacts (both explicitly written + captured)
  if (fs.existsSync(artDir)) {
    scanArtifacts(artDir, artDir, runId);
  }

  // Write meta.json
  const meta = { runId, agentId: agent.id, status, startedAt, completedAt, exitCode };
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // Clean up snapshot
  try { fs.unlinkSync(snapshotPath); } catch {}

  // Log retention
  applyLogRetention(agent.id);

  // Notify
  notify(agent, status, exitCode !== null ? `Exit code: ${exitCode}` : '');
  win?.webContents.send(IPC.RUN_STATUS_CHANGED, { runId, agentId: agent.id, status });
}

function applyLogRetention(agentId: string) {
  const cfg = getConfig();
  const runs = dbRunsForAgent(agentId) as any[];
  if (runs.length <= cfg.logRetentionRuns) return;
  const old = runs.slice(cfg.logRetentionRuns);
  for (const r of old) {
    const dir = getRunDir(agentId, r.run_id);
    for (const f of ['stdout.log', 'stderr.log']) {
      const p = path.join(dir, f);
      try { fs.unlinkSync(p); } catch {}
    }
  }
}

function notify(agent: Agent, status: string, detail: string) {
  const cfg = getConfig();
  const n = cfg.notifications;
  if (status === 'Completed' && n.onRunComplete) sendNotification(agent.name, `Run completed. ${detail}`);
  if (status === 'Failed' && n.onRunFailed) sendNotification(agent.name, `Run failed. ${detail}`);
  if (status === 'Timed Out' && n.onRunTimedOut) sendNotification(agent.name, `Run timed out after ${agent.timeoutMinutes}m`);
  if (status === 'Cancelled' && n.onRunCancelled) sendNotification(agent.name, 'Run cancelled');
}

export function cancelRun(runId: string) {
  const proc = activeProcesses.get(runId);
  if (!proc || proc.killed) return false;
  cancelledRuns.add(runId);
  proc.kill('SIGTERM');
  setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
  return true;
}
