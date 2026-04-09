import React, { useState } from 'react';
import { Agent } from '../shared/types';

interface Props {
  agent: Agent | null;
  onSave: (data: Partial<Agent>) => void;
  onClose: () => void;
}

export default function AgentForm({ agent, onSave, onClose }: Props) {
  const [name, setName] = useState(agent?.name || '');
  const [cmd, setCmd] = useState(agent?.executionCommand || '');
  const [cwd, setCwd] = useState(agent?.workingDirectory || '');
  const [cron, setCron] = useState(agent?.schedule.cron || '0 9 * * *');
  const [timeout, setTimeout_] = useState(String(agent?.timeoutMinutes || 15));
  const [envVars, setEnvVars] = useState<[string, string][]>(
    agent?.environmentVariables ? Object.entries(agent.environmentVariables) : []
  );
  const [schedMode, setSchedMode] = useState<'simple' | 'advanced'>('simple');
  // Simple mode state
  const [simpleType, setSimpleType] = useState('daily');
  const [simpleTime, setSimpleTime] = useState('09:00');
  const [simpleDay, setSimpleDay] = useState('1'); // Monday

  const buildCronFromSimple = () => {
    const [h, m] = simpleTime.split(':').map(Number);
    if (simpleType === 'hourly') return `0 * * * *`;
    if (simpleType === 'daily') return `${m} ${h} * * *`;
    if (simpleType === 'weekly') return `${m} ${h} * * ${simpleDay}`;
    if (simpleType === 'monthly') return `${m} ${h} ${simpleDay} * *`;
    return '0 9 * * *';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCron = schedMode === 'simple' ? buildCronFromSimple() : cron;
    const env: Record<string, string> = {};
    envVars.forEach(([k, v]) => { if (k.trim()) env[k.trim()] = v; });
    onSave({
      name, executionCommand: cmd, workingDirectory: cwd,
      schedule: { cron: finalCron },
      timeoutMinutes: parseInt(timeout) || 15,
      environmentVariables: Object.keys(env).length > 0 ? env : undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{agent ? 'Edit Agent' : 'New Agent'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="My Agent" />
          </div>
          <div className="form-group">
            <label>Execution Command</label>
            <input value={cmd} onChange={e => setCmd(e.target.value)} required placeholder="kiro-cli chat --trust-all-tools" />
          </div>
          <div className="form-group">
            <label>Working Directory</label>
            <input value={cwd} onChange={e => setCwd(e.target.value)} required placeholder="/Users/me/project" />
          </div>

          {/* Schedule */}
          <div className="form-group">
            <label>
              Schedule
              <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setSchedMode(schedMode === 'simple' ? 'advanced' : 'simple')}>
                {schedMode === 'simple' ? 'Advanced' : 'Simple'}
              </button>
            </label>
            {schedMode === 'simple' ? (
              <div className="form-row" style={{ marginTop: 6 }}>
                <div className="form-group">
                  <select value={simpleType} onChange={e => setSimpleType(e.target.value)}>
                    <option value="hourly">Every hour</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {simpleType !== 'hourly' && (
                  <div className="form-group">
                    <input type="time" value={simpleTime} onChange={e => setSimpleTime(e.target.value)} />
                  </div>
                )}
                {(simpleType === 'weekly') && (
                  <div className="form-group">
                    <select value={simpleDay} onChange={e => setSimpleDay(e.target.value)}>
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
                {(simpleType === 'monthly') && (
                  <div className="form-group">
                    <input type="number" min={1} max={31} value={simpleDay} onChange={e => setSimpleDay(e.target.value)} placeholder="Day" />
                  </div>
                )}
              </div>
            ) : (
              <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 9 * * 1" style={{ marginTop: 6 }} />
            )}
          </div>

          <div className="form-group">
            <label>Timeout (minutes)</label>
            <input type="number" value={timeout} onChange={e => setTimeout_(e.target.value)} min={1} />
          </div>

          {/* Env vars */}
          <div className="form-group">
            <label>Environment Variables</label>
            {envVars.map(([k, v], i) => (
              <div className="env-row" key={i}>
                <input placeholder="KEY" value={k} onChange={e => { const n = [...envVars]; n[i] = [e.target.value, v]; setEnvVars(n); }} />
                <input placeholder="value" value={v} onChange={e => { const n = [...envVars]; n[i] = [k, e.target.value]; setEnvVars(n); }} />
                <button type="button" onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setEnvVars([...envVars, ['', '']])}>+ Add Variable</button>
          </div>

          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{agent ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
