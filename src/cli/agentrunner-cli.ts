#!/usr/bin/env node

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// --- Socket / token discovery ---

const SOCK_PATH = path.join(
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'agentrunner')
    : path.join(os.homedir(), '.config', 'agentrunner'),
  'agentrunner.sock',
);
const TOKEN_PATH = path.join(os.homedir(), '.agentrunner-token');

function readToken(): string {
  const envToken = process.env.AGENTRUNNER_TOKEN;
  if (envToken) return envToken;
  try { return fs.readFileSync(TOKEN_PATH, 'utf-8').trim(); } catch {
    fatal('No API token found. Set AGENTRUNNER_TOKEN or generate one in AgentRunner Settings.');
  }
  return '';
}

// --- Socket communication ---

function send(method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCK_PATH);
    const token = readToken();
    let buf = '';

    const timeout = setTimeout(() => {
      sock.destroy();
      reject(new Error('Request timed out (30s)'));
    }, 30000);

    sock.on('connect', () => {
      sock.write(JSON.stringify({ method, params, token }) + '\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ok !== undefined) {
          clearTimeout(timeout);
          sock.end();
          if (msg.ok) resolve(msg.data);
          else reject(new Error(msg.error || 'Unknown error'));
        }
      }
    });
    sock.on('error', (err: any) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('Cannot connect to AgentRunner. Is the app running?'));
      } else {
        reject(err);
      }
    });
  });
}

function sendStreaming(method: string, params: any, onEvent: (msg: any) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCK_PATH);
    const token = readToken();
    let buf = '';
    let initialResponse: any = null;
    let settled = false;

    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    sock.on('connect', () => {
      sock.write(JSON.stringify({ method, params, token }) + '\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!initialResponse) {
          initialResponse = msg;
          if (!msg.ok) { sock.end(); settle(() => reject(new Error(msg.error))); return; }
          continue;
        }
        // Streaming events
        onEvent(msg);
        if (msg.event === 'done') { sock.end(); settle(() => resolve(initialResponse.data)); return; }
      }
    });
    sock.on('error', (err: any) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        settle(() => reject(new Error('Cannot connect to AgentRunner. Is the app running?')));
      } else {
        settle(() => reject(err));
      }
    });
    sock.on('end', () => {
      // Server closed connection without sending 'done' — resolve gracefully
      settle(() => resolve(initialResponse?.data ?? null));
    });
  });
}

// --- Output formatting ---

const jsonMode = process.argv.includes('--json');

function out(data: any) {
  if (jsonMode) { console.log(JSON.stringify(data, null, 2)); }
}

function table(rows: Record<string, any>[], columns?: string[]) {
  if (jsonMode) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (rows.length === 0) { console.log('(none)'); return; }
  const cols = columns || Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => c.toUpperCase().padEnd(widths[i])).join('  ');
  console.log(header);
  console.log(cols.map((_, i) => '─'.repeat(widths[i])).join('  '));
  for (const r of rows) {
    console.log(cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

function fatal(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// --- Arg parsing ---

// Strip --json from args for command parsing
const rawArgs = process.argv.slice(2).filter(a => a !== '--json');

function arg(n: number): string | undefined { return rawArgs[n]; }
function requireArg(n: number, name: string): string {
  const v = rawArgs[n];
  if (!v) fatal(`Missing required argument: <${name}>`);
  return v;
}

// Parse --key value flags from rawArgs starting at position
function parseFlags(startIdx: number): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = startIdx; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a.startsWith('--') && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
      flags[a.slice(2)] = rawArgs[++i];
    }
  }
  return flags;
}

// --- Commands ---

async function cmdAgentsList() {
  const agents = await send('agents.list');
  if (jsonMode) { out(agents); return; }
  table(agents.map((a: any) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled ? '✓' : '✗',
    schedule: a.schedule?.humanReadable || a.schedule?.cron || '',
  })), ['id', 'name', 'enabled', 'schedule']);
}

