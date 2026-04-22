import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { app } from 'electron';
import { AppConfig, Agent } from '../shared/types';

const dataDir = () => path.join(app.getPath('userData'), 'data');
const configPath = () => path.join(dataDir(), 'config.json');
const agentsJsonPath = () => path.join(dataDir(), 'agents.json');
export const agentsDir = () => path.join(dataDir(), 'agents');

const DEFAULT_CONFIG: AppConfig = {
  launchOnStartup: true,
  logRetentionRuns: 5,
  runRetentionPolicy: 'forever',
  notifications: { onRunComplete: true, onRunFailed: true, onRunTimedOut: true, onRunCancelled: false },
};

export function initConfig() {
  fs.mkdirSync(agentsDir(), { recursive: true });
  if (!fs.existsSync(configPath())) writeJson(configPath(), DEFAULT_CONFIG);
  if (!fs.existsSync(agentsJsonPath())) writeJson(agentsJsonPath(), { agents: [] });
}

export function getConfig(): AppConfig {
  try { return { ...DEFAULT_CONFIG, ...readJson(configPath()) }; }
  catch { return DEFAULT_CONFIG; }
}

export function saveConfig(cfg: AppConfig) { writeJson(configPath(), cfg); }

export function getAgentsFromFile(): Agent[] {
  try { return readJson(agentsJsonPath()).agents || []; }
  catch { return []; }
}

export function saveAgentsToFile(agents: Agent[]) { writeJson(agentsJsonPath(), { agents }); }

export function getAgentDir(agentId: string) { return path.join(agentsDir(), agentId); }
export function getPromptPath(agentId: string) { return path.join(getAgentDir(agentId), 'prompt.md'); }
export function getPromptHistoryDir(agentId: string) { return path.join(getAgentDir(agentId), 'prompt-history'); }
export function getRunDir(agentId: string, runId: string) { return path.join(getAgentDir(agentId), 'runs', runId); }
export function getArtifactsDir(agentId: string, runId: string) { return path.join(getRunDir(agentId, runId), 'artifacts'); }

export function ensureAgentDirs(agentId: string) {
  fs.mkdirSync(getPromptHistoryDir(agentId), { recursive: true });
  fs.mkdirSync(path.join(getAgentDir(agentId), 'runs'), { recursive: true });
  const promptFile = getPromptPath(agentId);
  if (!fs.existsSync(promptFile)) fs.writeFileSync(promptFile, '');
}

function readJson(p: string) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeJson(p: string, data: any) { fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 }); }

// --- API Token ---

const TOKEN_FILE = path.join(os.homedir(), '.agentrunner-token');

export function getSocketPath(): string {
  return path.join(app.getPath('userData'), 'agentrunner.sock');
}

export function generateApiToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  const cfg = getConfig();
  cfg.apiToken = token;
  saveConfig(cfg);
  writeTokenFile(token);
  return token;
}

export function revokeApiToken(): void {
  const cfg = getConfig();
  cfg.apiToken = null;
  saveConfig(cfg);
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
}

export function validateApiToken(token: string): boolean {
  const cfg = getConfig();
  if (!cfg.apiToken) return false;
  const a = Buffer.from(cfg.apiToken);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function writeTokenFile(token: string) {
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
}
