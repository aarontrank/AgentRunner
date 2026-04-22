import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp/agentrunner-test' },
}));

describe('kiro-agents module', () => {
  let tmpDir: string;
  let agentsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-agents-test-'));
    agentsDir = path.join(tmpDir, '.kiro', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  function writeAgent(filename: string, config: any) {
    fs.writeFileSync(path.join(agentsDir, filename), JSON.stringify(config));
  }

  describe('listKiroAgents', () => {
    it('returns empty array when no agent files exist', async () => {
      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);
      expect(agents).toEqual([]);
    });

    it('parses agent JSON files and returns KiroAgentConfig objects', async () => {
      writeAgent('my-agent.json', {
        name: 'my-agent',
        description: 'A test agent',
        tools: ['fs_read', 'execute_bash'],
        allowedTools: ['fs_read'],
        mcpServers: { 'builder-mcp': { command: 'builder-mcp', args: [] } },
        resources: ['file://README.md', 'skill:///path/to/SKILL.md'],
      });

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('my-agent');
      expect(agents[0].description).toBe('A test agent');
      expect(agents[0].tools).toEqual(['fs_read', 'execute_bash']);
      expect(agents[0].allowedTools).toEqual(['fs_read']);
      expect(agents[0].mcpServers).toHaveProperty('builder-mcp');
      expect(agents[0].resources).toContain('file://README.md');
    });

    it('skips non-JSON files and directories', async () => {
      writeAgent('valid.json', { name: 'valid', description: 'ok' });
      fs.writeFileSync(path.join(agentsDir, 'readme.txt'), 'not json');
      fs.mkdirSync(path.join(agentsDir, 'subdir'));

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('valid');
    });

    it('skips the example config file', async () => {
      writeAgent('agent_config.json.example', { name: 'example' });
      writeAgent('real-agent.json', { name: 'real-agent', description: 'real' });

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('real-agent');
    });

    it('skips files with invalid JSON', async () => {
      fs.writeFileSync(path.join(agentsDir, 'broken.json'), '{invalid json');
      writeAgent('good.json', { name: 'good', description: 'works' });

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('good');
    });

    it('handles agents with no name by using filename', async () => {
      writeAgent('unnamed-agent.json', { description: 'no name field' });

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('unnamed-agent');
    });

    it('returns multiple agents sorted by name', async () => {
      writeAgent('zebra.json', { name: 'zebra' });
      writeAgent('alpha.json', { name: 'alpha' });
      writeAgent('middle.json', { name: 'middle' });

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents.map(a => a.name)).toEqual(['alpha', 'middle', 'zebra']);
    });

    it('includes the source file path on each agent', async () => {
      writeAgent('my-agent.json', { name: 'my-agent' });

      const { listKiroAgents } = await import('./kiro-agents');
      const agents = listKiroAgents(agentsDir);

      expect(agents[0].filePath).toBe(path.join(agentsDir, 'my-agent.json'));
    });
  });

  describe('getKiroAgent', () => {
    it('returns a single agent by name', async () => {
      writeAgent('target.json', { name: 'target', description: 'found me' });
      writeAgent('other.json', { name: 'other' });

      const { getKiroAgent } = await import('./kiro-agents');
      const agent = getKiroAgent(agentsDir, 'target');

      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('target');
      expect(agent!.description).toBe('found me');
    });

    it('returns null for non-existent agent name', async () => {
      writeAgent('exists.json', { name: 'exists' });

      const { getKiroAgent } = await import('./kiro-agents');
      const agent = getKiroAgent(agentsDir, 'nope');

      expect(agent).toBeNull();
    });

    it('includes raw JSON content for full definition view', async () => {
      const config = { name: 'detailed', description: 'test', tools: ['fs_read'], mcpServers: {} };
      writeAgent('detailed.json', config);

      const { getKiroAgent } = await import('./kiro-agents');
      const agent = getKiroAgent(agentsDir, 'detailed');

      expect(agent!.rawJson).toBeDefined();
      expect(typeof agent!.rawJson).toBe('string');
      const parsed = JSON.parse(agent!.rawJson!);
      expect(parsed.name).toBe('detailed');
    });
  });
});