async function cmdAgentsShow() {
  const id = requireArg(2, 'agent-id');
  const agent = await send('agents.get', { id });
  if (!agent) fatal(`Agent not found: ${id}`);
  if (jsonMode) { out(agent); return; }
  console.log(`Name:       ${agent.name}`);
  console.log(`ID:         ${agent.id}`);
  console.log(`Enabled:    ${agent.enabled ? 'Yes' : 'No'}`);
  console.log(`Command:    ${agent.executionCommand}`);
  console.log(`Work Dir:   ${agent.workingDirectory}`);
  console.log(`Schedule:   ${agent.schedule?.humanReadable || agent.schedule?.cron}`);
  console.log(`Timeout:    ${agent.timeoutMinutes}m`);
  if (agent.cliPreset && agent.cliPreset !== 'custom') console.log(`Preset:     ${agent.cliPreset}`);
  console.log(`Created:    ${agent.createdAt}`);
  console.log(`Updated:    ${agent.updatedAt}`);
}

async function cmdAgentsCreate() {
  const flags = parseFlags(2);
  if (!flags.name) fatal('--name is required');
  if (!flags.command) fatal('--command is required');
  if (!flags.workdir) fatal('--workdir is required');
  let timeout = 15;
  if (flags.timeout) {
    timeout = parseInt(flags.timeout, 10);
    if (!Number.isFinite(timeout) || timeout <= 0) fatal('--timeout must be a positive integer');
  }
  const agent = await send('agents.create', {
    name: flags.name,
    executionCommand: flags.command,
    workingDirectory: flags.workdir,
    schedule: { cron: flags.cron || '0 9 * * *' },
    timeoutMinutes: timeout,
    enabled: flags.enabled !== 'false',
  });
  if (jsonMode) { out(agent); return; }
  console.log(`Created agent: ${agent.id} (${agent.name})`);
}

async function cmdAgentsEdit() {
  const id = requireArg(2, 'agent-id');
  const flags = parseFlags(3);
  const update: any = { id };
  if (flags.name) update.name = flags.name;
  if (flags.command) update.executionCommand = flags.command;
  if (flags.workdir) update.workingDirectory = flags.workdir;
  if (flags.cron) update.schedule = { cron: flags.cron };
  if (flags.timeout) {
    const t = parseInt(flags.timeout, 10);
    if (!Number.isFinite(t) || t <= 0) fatal('--timeout must be a positive integer');
    update.timeoutMinutes = t;
  }
  const agent = await send('agents.update', update);
  if (!agent) fatal(`Agent not found: ${id}`);
  if (jsonMode) { out(agent); return; }
  console.log(`Updated agent: ${agent.id}`);
}

async function cmdAgentsDelete() {
  const id = requireArg(2, 'agent-id');
  await send('agents.delete', { id });
  if (jsonMode) { out({ deleted: id }); return; }
  console.log(`Deleted agent: ${id}`);
}

async function cmdAgentsEnable() {
  const id = requireArg(2, 'agent-id');
  const agent = await send('agents.get', { id });
  if (!agent) fatal(`Agent not found: ${id}`);
  if (agent.enabled) {
    if (jsonMode) { out({ id, enabled: true, changed: false }); return; }
    console.log(`Agent ${id} is already enabled`); return;
  }
  await send('agents.update', { id, enabled: true });
  if (jsonMode) { out({ id, enabled: true }); return; }
  console.log(`Enabled agent: ${id}`);
}

async function cmdAgentsDisable() {
  const id = requireArg(2, 'agent-id');
  const agent = await send('agents.get', { id });
  if (!agent) fatal(`Agent not found: ${id}`);
  if (!agent.enabled) {
    if (jsonMode) { out({ id, enabled: false, changed: false }); return; }
    console.log(`Agent ${id} is already disabled`); return;
  }
  await send('agents.update', { id, enabled: false });
  if (jsonMode) { out({ id, enabled: false }); return; }
  console.log(`Disabled agent: ${id}`);
}

async function cmdRunsList() {
  const agentId = arg(2);
  const params = agentId ? { agentId } : {};
  const runs = await send('runs.list', params);
  if (jsonMode) { out(runs); return; }
  table(runs.slice(0, 20).map((r: any) => ({
    runId: r.runId.slice(0, 25),
    agent: r.agentId,
    status: r.status,
    started: r.startedAt?.slice(0, 19) || '',
    exit: r.exitCode ?? '',
  })), ['runId', 'agent', 'status', 'started', 'exit']);
}

