import { ipcMain, shell } from 'electron';
import { IPC, Agent } from '../shared/types';
import { generateApiToken, revokeApiToken } from './config';
import * as svc from './services';

export function registerIpcHandlers() {
  // --- Agent CRUD ---
  ipcMain.handle(IPC.AGENTS_LIST, () => svc.agentsList());
  ipcMain.handle(IPC.AGENT_GET, (_, id: string) => svc.agentGet(id));
  ipcMain.handle(IPC.AGENT_CREATE, (_, data: Partial<Agent>) => svc.agentCreate(data));
  ipcMain.handle(IPC.AGENT_UPDATE, (_, id: string, data: Partial<Agent>) => svc.agentUpdate(id, data));
  ipcMain.handle(IPC.AGENT_DELETE, (_, id: string) => svc.agentDelete(id));
  ipcMain.handle(IPC.AGENT_DUPLICATE, (_, id: string) => svc.agentDuplicate(id));
  ipcMain.handle(IPC.AGENT_TOGGLE, (_, id: string) => svc.agentToggle(id));

  // --- Runs ---
  ipcMain.handle(IPC.RUN_START, (_, agentId: string) => svc.runStart(agentId));
  ipcMain.handle(IPC.RUN_CANCEL, (_, runId: string) => svc.runCancel(runId));
  ipcMain.handle(IPC.RUNS_LIST, (_, agentId: string) => svc.runsList(agentId));
  ipcMain.handle(IPC.RUN_GET, (_, runId: string) => svc.runGet(runId));
  ipcMain.handle(IPC.RUN_DELETE, (_, agentId: string, runId: string) => svc.runDelete(agentId, runId));

  // --- Prompt ---
  ipcMain.handle(IPC.PROMPT_GET, (_, agentId: string) => svc.promptGet(agentId));
  ipcMain.handle(IPC.PROMPT_SAVE, (_, agentId: string, content: string) => svc.promptSave(agentId, content));
  ipcMain.handle(IPC.PROMPT_HISTORY, (_, agentId: string) => svc.promptHistory(agentId));

  // --- Config ---
  ipcMain.handle(IPC.CONFIG_GET, () => svc.configGet());
  ipcMain.handle(IPC.CONFIG_SAVE, (_, cfg) => svc.configSave(cfg));

  // --- Artifacts ---
  ipcMain.handle(IPC.ARTIFACTS_LIST, (_, runId: string) => svc.artifactsList(runId));
  ipcMain.handle(IPC.ARTIFACT_OPEN, (_, filePath: string) => { shell.showItemInFolder(filePath); });
  ipcMain.handle(IPC.ARTIFACT_CONTENT, (_, filePath: string) => svc.artifactContent(filePath));

  // --- Logs ---
  ipcMain.handle(IPC.LOG_GET, (_, agentId: string, runId: string, type: 'stdout' | 'stderr') => svc.logGet(agentId, runId, type));

  // --- CLAUDE.md ---
  ipcMain.handle(IPC.CLAUDE_MD_GET, (_, agentId: string) => svc.claudeMdGet(agentId));
  ipcMain.handle(IPC.CLAUDE_MD_SAVE, (_, agentId: string, content: string) => svc.claudeMdSave(agentId, content));

  // --- Kiro Agents ---
  ipcMain.handle(IPC.KIRO_AGENTS_LIST, () => svc.kiroAgentsList());
  ipcMain.handle(IPC.KIRO_AGENT_GET, (_, name: string) => svc.kiroAgentGet(name));

  // --- API Token ---
  ipcMain.handle(IPC.API_TOKEN_GENERATE, () => generateApiToken());
  ipcMain.handle(IPC.API_TOKEN_REVOKE, () => { revokeApiToken(); return true; });
}
