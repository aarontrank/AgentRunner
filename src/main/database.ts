import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

let db: Database.Database;

export function getDb() { return db; }

export function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'agentrunner.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      execution_command TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timeout_minutes INTEGER NOT NULL DEFAULT 15,
      environment_variables TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cli_preset TEXT,
      cli_options TEXT
    );
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Scheduled','Running','Completed','Failed','Timed Out','Cancelled')),
      started_at TEXT,
      completed_at TEXT,
      exit_code INTEGER,
      prompt_version INTEGER,
      prompt_content TEXT,
      timeout_minutes INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_agent ON prompt_versions(agent_id, version);
  `);

  // Non-destructive migrations for existing databases
  const agentCols = (db.prepare('PRAGMA table_info(agents)').all() as any[]).map(c => c.name);
  if (!agentCols.includes('cli_preset')) db.exec('ALTER TABLE agents ADD COLUMN cli_preset TEXT');
  if (!agentCols.includes('cli_options')) db.exec('ALTER TABLE agents ADD COLUMN cli_options TEXT');

  const runCols = (db.prepare('PRAGMA table_info(runs)').all() as any[]).map(c => c.name);
  if (!runCols.includes('kiro_agent')) db.exec('ALTER TABLE runs ADD COLUMN kiro_agent TEXT');
}

// --- Agent DB ops ---
export function dbAgentsAll() { return db.prepare('SELECT * FROM agents ORDER BY name').all(); }
export function dbAgentGet(id: string) { return db.prepare('SELECT * FROM agents WHERE id = ?').get(id); }
export function dbAgentInsert(a: any) {
  db.prepare(`INSERT INTO agents (id,name,execution_command,working_directory,cron_expression,timeout_minutes,environment_variables,enabled,created_at,updated_at,cli_preset,cli_options) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(a.id, a.name, a.execution_command, a.working_directory, a.cron_expression, a.timeout_minutes, a.environment_variables, a.enabled ? 1 : 0, a.created_at, a.updated_at, a.cli_preset ?? null, a.cli_options ?? null);
}
export function dbAgentUpdate(a: any) {
  db.prepare(`UPDATE agents SET name=?,execution_command=?,working_directory=?,cron_expression=?,timeout_minutes=?,environment_variables=?,enabled=?,updated_at=?,cli_preset=?,cli_options=? WHERE id=?`)
    .run(a.name, a.execution_command, a.working_directory, a.cron_expression, a.timeout_minutes, a.environment_variables, a.enabled ? 1 : 0, a.updated_at, a.cli_preset ?? null, a.cli_options ?? null, a.id);
}
export function dbAgentDelete(id: string) { db.prepare('DELETE FROM agents WHERE id = ?').run(id); }

// --- Run DB ops ---
export function dbRunsForAgent(agentId: string) { return db.prepare('SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC').all(agentId); }
export function dbRunGet(runId: string) { return db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId); }
export function dbRunInsert(r: any) {
  db.prepare(`INSERT INTO runs (run_id,agent_id,status,started_at,completed_at,exit_code,prompt_version,prompt_content,timeout_minutes,kiro_agent) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(r.run_id, r.agent_id, r.status, r.started_at, r.completed_at, r.exit_code, r.prompt_version, r.prompt_content, r.timeout_minutes, r.kiro_agent ?? null);
}
export function dbRunUpdateStatus(runId: string, status: string, completedAt: string | null, exitCode: number | null) {
  db.prepare('UPDATE runs SET status=?,completed_at=?,exit_code=? WHERE run_id=?').run(status, completedAt, exitCode, runId);
}
export function dbRunDelete(runId: string) { db.prepare('DELETE FROM runs WHERE run_id = ?').run(runId); }

// --- Artifact DB ops ---
export function dbArtifactsForRun(runId: string) { return db.prepare('SELECT * FROM artifacts WHERE run_id = ?').all(runId); }
export function dbArtifactInsert(a: any) {
  db.prepare('INSERT INTO artifacts (run_id,file_name,file_path,file_size) VALUES (?,?,?,?)').run(a.run_id, a.file_name, a.file_path, a.file_size);
}

// --- Prompt Version DB ops ---
export function dbPromptVersionsForAgent(agentId: string) { return db.prepare('SELECT * FROM prompt_versions WHERE agent_id = ? ORDER BY version DESC').all(agentId); }
export function dbPromptLatestVersion(agentId: string): number {
  const row = db.prepare('SELECT MAX(version) as v FROM prompt_versions WHERE agent_id = ?').get(agentId) as any;
  return row?.v || 0;
}
export function dbPromptLatestContent(agentId: string): string | null {
  const row = db.prepare('SELECT content FROM prompt_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1').get(agentId) as any;
  return row?.content ?? null;
}
export function dbPromptInsert(p: any) {
  db.prepare('INSERT INTO prompt_versions (agent_id,version,content,created_at) VALUES (?,?,?,?)').run(p.agent_id, p.version, p.content, p.created_at);
}
