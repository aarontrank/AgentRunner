import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import cronstrue from 'cronstrue';
import { BrowserWindow } from 'electron';
import { Agent } from '../shared/types';
import {
  getConfig, saveConfig, getAgentsFromFile, saveAgentsToFile,
  ensureAgentDirs, getAgentDir, getPromptPath, getPromptHistoryDir,
  getRunDir, getArtifactsDir,
} from './config';
import {
  dbAgentInsert, dbAgentUpdate, dbAgentDelete,
  dbRunsForAgent, dbRunGet, dbRunDelete,
  dbArtifactsForRun,
  dbPromptVersionsForAgent, dbPromptLatestVersion, dbPromptInsert,
} from './database';
import { executeRun, cancelRun, getActiveProcesses } from './executor';
import { scheduleAgent, unscheduleAgent } from './scheduler';
import { listKiroAgents, getKiroAgent } from './kiro-agents';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toDbAgent(a: Agent) {
  return {
    id: a.id, name: a.name, execution_command: a.executionCommand,
    working_directory: a.workingDirectory, cron_expression: a.schedule.cron,
    timeout_minutes: a.timeoutMinutes,
    environment_variables: a.environmentVariables ? JSON.stringify(a.environmentVariables) : null,
    enabled: a.enabled, created_at: a.createdAt, updated_at: a.updatedAt,
    cli_preset: a.cliPreset ?? null,
    cli_options: a.claudeOptions ? JSON.stringify(a.claudeOptions) : null,
  };
}

function humanCron(cron: string): string {
  try { return cronstrue.toString(cron); } catch { return cron; }
}

export function mapRun(r: any) {
  return {
    runId: r.run_id, agentId: r.agent_id, status: r.status,
    startedAt: r.started_at, completedAt: r.completed_at,
    exitCode: r.exit_code, promptVersion: r.prompt_version,
    promptContent: r.prompt_content, timeoutMinutes: r.timeout_minutes,
    kiroAgent: r.kiro_agent ?? undefined,
  };
}

export function mapArtifact(a: any) {
  return { id: a.id, runId: a.run_id, fileName: a.file_name, filePath: a.file_path, fileSize: a.file_size };
}

export function mapPromptVersion(p: any) {
  return { id: p.id, agentId: p.agent_id, version: p.version, content: p.content, createdAt: p.created_at };
}

// --- Agent CRUD ---

export function agentsList(): Agent[] {
  return getAgentsFromFile();
}

export function agentGet(id: string): Agent | null {
  return getAgentsFromFile().find(a => a.id === id) || null;
}

export function agentCreate(data: Partial<Agent>): Agent {
  const now = new Date().toISOString();
  const agent: Agent = {
    id: slugify(data.name || 'agent'),
    name: data.name || 'New Agent',
    executionCommand: data.executionCommand || '',
    workingDirectory: data.workingDirectory || '',
    schedule: { cron: data.schedule?.cron || '0 9 * * *', humanReadable: humanCron(data.schedule?.cron || '0 9 * * *') },
    timeoutMinutes: data.timeoutMinutes || 15,
    environmentVariables: data.environmentVariables || {},
    enabled: data.enabled !== false,
    createdAt: now,
    updatedAt: now,
    cliPreset: data.cliPreset,
    claudeOptions: data.claudeOptions,
    kiroAgent: data.kiroAgent,
  };
  const existing = getAgentsFromFile();
  if (existing.some(a => a.id === agent.id)) {
    agent.id = agent.id + '-' + uuid().slice(0, 6);
  }
  existing.push(agent);
  saveAgentsToFile(existing);
  dbAgentInsert(toDbAgent(agent));
  ensureAgentDirs(agent.id);
  scheduleAgent(agent);
  return agent;
}

export function agentUpdate(id: string, data: Partial<Agent>): Agent | null {
  const agents = getAgentsFromFile();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;
  const updated = { ...agents[idx], ...data, updatedAt: new Date().toISOString() };
  if (data.schedule?.cron) {
    updated.schedule = { cron: data.schedule.cron, humanReadable: humanCron(data.schedule.cron) };
  }
  agents[idx] = updated;
  saveAgentsToFile(agents);
  dbAgentUpdate(toDbAgent(updated));
  scheduleAgent(updated);
  return updated;
}

