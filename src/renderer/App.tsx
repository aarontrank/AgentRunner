import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Agent, Run, AppConfig, IPC } from '../shared/types';
import AgentForm from './AgentForm';
import SettingsPanel from './SettingsPanel';
import PromptEditor from './PromptEditor';
import RunDetail from './RunDetail';
import KiroAgentBrowser from './KiroAgentBrowser';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, cb: (...args: any[]) => void) => () => void;
    };
  }
}

const api = typeof window !== 'undefined' && window.api ? window.api : {
  invoke: async () => null,
  on: () => () => {},
};

function badgeClass(status: string) {
  const s = status.toLowerCase().replace(/\s+/g, '');
  if (s === 'running') return 'badge badge-running';
  if (s === 'completed') return 'badge badge-completed';
  if (s === 'failed') return 'badge badge-failed';
  if (s === 'timedout') return 'badge badge-timedout';
  return 'badge badge-cancelled';
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const [prompt, setPrompt] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showKiroAgents, setShowKiroAgents] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; agentId: string } | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [outputBuffers, setOutputBuffers] = useState<Record<string, { stdout: string; stderr: string }>>({});
  const [claudeMd, setClaudeMd] = useState<string | null>(null);
  const [editingClaudeMd, setEditingClaudeMd] = useState(false);
  const [claudeMdDraft, setClaudeMdDraft] = useState('');

  const loadAgents = useCallback(async () => {
    const list = await api.invoke(IPC.AGENTS_LIST);
    if (list) { setAgents(list); setLoading(false); }
    return list;
  }, []);

  const loadRuns = useCallback(async (agentId: string) => {
    const list = await api.invoke(IPC.RUNS_LIST, agentId);
    if (list) setRuns(list);
  }, []);

  const loadPrompt = useCallback(async (agentId: string) => {
    const content = await api.invoke(IPC.PROMPT_GET, agentId);
    setPrompt(content || '');
  }, []);

  useEffect(() => {
    loadAgents();
    const unsub = api.on('app:ready', () => loadAgents());
    const unsubNav = api.on('navigate', (target: string) => {
      if (target === 'settings') setShowSettings(true);
      if (target === 'kiro-agents') setShowKiroAgents(true);
    });
    return () => { unsub(); unsubNav(); };
  }, [loadAgents]);

  const loadClaudeMd = useCallback(async (agentId: string) => {
    const content = await api.invoke(IPC.CLAUDE_MD_GET, agentId);
    setClaudeMd(content ?? null);
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadRuns(selectedId);
      loadPrompt(selectedId);
      const agent = agents.find(a => a.id === selectedId);
      if (agent?.cliPreset === 'claude') loadClaudeMd(selectedId);
      else setClaudeMd(null);
    }
  }, [selectedId, loadRuns, loadPrompt, loadClaudeMd, agents]);

  // Listen for run status changes
  useEffect(() => {
    const unsub1 = api.on(IPC.RUN_STATUS_CHANGED, ({ runId, agentId, status }: any) => {
      if (status === 'Running') {
        setRunningIds(prev => new Set(prev).add(agentId));
      } else {
        setRunningIds(prev => { const s = new Set(prev); s.delete(agentId); return s; });
      }
      if (agentId === selectedId) loadRuns(agentId);
    });

    const unsub2 = api.on(IPC.RUN_OUTPUT, ({ runId, stream, data }: { runId: string; stream: 'stdout' | 'stderr'; data: string }) => {
      setOutputBuffers(prev => {
        const buf = prev[runId] || { stdout: '', stderr: '' };
        return { ...prev, [runId]: { ...buf, [stream]: buf[stream] + data } };
      });
    });

    return () => { unsub1(); unsub2(); };
  }, [selectedId, loadRuns]);

  // Close context menu on click
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  const selected = agents.find(a => a.id === selectedId) || null;

  const handleCreate = async (data: Partial<Agent>) => {
    await api.invoke(IPC.AGENT_CREATE, data);
    await loadAgents();
    setShowForm(false);
  };

  const handleUpdate = async (data: Partial<Agent>) => {
    if (!editAgent) return;
    await api.invoke(IPC.AGENT_UPDATE, editAgent.id, data);
    await loadAgents();
    setShowForm(false);
    setEditAgent(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete agent and all its runs? This cannot be undone.`)) return;
    await api.invoke(IPC.AGENT_DELETE, id);
    if (selectedId === id) setSelectedId(null);
    await loadAgents();
  };

  const handleDuplicate = async (id: string) => {
    await api.invoke(IPC.AGENT_DUPLICATE, id);
    await loadAgents();
  };

  const handleToggle = async (id: string) => {
    await api.invoke(IPC.AGENT_TOGGLE, id);
    await loadAgents();
  };

  const handleRunNow = async () => {
    if (!selectedId) return;
    const runId = await api.invoke(IPC.RUN_START, selectedId);
    if (runId) {
      setRunningIds(prev => new Set(prev).add(selectedId));
      loadRuns(selectedId);
    }
  };

  const handleCancelRun = async (runId: string) => {
    await api.invoke(IPC.RUN_CANCEL, runId);
  };

  const handleSavePrompt = async (content: string) => {
    if (!selectedId) return;
    await api.invoke(IPC.PROMPT_SAVE, selectedId, content);
    setPrompt(content);
    setShowPromptEditor(false);
  };

  const handleSaveClaudeMd = async () => {
    if (!selectedId) return;
    await api.invoke(IPC.CLAUDE_MD_SAVE, selectedId, claudeMdDraft);
    setClaudeMd(claudeMdDraft);
    setEditingClaudeMd(false);
  };

  const handleDeleteRun = async (runId: string) => {
    if (!selectedId || !confirm('Delete this run permanently?')) return;
    await api.invoke(IPC.RUN_DELETE, selectedId, runId);
    loadRuns(selectedId);
    if (selectedRunId === runId) setSelectedRunId(null);
  };

  const activeRun = runs.find(r => r.status === 'Running') || (runs.length > 0 ? runs[0] : null);

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-title">AgentRunner</span>
        <div className="titlebar-actions">
          <button onClick={() => setShowKiroAgents(true)} title="Kiro Agents">🤖</button>
          <button onClick={() => setShowSettings(true)} title="Settings">⚙</button>
        </div>
      </div>

      <div className="app-body">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">Agents</div>
          <div className="sidebar-list">
            {loading && <div className="sidebar-loading"><span className="spinner" /> Loading…</div>}
            {!loading && agents.length === 0 && <div className="sidebar-empty">Add an agent to get started</div>}
            {agents.map(a => (
              <div
                key={a.id}
                className={`sidebar-item ${selectedId === a.id ? 'active' : ''}`}
                onClick={() => setSelectedId(a.id)}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, agentId: a.id }); }}
              >
                <span className={`dot ${!a.enabled ? 'disabled' : runningIds.has(a.id) ? 'running' : 'idle'}`} />
                <span className="name">{a.name}</span>
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <button className="btn-new" onClick={() => { setEditAgent(null); setShowForm(true); }}>+ New Agent</button>
          </div>
        </div>

        {/* Main panel */}
        <div className="main-panel">
          {!selected ? (
            <div className="empty-state">{loading ? <><span className="spinner" /> Loading…</> : 'Select an agent or create a new one'}</div>
          ) : (
            <>
              {/* Info bar */}
              <div className="info-bar">
                <div className="agent-name">{selected.name}</div>
                <div>
                  <div className="schedule">{selected.schedule.humanReadable || selected.schedule.cron}</div>
                </div>
                <div className="btn-group">
                  <button className="btn btn-primary" onClick={handleRunNow}>▶ Run Now</button>
                  <button className="btn" onClick={() => { setEditAgent(selected); setShowForm(true); }}>Edit</button>
                </div>
              </div>

              {/* Prompt section */}
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Prompt</span>
                  <div className="btn-group">
                    <button className="btn btn-sm" onClick={() => setShowPromptEditor(true)}>Edit</button>
                  </div>
                </div>
                <div className="prompt-preview">
                  {prompt ? prompt.split('\n').slice(0, 10).join('\n') + (prompt.split('\n').length > 10 ? '\n...' : '') : '(empty prompt)'}
                </div>
              </div>

              {/* CLAUDE.md — only for claude preset agents */}
              {selected.cliPreset === 'claude' && (
                <div className="section">
                  <div className="section-header">
                    <span className="section-title">CLAUDE.md</span>
                    <button className="btn btn-sm" onClick={() => {
                      setClaudeMdDraft(claudeMd || '');
                      setEditingClaudeMd(true);
                    }}>Edit</button>
                  </div>
                  {editingClaudeMd ? (
                    <div className="claudemd-editor">
                      <textarea
                        value={claudeMdDraft}
                        onChange={e => setClaudeMdDraft(e.target.value)}
                        placeholder="# Project context for Claude&#10;&#10;Add standing instructions, project overview, tool behaviour rules..."
                        rows={8}
                      />
                      <div className="claudemd-actions">
                        <button className="btn btn-sm" onClick={() => setEditingClaudeMd(false)}>Cancel</button>
                        <button className="btn btn-sm btn-primary" onClick={handleSaveClaudeMd}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className="prompt-preview">
                      {claudeMd
                        ? claudeMd.split('\n').slice(0, 8).join('\n') + (claudeMd.split('\n').length > 8 ? '\n...' : '')
                        : <span style={{ color: 'var(--text-muted)' }}>(no CLAUDE.md in working directory)</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Current / Latest Run */}
              {activeRun && (
                <div className="section">
                  <div className="section-header">
                    <span className="section-title">{activeRun.status === 'Running' ? 'Current Run' : 'Latest Run'}</span>
                    <div className="btn-group">
                      <span className={badgeClass(activeRun.status)}>{activeRun.status}</span>
                      {activeRun.status === 'Running' && (
                        <button className="btn btn-sm btn-danger" onClick={() => handleCancelRun(activeRun.runId)}>Cancel</button>
                      )}
                    </div>
                  </div>
                  <RunDetail
                    key={activeRun.runId}
                    run={activeRun}
                    agentId={selected.id}
                    agent={selected}
                    output={outputBuffers[activeRun.runId]}
                    onDelete={() => handleDeleteRun(activeRun.runId)}
                  />
                </div>
              )}

              {/* Run History */}
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Run History</span>
                </div>
                <div className="run-list">
                  {runs.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No runs yet</div>}
                  {runs.filter(r => !activeRun || r.runId !== activeRun.runId).map(r => (
                    <React.Fragment key={r.runId}>
                      <div
                        className={`run-item ${selectedRunId === r.runId ? 'active' : ''}`}
                        onClick={() => setSelectedRunId(selectedRunId === r.runId ? null : r.runId)}
                      >
                        <span className={badgeClass(r.status)}>{r.status}</span>
                        <span className="run-id">{r.runId.slice(0, 20)}</span>
                        <span className="run-time">{r.startedAt ? new Date(r.startedAt).toLocaleString() : ''}</span>
                      </div>
                      {selectedRunId === r.runId && (
                        <div className="run-detail-inline">
                          <RunDetail
                            run={r}
                            agentId={selected.id}
                            agent={selected}
                            output={outputBuffers[r.runId]}
                            onDelete={() => handleDeleteRun(r.runId)}
                          />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <span>{runningIds.size} agent{runningIds.size !== 1 ? 's' : ''} running</span>
        <span>{agents.length} agent{agents.length !== 1 ? 's' : ''} total</span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="context-menu-item" onClick={() => { setEditAgent(agents.find(a => a.id === contextMenu.agentId) || null); setShowForm(true); }}>Edit</div>
          <div className="context-menu-item" onClick={() => handleDuplicate(contextMenu.agentId)}>Duplicate</div>
          <div className="context-menu-item" onClick={() => handleToggle(contextMenu.agentId)}>
            {agents.find(a => a.id === contextMenu.agentId)?.enabled ? 'Disable' : 'Enable'}
          </div>
          <div className="context-menu-sep" />
          <div className="context-menu-item danger" onClick={() => handleDelete(contextMenu.agentId)}>Delete</div>
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <AgentForm
          agent={editAgent}
          onSave={editAgent ? handleUpdate : handleCreate}
          onClose={() => { setShowForm(false); setEditAgent(null); }}
        />
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showKiroAgents && <KiroAgentBrowser onClose={() => setShowKiroAgents(false)} />}

      {showPromptEditor && selectedId && (
        <PromptEditor
          agentId={selectedId}
          initialContent={prompt}
          onSave={handleSavePrompt}
          onClose={() => setShowPromptEditor(false)}
        />
      )}
    </div>
  );
}
