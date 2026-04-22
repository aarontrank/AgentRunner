import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import cronstrue from 'cronstrue';
import { IPC, Agent } from '../shared/types';
import {
  getConfig, saveConfig, getAgentsFromFile, saveAgentsToFile,
  ensureAgentDirs, getAgentDir, getPromptPath, getPromptHistoryDir,
  getRunDir, getArtifactsDir,
} from './config';
import {
  dbAgentInsert, dbAgentUpdate, dbAgentDelete, dbAgentsAll,
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

function mapRun(r: any) {
  return {
    runId: r.run_id, agentId: r.agent_id, status: r.status,
    startedAt: r.started_at, completedAt: r.completed_at,
    exitCode: r.exit_code, promptVersion: r.prompt_version,
    promptContent: r.prompt_content, timeoutMinutes: r.timeout_minutes,
    kiroAgent: r.kiro_agent ?? undefined,
  };
}

function mapArtifact(a: any) {
  return { id: a.id, runId: a.run_id, fileName: a.file_name, filePath: a.file_path, fileSize: a.file_size };
}

function mapPromptVersion(p: any) {
  return { id: p.id, agentId: p.agent_id, version: p.version, content: p.content, createdAt: p.created_at };
}

export function registerIpcHandlers() {
  // --- Agent CRUD ---
  ipcMain.handle(IPC.AGENTS_LIST, () => getAgentsFromFile());

  ipcMain.handle(IPC.AGENT_GET, (_, id: string) => {
    return getAgentsFromFile().find(a => a.id === id) || null;
  });

  ipcMain.handle(IPC.AGENT_CREATE, (_, data: Partial<Agent>) => {
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
    // Ensure unique id
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
  });

  ipcMain.handle(IPC.AGENT_UPDATE, (_, id: string, data: Partial<Agent>) => {
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
  });

  ipcMain.handle(IPC.AGENT_DELETE, (_, id: string) => {
    const agents = getAgentsFromFile().filter(a => a.id !== id);
    saveAgentsToFile(agents);
    dbAgentDelete(id);
    unscheduleAgent(id);
    const dir = getAgentDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle(IPC.AGENT_DUPLICATE, (_, id: string) => {
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
    // Copy prompt
    const srcPrompt = getPromptPath(id);
    if (fs.existsSync(srcPrompt)) {
      fs.copyFileSync(srcPrompt, getPromptPath(newAgent.id));
    }
    return newAgent;
  });

  ipcMain.handle(IPC.AGENT_TOGGLE, (_, id: string) => {
    const agents = getAgentsFromFile();
    const agent = agents.find(a => a.id === id);
    if (!agent) return null;
    agent.enabled = !agent.enabled;
    agent.updatedAt = new Date().toISOString();
    saveAgentsToFile(agents);
    dbAgentUpdate(toDbAgent(agent));
    if (agent.enabled) scheduleAgent(agent); else unscheduleAgent(agent.id);
    return agent;
  });

  // --- Runs ---
  ipcMain.handle(IPC.RUN_START, (_, agentId: string) => {
    const agent = getAgentsFromFile().find(a => a.id === agentId);
    if (!agent) return null;
    const win = BrowserWindow.getAllWindows()[0] || null;
    return executeRun(agent, win);
  });

  ipcMain.handle(IPC.RUN_CANCEL, (_, runId: string) => cancelRun(runId));

  ipcMain.handle(IPC.RUNS_LIST, (_, agentId: string) => dbRunsForAgent(agentId).map(mapRun));
  ipcMain.handle(IPC.RUN_GET, (_, runId: string) => { const r = dbRunGet(runId); return r ? mapRun(r) : null; });
  ipcMain.handle(IPC.RUN_DELETE, (_, agentId: string, runId: string) => {
    dbRunDelete(runId);
    const dir = getRunDir(agentId, runId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return true;
  });

  // --- Prompt ---
  ipcMain.handle(IPC.PROMPT_GET, (_, agentId: string) => {
    const p = getPromptPath(agentId);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  });

  ipcMain.handle(IPC.PROMPT_SAVE, (_, agentId: string, content: string) => {
    fs.writeFileSync(getPromptPath(agentId), content);
    // Version it
    const ver = dbPromptLatestVersion(agentId) + 1;
    const now = new Date().toISOString();
    dbPromptInsert({ agent_id: agentId, version: ver, content, created_at: now });
    // Save to history dir
    const histDir = getPromptHistoryDir(agentId);
    fs.mkdirSync(histDir, { recursive: true });
    const ts = now.replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(histDir, `v${ver}_${ts}.md`), content);
    return ver;
  });

  ipcMain.handle(IPC.PROMPT_HISTORY, (_, agentId: string) => dbPromptVersionsForAgent(agentId).map(mapPromptVersion));

  // --- Config ---
  ipcMain.handle(IPC.CONFIG_GET, () => getConfig());
  ipcMain.handle(IPC.CONFIG_SAVE, (_, cfg) => { saveConfig(cfg); return true; });

  // --- Artifacts ---
  ipcMain.handle(IPC.ARTIFACTS_LIST, (_, runId: string) => dbArtifactsForRun(runId).map(mapArtifact));
  ipcMain.handle(IPC.ARTIFACT_OPEN, (_, filePath: string) => { shell.showItemInFolder(filePath); });
  ipcMain.handle(IPC.ARTIFACT_CONTENT, (_, filePath: string) => {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
  });

  // --- Logs ---
  ipcMain.handle(IPC.LOG_GET, (_, agentId: string, runId: string, type: 'stdout' | 'stderr') => {
    const logPath = path.join(getRunDir(agentId, runId), `${type}.log`);
    return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : null;
  });

  // --- CLAUDE.md (in agent's workingDirectory) ---
  ipcMain.handle(IPC.CLAUDE_MD_GET, (_, agentId: string) => {
    const agent = getAgentsFromFile().find(a => a.id === agentId);
    if (!agent) return null;
    const p = path.join(agent.workingDirectory, 'CLAUDE.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  });

  ipcMain.handle(IPC.CLAUDE_MD_SAVE, (_, agentId: string, content: string) => {
    const agent = getAgentsFromFile().find(a => a.id === agentId);
    if (!agent) return false;
    if (!fs.existsSync(agent.workingDirectory)) return false;
    fs.writeFileSync(path.join(agent.workingDirectory, 'CLAUDE.md'), content);
    return true;
  });

  // --- Kiro Agents (read-only, scans ~/.kiro/agents/) ---
  const kiroAgentsDir = path.join(require('os').homedir(), '.kiro', 'agents');

  ipcMain.handle(IPC.KIRO_AGENTS_LIST, () => listKiroAgents(kiroAgentsDir));

  ipcMain.handle(IPC.KIRO_AGENT_GET, (_, name: string) => getKiroAgent(kiroAgentsDir, name));
}
