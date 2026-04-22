import React, { useState, useEffect } from 'react';
import { AppConfig, IPC } from '../shared/types';

const api = typeof window !== 'undefined' && window.api ? window.api : { invoke: async () => null, on: () => () => {} };

interface Props { onClose: () => void; }

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

export default function SettingsPanel({ onClose }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => { api.invoke(IPC.CONFIG_GET).then(setConfig); }, []);

  const save = (patch: Partial<AppConfig>) => {
    const updated = { ...config!, ...patch };
    setConfig(updated);
    api.invoke(IPC.CONFIG_SAVE, updated);
  };

  const generateToken = async () => {
    const newToken = await api.invoke(IPC.API_TOKEN_GENERATE);
    setToken(newToken);
    setShowToken(true);
    // Refresh config to reflect new token
    const cfg = await api.invoke(IPC.CONFIG_GET);
    setConfig(cfg);
  };

  const revokeToken = async () => {
    await api.invoke(IPC.API_TOKEN_REVOKE);
    setToken(null);
    setShowToken(false);
    const cfg = await api.invoke(IPC.CONFIG_GET);
    setConfig(cfg);
  };

  if (!config) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-section">
          <h3>General</h3>
          <div className="setting-row">
            <label>Launch on startup</label>
            <Toggle checked={config.launchOnStartup} onChange={v => save({ launchOnStartup: v })} />
          </div>
        </div>

        <div className="settings-section">
          <h3>Log Retention</h3>
          <div className="setting-row">
            <label>Keep logs for last N runs</label>
            <input type="number" min={1} value={config.logRetentionRuns} style={{ width: 60, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4 }}
              onChange={e => save({ logRetentionRuns: parseInt(e.target.value) || 5 })} />
          </div>
        </div>

        <div className="settings-section">
          <h3>Notifications</h3>
          {([['onRunComplete', 'Run completed'], ['onRunFailed', 'Run failed'], ['onRunTimedOut', 'Run timed out'], ['onRunCancelled', 'Run cancelled']] as const).map(([key, label]) => (
            <div className="setting-row" key={key}>
              <label>{label}</label>
              <Toggle checked={config.notifications[key]} onChange={v => save({ notifications: { ...config.notifications, [key]: v } })} />
            </div>
          ))}
        </div>

        <div className="settings-section">
          <h3>CLI Access (API Token)</h3>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 8px' }}>
            Generate a token to use the <code>agentrunner-cli</code> command-line tool.
          </p>
          {showToken && token ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Copy this token — it won't be shown again. It's also saved to <code>~/.agentrunner-token</code>.
              </div>
              <code style={{ display: 'block', padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, wordBreak: 'break-all', userSelect: 'all' }}>
                {token}
              </code>
            </div>
          ) : (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              {config.apiToken ? 'Token is active.' : 'No token configured.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={generateToken}>
              {config.apiToken ? 'Regenerate Token' : 'Generate Token'}
            </button>
            {config.apiToken && (
              <button className="btn" onClick={revokeToken}>Revoke</button>
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