export function agentDelete(id: string): boolean {
  const agents = getAgentsFromFile().filter(a => a.id !== id);
  saveAgentsToFile(agents);
  dbAgentDelete(id);
  unscheduleAgent(id);
  const dir = getAgentDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function agentDuplicate(id: string): Agent | null {
  const source = getAgentsFromFile().find(a => a.id === id);
  if (!source) return null;
  const now = new Date().toISOString();
  const newAgent: Agent = {
    ...source,
    id: slugify(source.name + ' copy'),
    name: source.name + ' (Copy)',
    createdAt: now,
    updatedAt: now,
  };
  const agents = getAgentsFromFile();
  if (agents.some(a => a.id === newAgent.id)) {
    newAgent.id = newAgent.id + '-' + uuid().slice(0, 6);
  }
  agents.push(newAgent);
  saveAgentsToFile(agents);
  dbAgentInsert(toDbAgent(newAgent));
  ensureAgentDirs(newAgent.id);
  const srcPrompt = getPromptPath(id);
  if (fs.existsSync(srcPrompt)) {
    fs.copyFileSync(srcPrompt, getPromptPath(newAgent.id));
  }
  return newAgent;
}

export function agentToggle(id: string): Agent | null {
  const agents = getAgentsFromFile();
  const agent = agents.find(a => a.id === id);
  if (!agent) return null;
  agent.enabled = !agent.enabled;
  agent.updatedAt = new Date().toISOString();
  saveAgentsToFile(agents);
  dbAgentUpdate(toDbAgent(agent));
  if (agent.enabled) scheduleAgent(agent); else unscheduleAgent(agent.id);
  return agent;
}

// --- Runs ---

export function runStart(agentId: string, win?: BrowserWindow | null): Promise<string> | null {
  const agent = getAgentsFromFile().find(a => a.id === agentId);
  if (!agent) return null;
  return executeRun(agent, win || BrowserWindow.getAllWindows()[0] || null);
}

export function runCancel(runId: string) {
  return cancelRun(runId);
}

export function runsList(agentId: string) {
  return dbRunsForAgent(agentId).map(mapRun);
}

export function runGet(runId: string) {
  const r = dbRunGet(runId);
  return r ? mapRun(r) : null;
}

export function runDelete(agentId: string, runId: string) {
  dbRunDelete(runId);
  const dir = getRunDir(agentId, runId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// --- Prompt ---

export function promptGet(agentId: string): string {
  const p = getPromptPath(agentId);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

export function promptSave(agentId: string, content: string): number {
  fs.writeFileSync(getPromptPath(agentId), content);
  const ver = dbPromptLatestVersion(agentId) + 1;
  const now = new Date().toISOString();
  dbPromptInsert({ agent_id: agentId, version: ver, content, created_at: now });
  const histDir = getPromptHistoryDir(agentId);
  fs.mkdirSync(histDir, { recursive: true });
  const ts = now.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(histDir, `v${ver}_${ts}.md`), content);
  return ver;
}

export function promptHistory(agentId: string) {
  return dbPromptVersionsForAgent(agentId).map(mapPromptVersion);
}

// --- Config ---

export function configGet() {
  return getConfig();
}

export function configSave(cfg: any) {
  saveConfig(cfg);
  return true;
}

// --- Artifacts ---

export function artifactsList(runId: string) {
  return dbArtifactsForRun(runId).map(mapArtifact);
}

export function artifactContent(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

// --- Logs ---

export function logGet(agentId: string, runId: string, type: 'stdout' | 'stderr'): string | null {
  const logPath = path.join(getRunDir(agentId, runId), `${type}.log`);
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : null;
}

// --- CLAUDE.md ---

export function claudeMdGet(agentId: string): string | null {
  const agent = getAgentsFromFile().find(a => a.id === agentId);
  if (!agent) return null;
  const p = path.join(agent.workingDirectory, 'CLAUDE.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

export function claudeMdSave(agentId: string, content: string): boolean {
  const agent = getAgentsFromFile().find(a => a.id === agentId);
  if (!agent) return false;
  if (!fs.existsSync(agent.workingDirectory)) return false;
  fs.writeFileSync(path.join(agent.workingDirectory, 'CLAUDE.md'), content);
  return true;
}

// --- Kiro Agents ---

const kiroAgentsDir = path.join(require('os').homedir(), '.kiro', 'agents');

export function kiroAgentsList() {
  return listKiroAgents(kiroAgentsDir);
}

export function kiroAgentGet(name: string) {
  return getKiroAgent(kiroAgentsDir, name);
}

// --- Status (for CLI) ---

export function getStatus() {
  const agents = getAgentsFromFile();
  const active = getActiveProcesses();
  const running: { agentId: string; agentName: string; runId: string }[] = [];
  for (const [runId, proc] of active) {
    if (!proc.killed) {
      const agentId = (proc as any).__agentId;
      const agent = agents.find(a => a.id === agentId);
      running.push({ agentId, agentName: agent?.name || agentId, runId });
    }
  }
  return {
    agentCount: agents.length,
    enabledCount: agents.filter(a => a.enabled).length,
    running,
  };
}