async function cmdRunsShow() {
  const runId = requireArg(2, 'run-id');
  const run = await send('runs.get', { runId });
  if (!run) fatal(`Run not found: ${runId}`);
  if (jsonMode) { out(run); return; }
  console.log(`Run ID:     ${run.runId}`);
  console.log(`Agent:      ${run.agentId}`);
  console.log(`Status:     ${run.status}`);
  console.log(`Started:    ${run.startedAt || ''}`);
  console.log(`Completed:  ${run.completedAt || ''}`);
  console.log(`Exit Code:  ${run.exitCode ?? ''}`);
  console.log(`Timeout:    ${run.timeoutMinutes}m`);
}

async function cmdRunsLogs() {
  const hasStderr = rawArgs.includes('--stderr');
  // Strip --stderr from args for positional parsing
  const logArgs = rawArgs.filter(a => a !== '--stderr');
  const runId = logArgs[2];
  if (!runId) fatal('Missing required argument: <run-id>');
  const stream = hasStderr ? 'stderr' : undefined;
  const logs = await send('runs.logs', { runId, stream });
  if (logs === null) fatal('No logs found');
  if (jsonMode) { out({ runId, stream: stream || 'stdout', content: logs }); return; }
  process.stdout.write(logs);
}

async function cmdRunsArtifacts() {
  const runId = requireArg(2, 'run-id');
  const artifacts = await send('runs.artifacts', { runId });
  if (jsonMode) { out(artifacts); return; }
  if (artifacts.length === 0) { console.log('No artifacts'); return; }
  table(artifacts.map((a: any) => ({
    file: a.fileName,
    size: a.fileSize ? `${(a.fileSize / 1024).toFixed(1)}KB` : '',
  })), ['file', 'size']);
}

async function cmdRun() {
  const agentId = requireArg(1, 'agent-id');
  if (jsonMode) {
    const runId = await send('run.start', { agentId });
    out({ runId });
    return;
  }
  // Stream output
  console.log(`Starting run for agent: ${agentId}`);
  const runId = await sendStreaming('run.start', { agentId, stream: true }, (msg) => {
    if (msg.event === 'output') {
      const out = msg.stream === 'stderr' ? process.stderr : process.stdout;
      out.write(msg.data);
    } else if (msg.event === 'done') {
      console.log(`\n--- Run ${msg.status} ---`);
    }
  });
  if (runId) console.log(`Run ID: ${runId}`);
}

async function cmdCancel() {
  const runId = requireArg(1, 'run-id');
  const result = await send('run.cancel', { runId });
  if (jsonMode) { out({ runId, cancelled: result }); return; }
  console.log(result ? `Cancelled run: ${runId}` : `Run not found or already finished: ${runId}`);
}

async function cmdPromptShow() {
  const agentId = requireArg(2, 'agent-id');
  const content = await send('prompt.get', { agentId });
  if (jsonMode) { out({ agentId, content }); return; }
  process.stdout.write(content || '(empty)\n');
}

