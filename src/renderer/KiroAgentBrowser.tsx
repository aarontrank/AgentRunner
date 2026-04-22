import React, { useState, useEffect } from 'react';
import { KiroAgentConfig, IPC } from '../shared/types';

const api = typeof window !== 'undefined' && window.api ? window.api : { invoke: async () => null, on: () => () => {} };

interface Props { onClose: () => void; }

export default function KiroAgentBrowser({ onClose }: Props) {
  const [agents, setAgents] = useState<KiroAgentConfig[]>([]);
  const [selected, setSelected] = useState<KiroAgentConfig | null>(null);
  const [rawJson, setRawJson] = useState<string | null>(null);

  useEffect(() => {
    api.invoke(IPC.KIRO_AGENTS_LIST).then((list: KiroAgentConfig[]) => {
      setAgents(list || []);
    });
  }, []);

  const viewRaw = async () => {
    if (!selected) return;
    const full = await api.invoke(IPC.KIRO_AGENT_GET, selected.name) as KiroAgentConfig | null;
    setRawJson(full?.rawJson ?? JSON.stringify(full, null, 2));
  };

  const select = (agent: KiroAgentConfig) => {
    setSelected(agent);
    setRawJson(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal kiro-browser-modal" onClick={e => e.stopPropagation()}>
        <h2>Kiro Agents</h2>
        <div className="kiro-browser-layout">
          <div className="kiro-browser-list">
            {agents.map(a => (
              <div
                key={a.name}
                className={`kiro-browser-item${selected?.name === a.name ? ' selected' : ''}`}
                onClick={() => select(a)}
              >
                <div className="kiro-browser-item-name">{a.name}</div>
                {a.description && <div className="kiro-browser-item-desc">{a.description}</div>}
              </div>
            ))}
            {agents.length === 0 && <div className="kiro-browser-empty">No agents found in ~/.kiro/agents/</div>}
          </div>

          <div className="kiro-browser-detail">
            {selected ? (
              <>
                <h3>{selected.name}</h3>
                {selected.description && <p className="kiro-browser-description">{selected.description}</p>}

                {selected.mcpServers && Object.keys(selected.mcpServers).length > 0 && (
                  <div className="kiro-browser-section">
                    <h4>MCP Servers</h4>
                    {Object.entries(selected.mcpServers).map(([name, srv]) => (
                      <div key={name} className="kiro-browser-server">
                        <strong>{name}</strong>
                        {srv.command && <div><code>{srv.command} {srv.args?.join(' ')}</code></div>}
                        {srv.url && <div><code>{srv.url}</code></div>}
                      </div>
                    ))}
                  </div>
                )}

                {selected.tools && selected.tools.length > 0 && (
                  <div className="kiro-browser-section">
                    <h4>Tools</h4>
                    <ul>{selected.tools.map(t => <li key={t}><code>{t}</code></li>)}</ul>
                  </div>
                )}

                {selected.allowedTools && selected.allowedTools.length > 0 && (
                  <div className="kiro-browser-section">
                    <h4>Allowed Tools</h4>
                    <ul>{selected.allowedTools.map(t => <li key={t}><code>{t}</code></li>)}</ul>
                  </div>
                )}

                {selected.resources && selected.resources.length > 0 && (
                  <div className="kiro-browser-section">
                    <h4>Resources</h4>
                    <ul>{selected.resources.map(r => <li key={r}><code>{r}</code></li>)}</ul>
                  </div>
                )}

                <button className="btn" onClick={viewRaw}>View Raw JSON</button>
                {rawJson && <pre className="kiro-browser-raw">{rawJson}</pre>}
              </>
            ) : (
              <div className="kiro-browser-empty">Select an agent to view details</div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
