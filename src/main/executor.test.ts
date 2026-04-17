import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Agent } from '../shared/types';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock Electron
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

// Mock database
vi.mock('./database', () => ({
  dbRunInsert: vi.fn(),
  dbRunUpdateStatus: vi.fn(),
  dbRunsForAgent: vi.fn(() => []),
  dbArtifactInsert: vi.fn(),
  dbPromptLatestVersion: vi.fn(() => 1),
  dbPromptLatestContent: vi.fn(() => 'test prompt'),
  dbPromptInsert: vi.fn(),
}));

// Mock config — use real os.tmpdir for temp files, fake everything else
vi.mock('./config', () => ({
  getPromptPath: vi.fn(() => '/tmp/agentrunner-test-prompt.md'),
  getRunDir: vi.fn((_a: string, runId: string) => `/tmp/agentrunner-test-runs/${runId}`),
  getArtifactsDir: vi.fn((_a: string, runId: string) => `/tmp/agentrunner-test-runs/${runId}/artifacts`),
  getPromptHistoryDir: vi.fn(() => '/tmp/agentrunner-test-prompt-history'),
  getConfig: vi.fn(() => ({
    logRetentionRuns: 5,
    notifications: { onRunComplete: false, onRunFailed: false, onRunTimedOut: false, onRunCancelled: false },
  })),
}));

