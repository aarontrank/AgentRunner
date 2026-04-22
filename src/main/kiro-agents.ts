import * as fs from 'fs';
import * as path from 'path';
import { KiroAgentConfig } from '../shared/types';

export function listKiroAgents(agentsDir: string): KiroAgentConfig[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(agentsDir, { withFileTypes: true }); } catch { return []; }

  const agents: KiroAgentConfig[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json') || e.name.includes('.example')) continue;
    const filePath = path.join(agentsDir, e.name);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(raw);
      agents.push({
        name: config.name || e.name.replace(/\.json$/, ''),
        description: config.description,
        tools: config.tools,
        allowedTools: config.allowedTools,
        mcpServers: config.mcpServers,
        resources: config.resources,
        prompt: config.prompt,
        model: config.model,
        filePath,
      });
    } catch { /* skip invalid JSON */ }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export function getKiroAgent(agentsDir: string, name: string): KiroAgentConfig | null {
  const agents = listKiroAgents(agentsDir);
  const agent = agents.find(a => a.name === name);
  if (!agent) return null;
  try {
    agent.rawJson = fs.readFileSync(agent.filePath, 'utf-8');
  } catch { /* leave rawJson undefined */ }
  return agent;
}
