import React, { useState, useMemo } from 'react';
import { Agent, CliPreset, ClaudeOptions } from '../shared/types';

interface Props {
  agent: Agent | null;
  onSave: (data: Partial<Agent>) => void;
  onClose: () => void;
}

const CLAUDE_MODELS = [
  { value: '', label: 'Default' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const PRESET_DEFAULTS: Record<string, string> = {
  claude: 'claude',
  kiro: 'kiro-cli chat --trust-all-tools --no-interactive',
  codex: 'codex',
  custom: '',
};

function buildClaudeCommand(base: string, opts: ClaudeOptions): string {
  const parts: string[] = [base || 'claude'];
  if (opts.model) parts.push('--model', opts.model);
  if (opts.maxTurns) parts.push('--max-turns', String(opts.maxTurns));
  if (opts.outputFormat) parts.push('--output-format', opts.outputFormat);
  if (opts.sessionMode === 'continue') parts.push('--continue');
  const perm = opts.permissionMode ?? 'bypass';
  if (perm === 'bypass') parts.push('--dangerously-skip-permissions');
  else if (perm === 'allowedTools' && opts.allowedTools) parts.push('--allowedTools', opts.allowedTools);
  return parts.join(' ');
}

export default function AgentForm({ agent, onSave, onClose }: Props) {
  const [name, setName] = useState(agent?.name || '');
  const [preset, setPreset] = useState<CliPreset>(agent?.cliPreset || 'custom');
  const [cmd, setCmd] = useState(agent?.executionCommand || '');
  const [cwd, setCwd] = useState(agent?.workingDirectory || '');
  const [cron, setCron] = useState(agent?.schedule.cron || '0 9 * * *');
  const [timeout, setTimeout_] = useState(String(agent?.timeoutMinutes || 15));
  const [envVars, setEnvVars] = useState<[string, string][]>(
    agent?.environmentVariables ? Object.entries(agent.environmentVariables) : []
  );
  const [schedMode, setSchedMode] = useState<'simple' | 'advanced'>('simple');
  const [simpleType, setSimpleType] = useState('daily');
  const [simpleTime, setSimpleTime] = useState('09:00');
  const [simpleDay, setSimpleDay] = useState('1');

  // Claude-specific options
  const existingOpts = agent?.claudeOptions || {};
  const [claudeModel, setClaudeModel] = useState(existingOpts.model || '');
  const [claudeMaxTurns, setClaudeMaxTurns] = useState(String(existingOpts.maxTurns || ''));
  const [claudeOutputFormat, setClaudeOutputFormat] = useState<'text' | 'stream-json'>(existingOpts.outputFormat || 'stream-json');
  const [claudeSessionMode, setClaudeSessionMode] = useState<'fresh' | 'continue'>(existingOpts.sessionMode || 'fresh');
  const [claudePermMode, setClaudePermMode] = useState<'bypass' | 'allowedTools' | 'default'>(existingOpts.permissionMode || 'bypass');
  const [claudeAllowedTools, setClaudeAllowedTools] = useState(existingOpts.allowedTools || '');

  const handlePresetChange = (p: CliPreset) => {
    setPreset(p);
    // Set a sensible default base command when switching presets
    if (!agent) setCmd(PRESET_DEFAULTS[p] || '');
  };

  const buildCronFromSimple = () => {
    const [h, m] = simpleTime.split(':').map(Number);
    if (simpleType === 'hourly') return `0 * * * *`;
    if (simpleType === 'daily') return `${m} ${h} * * *`;
    if (simpleType === 'weekly') return `${m} ${h} * * ${simpleDay}`;
    if (simpleType === 'monthly') return `${m} ${h} ${simpleDay} * *`;
    return '0 9 * * *';
  };

  const claudeOpts: ClaudeOptions = {
    model: claudeModel || undefined,
    maxTurns: claudeMaxTurns ? parseInt(claudeMaxTurns) : undefined,
    outputFormat: claudeOutputFormat,
    sessionMode: claudeSessionMode,
    permissionMode: claudePermMode,
    allowedTools: claudePermMode === 'allowedTools' ? claudeAllowedTools : undefined,
  };

  const commandPreview = useMemo(() => {
    if (preset === 'claude') return buildClaudeCommand(cmd || 'claude', claudeOpts);
    return cmd;
  }, [preset, cmd, claudeModel, claudeMaxTurns, claudeOutputFormat, claudeSessionMode, claudePermMode, claudeAllowedTools]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCron = schedMode === 'simple' ? buildCronFromSimple() : cron;
    const env: Record<string, string> = {};
    envVars.forEach(([k, v]) => { if (k.trim()) env[k.trim()] = v; });

    const baseCmd = preset === 'custom' ? cmd : (cmd || PRESET_DEFAULTS[preset]);

    onSave({
      name,
      executionCommand: baseCmd,
      workingDirectory: cwd,
      schedule: { cron: finalCron },
      timeoutMinutes: parseInt(timeout) || 15,
      environmentVariables: Object.keys(env).length > 0 ? env : undefined,
      cliPreset: preset,
      claudeOptions: preset === 'claude' ? claudeOpts : undefined,
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

          {/* CLI Preset selector */}
          <div className="form-group">
            <label>CLI Preset</label>
            <div className="preset-selector">
              {(['custom', 'claude', 'kiro', 'codex'] as CliPreset[]).map(p => (
                <button
                  key={p}
                  type="button"
                  className={`preset-btn ${preset === p ? 'active' : ''}`}
                  onClick={() => handlePresetChange(p)}
                >
                  {p === 'claude' ? 'Claude Code' : p === 'custom' ? 'Custom' : p === 'kiro' ? 'Kiro' : 'Codex'}
                </button>
              ))}
            </div>
          </div>

          {/* Base command — always shown, label changes by preset */}
          <div className="form-group">
            <label>{preset === 'claude' ? 'Base Command' : 'Execution Command'}</label>
            <input
              value={cmd}
              onChange={e => setCmd(e.target.value)}
              placeholder={PRESET_DEFAULTS[preset] || 'my-cli --flag'}
            />
          </div>

          {/* Claude-specific options */}
          {preset === 'claude' && (
            <div className="claude-options">
              <div className="claude-options-title">Claude Code Options</div>

              <div className="form-row">
                <div className="form-group">
                  <label>Model</label>
                  <select value={claudeModel} onChange={e => setClaudeModel(e.target.value)}>
                    {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Max Turns</label>
                  <input
                    type="number" min={1} max={200}
                    value={claudeMaxTurns}
                    onChange={e => setClaudeMaxTurns(e.target.value)}
                    placeholder="unlimited"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Output Format</label>
                  <select value={claudeOutputFormat} onChange={e => setClaudeOutputFormat(e.target.value as any)}>
                    <option value="stream-json">Stream JSON (structured view)</option>
                    <option value="text">Text (plain output)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Session Mode</label>
                  <select value={claudeSessionMode} onChange={e => setClaudeSessionMode(e.target.value as any)}>
                    <option value="fresh">Fresh (new conversation)</option>
                    <option value="continue">Continue (--continue)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Permissions</label>
                <select value={claudePermMode} onChange={e => setClaudePermMode(e.target.value as any)}>
                  <option value="bypass">Skip all prompts (--dangerously-skip-permissions)</option>
                  <option value="allowedTools">Specific tools (--allowedTools)</option>
                  <option value="default">Default (prompt for each)</option>
                </select>
              </div>

              {claudePermMode === 'allowedTools' && (
                <div className="form-group">
                  <label>Allowed Tools</label>
                  <input
                    value={claudeAllowedTools}
                    onChange={e => setClaudeAllowedTools(e.target.value)}
                    placeholder="Bash,Read,Write,Edit,Glob,Grep"
                  />
                  <div className="form-hint">Comma-separated tool names</div>
                </div>
              )}

              <div className="cmd-preview">
                <div className="cmd-preview-label">Command preview</div>
                <code className="cmd-preview-code">{commandPreview}</code>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Working Directory</label>
            <input value={cwd} onChange={e => setCwd(e.target.value)} required placeholder="/Users/me/project" />
          </div>

          {/* Schedule */}
          <div className="form-group">
            <label>
              Schedule
              <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }}
                onClick={() => setSchedMode(schedMode === 'simple' ? 'advanced' : 'simple')}>
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
                {simpleType === 'weekly' && (
                  <div className="form-group">
                    <select value={simpleDay} onChange={e => setSimpleDay(e.target.value)}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) =>
                        <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
                {simpleType === 'monthly' && (
                  <div className="form-group">
                    <input type="number" min={1} max={31} value={simpleDay}
                      onChange={e => setSimpleDay(e.target.value)} placeholder="Day" />
                  </div>
                )}
              </div>
            ) : (
              <input value={cron} onChange={e => setCron(e.target.value)}
                placeholder="0 9 * * 1" style={{ marginTop: 6 }} />
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
                <input placeholder="KEY" value={k}
                  onChange={e => { const n = [...envVars]; n[i] = [e.target.value, v]; setEnvVars(n); }} />
                <input placeholder="value" value={v}
                  onChange={e => { const n = [...envVars]; n[i] = [k, e.target.value]; setEnvVars(n); }} />
                <button type="button" onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm"
              onClick={() => setEnvVars([...envVars, ['', '']])}>+ Add Variable</button>
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