async function cmdPromptEdit() {
  const agentId = requireArg(2, 'agent-id');
  const current = await send('prompt.get', { agentId });
  const tmpFile = path.join(os.tmpdir(), `agentrunner-prompt-${agentId}-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, current || '');
  const editor = process.env.EDITOR || 'vi';
  try {
    execSync(`${editor} "${tmpFile}"`, { stdio: 'inherit' });
  } catch {
    fs.unlinkSync(tmpFile);
    fatal('Editor exited with error');
  }
  const updated = fs.readFileSync(tmpFile, 'utf-8');
  fs.unlinkSync(tmpFile);
  if (updated === current) { console.log('No changes'); return; }
  const ver = await send('prompt.save', { agentId, content: updated });
  if (jsonMode) { out({ agentId, version: ver }); return; }
  console.log(`Saved prompt v${ver} for ${agentId}`);
}

async function cmdPromptHistory() {
  const agentId = requireArg(2, 'agent-id');
  const versions = await send('prompt.history', { agentId });
  if (jsonMode) { out(versions); return; }
  table(versions.map((v: any) => ({
    version: `v${v.version}`,
    created: v.createdAt?.slice(0, 19) || '',
    preview: (v.content || '').slice(0, 60).replace(/\n/g, ' '),
  })), ['version', 'created', 'preview']);
}

async function cmdConfigShow() {
  const config = await send('config.get');
  if (jsonMode) { out(config); return; }
  console.log(JSON.stringify(config, null, 2));
}

async function cmdConfigSet() {
  const key = requireArg(2, 'key');
  const value = requireArg(3, 'value');
  const config = await send('config.set', { key, value });
  if (jsonMode) { out(config); return; }
  console.log(`Set ${key} = ${value}`);
}

async function cmdStatus() {
  const status = await send('status');
  if (jsonMode) { out(status); return; }
  console.log(`Agents: ${status.agentCount} total, ${status.enabledCount} enabled`);
  if (status.running.length === 0) {
    console.log('Running: none');
  } else {
    console.log('Running:');
    for (const r of status.running) {
      console.log(`  ${r.agentName} (${r.agentId}) — run ${r.runId}`);
    }
  }
}

function printHelp() {
  console.log(`AgentRunner CLI

Usage: agentrunner-cli <command> [options]

Commands:
  agents list                     List all agents
  agents show <id>                Show agent details
  agents create --name <n> --command <c> --workdir <d> [--cron <expr>] [--timeout <min>]
                                  Create a new agent
  agents edit <id> [--name <n>] [--command <c>] [--workdir <d>] [--cron <expr>] [--timeout <min>]
                                  Update an agent
  agents delete <id>              Delete an agent
  agents enable <id>              Enable an agent
  agents disable <id>             Disable an agent

  runs list [agent-id]            List recent runs (optionally for one agent)
  runs show <run-id>              Show run details
  runs logs <run-id> [--stderr]   Print run stdout (or stderr)
  runs artifacts <run-id>         List run artifacts

  run <agent-id>                  Start an ad-hoc run (streams output)
  cancel <run-id>                 Cancel a running agent

  prompt show <agent-id>          Print current prompt
  prompt edit <agent-id>          Edit prompt in $EDITOR
  prompt history <agent-id>       List prompt versions

  config show                     Print app config
  config set <key> <value>        Update a config setting

  status                          Show overview (agent counts, running agents)
  help                            Show this help

Options:
  --json                          Output raw JSON (for scripting)

Authentication:
  The CLI reads the API token from ~/.agentrunner-token (auto-created when
  you generate a token in AgentRunner Settings). You can also set the
  AGENTRUNNER_TOKEN environment variable.

Requirements:
  AgentRunner desktop app must be running.`);
}

// --- Main dispatch ---

async function main() {
  const cmd = arg(0);
  const sub = arg(1);

  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { printHelp(); return; }

    if (cmd === 'agents') {
      if (!sub || sub === 'list') return cmdAgentsList();
      if (sub === 'show') return cmdAgentsShow();
      if (sub === 'create') return cmdAgentsCreate();
      if (sub === 'edit') return cmdAgentsEdit();
      if (sub === 'delete') return cmdAgentsDelete();
      if (sub === 'enable') return cmdAgentsEnable();
      if (sub === 'disable') return cmdAgentsDisable();
      fatal(`Unknown agents subcommand: ${sub}. Run 'agentrunner-cli help' for usage.`);
    }
    if (cmd === 'runs') {
      if (!sub || sub === 'list') return cmdRunsList();
      if (sub === 'show') return cmdRunsShow();
      if (sub === 'logs') return cmdRunsLogs();
      if (sub === 'artifacts') return cmdRunsArtifacts();
      fatal(`Unknown runs subcommand: ${sub}. Run 'agentrunner-cli help' for usage.`);
    }
    if (cmd === 'run') return cmdRun();
    if (cmd === 'cancel') return cmdCancel();
    if (cmd === 'prompt') {
      if (sub === 'show') return cmdPromptShow();
      if (sub === 'edit') return cmdPromptEdit();
      if (sub === 'history') return cmdPromptHistory();
      fatal(`Unknown prompt subcommand: ${sub}. Run 'agentrunner-cli help' for usage.`);
    }
    if (cmd === 'config') {
      if (sub === 'show') return cmdConfigShow();
      if (sub === 'set') return cmdConfigSet();
      fatal(`Unknown config subcommand: ${sub}. Run 'agentrunner-cli help' for usage.`);
    }
    if (cmd === 'status') return cmdStatus();

    fatal(`Unknown command: ${cmd}. Run 'agentrunner-cli help' for usage.`);
  } catch (err: any) {
    fatal(err.message);
  }
}

main();