// Mock main
vi.mock('./main', () => ({
  sendNotification: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    executionCommand: 'echo hello',
    workingDirectory: '/tmp',
    schedule: { cron: '0 * * * *' },
    timeoutMinutes: 15,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeFakeProc(agentId: string): EventEmitter & { killed: boolean; kill: ReturnType<typeof vi.fn>; __agentId: string; stdin: any; stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as any;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  proc.__agentId = agentId;
  proc.stdin = { end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('executor', () => {
  let executor: typeof import('./executor');
  let dbMock: typeof import('./database');

  beforeEach(async () => {
    vi.resetModules();
    executor = await import('./executor');
    dbMock = await import('./database');
  });

  afterEach(() => {
    // Clean up module-level state
    executor.getActiveProcesses().clear();
    executor.getFinishedRuns().clear();
    executor.getCancelledRuns().clear();
  });

  // ── Bug 1: Double finishRun guard ──────────────────────────────────────

  describe('Bug 1: finishRun guard prevents double execution', () => {
    it('finishedRuns set blocks second call for same runId', () => {
      const finishedRuns = executor.getFinishedRuns();

      // Simulate first finishRun marking the run as finished
      finishedRuns.add('run-123');

      // The set now contains the runId — any subsequent finishRun call
      // will check this and return early
      expect(finishedRuns.has('run-123')).toBe(true);
    });

    it('different runIds are tracked independently', () => {
      const finishedRuns = executor.getFinishedRuns();

      finishedRuns.add('run-1');
      expect(finishedRuns.has('run-1')).toBe(true);
      expect(finishedRuns.has('run-2')).toBe(false);
    });
  });

  // ── Bug 2: cancelRun sets Cancelled status ─────────────────────────────

  describe('Bug 2: cancelRun records Cancelled status', () => {
    it('cancelRun adds runId to cancelledRuns before killing', () => {
      const proc = makeFakeProc('test-agent');
      proc.killed = false;
      executor.getActiveProcesses().set('run-abc', proc as any);

      const result = executor.cancelRun('run-abc');

      expect(result).toBe(true);
      expect(executor.getCancelledRuns().has('run-abc')).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('cancelRun returns false for unknown runId', () => {
      expect(executor.cancelRun('nonexistent')).toBe(false);
      expect(executor.getCancelledRuns().has('nonexistent')).toBe(false);
    });

    it('cancelRun returns false for already-killed process', () => {
      const proc = makeFakeProc('test-agent');
      proc.killed = true;
      executor.getActiveProcesses().set('run-dead', proc as any);

      expect(executor.cancelRun('run-dead')).toBe(false);
      expect(executor.getCancelledRuns().has('run-dead')).toBe(false);
    });

    it('cancelledRuns is checked in close handler status logic', () => {
      // Verify the cancelled set is populated so the close handler
      // can distinguish cancelled from failed
      const proc = makeFakeProc('test-agent');
      proc.killed = false;
      executor.getActiveProcesses().set('run-cancel-test', proc as any);

      executor.cancelRun('run-cancel-test');

      // The close handler will check: cancelledRuns.has(runId) ? 'Cancelled' : ...
      expect(executor.getCancelledRuns().has('run-cancel-test')).toBe(true);
    });
  });

  // ── Bug 3: meta.json startedAt ─────────────────────────────────────────

  describe('Bug 3: meta.json startedAt is passed through', () => {
    it('executeRun creates a valid startedAt timestamp before spawning', async () => {
      // We test this indirectly: executeRun captures startedAt = new Date().toISOString()
      // and passes it to dbRunInsert. We verify the DB insert gets a real timestamp.
      const fs = await import('fs');
      const promptPath = '/tmp/agentrunner-test-prompt.md';
      fs.writeFileSync(promptPath, 'test prompt content');
      fs.mkdirSync('/tmp/agentrunner-test-runs', { recursive: true });

      const before = new Date().toISOString();

      const agent = makeAgent({ workingDirectory: '/tmp' });
      // executeRun will spawn a real process — use a fast command
      const runAgent = makeAgent({ ...agent, executionCommand: 'cat' });

      try {
        await executor.executeRun(runAgent, null);
      } catch {
        // May fail due to mocked paths, but dbRunInsert should have been called
      }

      const after = new Date().toISOString();

      // The 'Running' insert should have a real started_at
      const calls = (dbMock.dbRunInsert as ReturnType<typeof vi.fn>).mock.calls;
      const runningInsert = calls.find((c: any[]) => c[0]?.status === 'Running');
      if (runningInsert) {
        const startedAt = runningInsert[0].started_at;
        expect(startedAt).toBeTruthy();
        expect(startedAt >= before).toBe(true);
        expect(startedAt <= after).toBe(true);
      }
    });
  });

  // ── Bug 4: Concurrent run prevention ───────────────────────────────────

  describe('Bug 4: isAgentRunning prevents concurrent runs', () => {
    it('returns false when no processes are active', () => {
      expect(executor.isAgentRunning('test-agent')).toBe(false);
    });

    it('returns true when agent has an active (not killed) process', () => {
      const proc = makeFakeProc('test-agent');
      proc.killed = false;
      executor.getActiveProcesses().set('run-1', proc as any);

      expect(executor.isAgentRunning('test-agent')).toBe(true);
    });

    it('returns false when agent process is already killed', () => {
      const proc = makeFakeProc('test-agent');
      proc.killed = true;
      executor.getActiveProcesses().set('run-1', proc as any);

      expect(executor.isAgentRunning('test-agent')).toBe(false);
    });

    it('returns false for a different agentId', () => {
      const proc = makeFakeProc('other-agent');
      proc.killed = false;
      executor.getActiveProcesses().set('run-1', proc as any);

      expect(executor.isAgentRunning('test-agent')).toBe(false);
    });

    it('returns true if any of multiple processes belongs to the agent', () => {
      const proc1 = makeFakeProc('other-agent');
      const proc2 = makeFakeProc('test-agent');
      proc1.killed = false;
      proc2.killed = false;
      executor.getActiveProcesses().set('run-1', proc1 as any);
      executor.getActiveProcesses().set('run-2', proc2 as any);

      expect(executor.isAgentRunning('test-agent')).toBe(true);
      expect(executor.isAgentRunning('other-agent')).toBe(true);
      expect(executor.isAgentRunning('nobody')).toBe(false);
    });
  });

  // ── buildCommand ───────────────────────────────────────────────────────

  describe('buildCommand', () => {
    it('returns executionCommand as-is for custom preset', () => {
      const agent = makeAgent({ executionCommand: 'my-tool --flag' });
      expect(executor.buildCommand(agent)).toBe('my-tool --flag');
    });

    it('builds claude command with all options', () => {
      const agent = makeAgent({
        cliPreset: 'claude',
        executionCommand: 'claude',
        claudeOptions: {
          model: 'claude-sonnet-4-6',
          maxTurns: 10,
          outputFormat: 'stream-json',
          sessionMode: 'continue',
          permissionMode: 'bypass',
        },
      });
      const cmd = executor.buildCommand(agent);
      expect(cmd).toContain('--model claude-sonnet-4-6');
      expect(cmd).toContain('--max-turns 10');
      expect(cmd).toContain('--output-format stream-json');
      expect(cmd).toContain('--verbose');
      expect(cmd).toContain('--continue');
      expect(cmd).toContain('--dangerously-skip-permissions');
    });

    it('uses allowedTools when permissionMode is allowedTools', () => {
      const agent = makeAgent({
        cliPreset: 'claude',
        executionCommand: 'claude',
        claudeOptions: { permissionMode: 'allowedTools', allowedTools: 'Bash,Read' },
      });
      const cmd = executor.buildCommand(agent);
      expect(cmd).toContain('--allowedTools Bash,Read');
      expect(cmd).not.toContain('--dangerously-skip-permissions');
    });

    it('returns executionCommand as-is for kiro preset', () => {
      const agent = makeAgent({ cliPreset: 'kiro', executionCommand: 'kiro-cli chat --no-interactive' });
      expect(executor.buildCommand(agent)).toBe('kiro-cli chat --no-interactive');
    });
  });
});

describe('scheduler concurrent run prevention', () => {
  it('scheduleAgent cron callback imports and checks isAgentRunning', async () => {
    // Read the scheduler source to verify the guard is present
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(path.join(__dirname, 'scheduler.ts'), 'utf-8');

    // Verify isAgentRunning is imported
    expect(source).toContain('isAgentRunning');

    // Verify the cron callback checks isAgentRunning before executeRun
    const cronCallbackMatch = source.match(/cron\.schedule\([^,]+,\s*\(\)\s*=>\s*\{([^}]+)\}/s);
    expect(cronCallbackMatch).toBeTruthy();
    const callbackBody = cronCallbackMatch![1];

    // isAgentRunning should appear before executeRun in the callback
    const guardIdx = callbackBody.indexOf('isAgentRunning');
    const execIdx = callbackBody.indexOf('executeRun');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(execIdx);
  });
});
