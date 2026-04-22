import * as net from 'net';
import * as fs from 'fs';
import { BrowserWindow } from 'electron';
import { getSocketPath, validateApiToken } from './config';
import * as svc from './services';

let server: net.Server | null = null;

// Track streaming subscriptions: runId -> Set<socket>
const streamSubs = new Map<string, Set<net.Socket>>();

// Pending subscriptions: agentId -> Set<socket> (registered before runId is known)
const pendingSubs = new Map<string, Set<net.Socket>>();

// Promote pending subs to runId-based subs
function promotePendingSubs(agentId: string, runId: string) {
  const pending = pendingSubs.get(agentId);
  if (!pending || pending.size === 0) return;
  if (!streamSubs.has(runId)) streamSubs.set(runId, new Set());
  const subs = streamSubs.get(runId)!;
  for (const s of pending) subs.add(s);
  pendingSubs.delete(agentId);
}

export function startSocketServer() {
  const sockPath = getSocketPath();
  try { fs.unlinkSync(sockPath); } catch {}

  server = net.createServer(handleConnection);
  server.listen(sockPath, () => {
    try { fs.chmodSync(sockPath, 0o600); } catch {}
  });
  server.on('error', (err) => {
    console.error('[socket-server] error:', err.message);
  });
}

export function stopSocketServer() {
  if (!server) return;
  // Close all streaming subscriptions
  for (const subs of streamSubs.values()) {
    for (const s of subs) { try { s.end(); } catch {} }
  }
  streamSubs.clear();
  server.close();
  server = null;
  try { fs.unlinkSync(getSocketPath()); } catch {}
}

// Called from executor via main process when run output arrives
export function broadcastRunOutput(runId: string, stream: string, data: string, agentId?: string) {
  // Check pending subs (keyed by agentId) and promote them
  if (agentId && pendingSubs.has(agentId)) {
    promotePendingSubs(agentId, runId);
  }
  const subs = streamSubs.get(runId);
  if (!subs) return;
  for (const sock of subs) {
    writeLine(sock, { event: 'output', stream, data });
  }
}

export function broadcastRunDone(runId: string, status: string, agentId?: string) {
  // Check pending subs (keyed by agentId) and promote them
  if (agentId && pendingSubs.has(agentId)) {
    promotePendingSubs(agentId, runId);
  }
  const subs = streamSubs.get(runId);
  if (!subs) return;
  for (const sock of subs) {
    writeLine(sock, { event: 'done', status });
  }
  streamSubs.delete(runId);
}

const MAX_MSG_SIZE = 1024 * 1024; // 1 MB

function handleConnection(sock: net.Socket) {
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    if (buf.length > MAX_MSG_SIZE) {
      sock.destroy();
      buf = '';
      return;
    }
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) handleMessage(sock, line);
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => {
    // Remove from all streaming subscriptions
    for (const [rid, subs] of streamSubs) {
      subs.delete(sock);
      if (subs.size === 0) streamSubs.delete(rid);
    }
    // Remove from pending subscriptions
    for (const [aid, subs] of pendingSubs) {
      subs.delete(sock);
      if (subs.size === 0) pendingSubs.delete(aid);
    }
  });
}

async function handleMessage(sock: net.Socket, raw: string) {
  let msg: any;
  try { msg = JSON.parse(raw); } catch {
    return writeLine(sock, { ok: false, error: 'Invalid JSON' });
  }

  const { method, params = {}, token } = msg;

  // Auth check
  if (!token || !validateApiToken(token)) {
    return writeLine(sock, { ok: false, error: 'Unauthorized' });
  }

  try {
    const result = await dispatch(method, params, sock);
    writeLine(sock, { ok: true, data: result });
  } catch (err: any) {
    writeLine(sock, { ok: false, error: err.message || String(err) });
  }
}

async function dispatch(method: string, p: any, sock: net.Socket): Promise<any> {
  switch (method) {
    case 'agents.list': return svc.agentsList();
    case 'agents.get': return svc.agentGet(p.id);
    case 'agents.create': return svc.agentCreate(p);
    case 'agents.update': {
      const { id, ...data } = p;
      return svc.agentUpdate(id, data);
    }
    case 'agents.delete': return svc.agentDelete(p.id);
    case 'agents.duplicate': return svc.agentDuplicate(p.id);
    case 'agents.toggle': return svc.agentToggle(p.id);

    case 'run.start': {
      const win = BrowserWindow.getAllWindows()[0] || null;
      // Register pending subscription BEFORE starting the run to avoid race
      if (p.stream) {
        if (!pendingSubs.has(p.agentId)) pendingSubs.set(p.agentId, new Set());
        pendingSubs.get(p.agentId)!.add(sock);
      }
      const runId = await svc.runStart(p.agentId, win);
      if (!runId) {
        // Clean up pending sub on failure
        pendingSubs.get(p.agentId)?.delete(sock);
        throw new Error('Agent not found');
      }
      // Promote pending sub to runId-based sub
      if (p.stream) promotePendingSubs(p.agentId, runId);
      return runId;
    }
    case 'run.cancel': return svc.runCancel(p.runId);
    case 'runs.list': {
      if (p.agentId) return svc.runsList(p.agentId);
      // All runs across all agents
      const agents = svc.agentsList();
      const all: any[] = [];
      for (const a of agents) all.push(...svc.runsList(a.id));
      all.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
      return all;
    }
    case 'runs.get': return svc.runGet(p.runId);
    case 'runs.delete': return svc.runDelete(p.agentId, p.runId);
    case 'runs.logs': {
      const run = svc.runGet(p.runId);
      if (!run) throw new Error('Run not found');
      return svc.logGet(run.agentId, p.runId, p.stream === 'stderr' ? 'stderr' : 'stdout');
    }
    case 'runs.artifacts': return svc.artifactsList(p.runId);

    case 'prompt.get': return svc.promptGet(p.agentId);
    case 'prompt.save': return svc.promptSave(p.agentId, p.content);
    case 'prompt.history': return svc.promptHistory(p.agentId);

    case 'config.get': return svc.configGet();
    case 'config.set': {
      const cfg = svc.configGet() as any;
      // Support dotted keys like "notifications.onRunComplete"
      const keys = (p.key as string).split('.');
      // Reject prototype pollution attempts
      const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
      if (keys.some(k => forbidden.has(k))) {
        throw new Error(`Invalid config key: ${p.key}`);
      }
      let obj = cfg;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!Object.prototype.hasOwnProperty.call(obj, keys[i]) || typeof obj[keys[i]] !== 'object') {
          throw new Error(`Invalid config key: ${p.key}`);
        }
        obj = obj[keys[i]];
      }
      // Parse booleans and numbers
      let val: any = p.value;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(Number(val)) && val !== '') val = Number(val);
      obj[keys[keys.length - 1]] = val;
      svc.configSave(cfg);
      return cfg;
    }

    case 'status': return svc.getStatus();

    default: throw new Error(`Unknown method: ${method}`);
  }
}

function writeLine(sock: net.Socket, data: any) {
  try { sock.write(JSON.stringify(data) + '\n'); } catch {}
}
