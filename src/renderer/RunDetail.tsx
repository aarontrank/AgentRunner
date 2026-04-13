import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { Run, Artifact, Agent, IPC } from '../shared/types';

const api = typeof window !== 'undefined' && window.api ? window.api : { invoke: async () => null, on: () => () => {} };

interface Props {
  run: Run;
  agentId: string;
  agent?: Agent;
  output?: { stdout: string; stderr: string };
  onDelete: () => void;
}

// --- Stream-JSON parser ---

interface StreamEvent {
  type: string;
  [key: string]: any;
}

function parseStreamJson(text: string): StreamEvent[] {
  return text
    .split('\n')
    .filter(l => l.trim().startsWith('{'))
    .flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function ToolCallBlock({ event, result }: { event: StreamEvent; result?: StreamEvent }) {
  const [open, setOpen] = useState(false);
  const inputStr = event.input ? JSON.stringify(event.input, null, 2) : '';
  const resultStr = result?.content
    ? (typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2))
    : '';

  return (
    <div className={`tool-call ${result?.is_error ? 'tool-call-error' : ''}`}>
      <div className="tool-call-header" onClick={() => setOpen(o => !o)}>
        <span className="tool-call-icon">{result?.is_error ? '✗' : '✓'}</span>
        <span className="tool-call-name">{event.name}</span>
        <span className="tool-call-chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="tool-call-body">
          {inputStr && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">Input</div>
              <pre className="tool-call-code">{inputStr}</pre>
            </div>
          )}
          {resultStr && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">Output</div>
              <pre className="tool-call-code">{resultStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StreamJsonView({ text }: { text: string }) {
  const events = parseStreamJson(text);

  if (events.length === 0) {
    return <div className="terminal">{text || '(empty)'}</div>;
  }

  // Build a map from tool_use id -> tool_result event
  const resultMap = new Map<string, StreamEvent>();
  for (const e of events) {
    if (e.type === 'tool_result' && e.tool_use_id) resultMap.set(e.tool_use_id, e);
  }

  const resultEvent = events.find(e => e.type === 'result');
  const toolUseEvents = events.filter(e => e.type === 'tool_use');

  // Collect assistant text blocks (non-tool content)
  const assistantTexts: string[] = [];
  for (const e of events) {
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const block of e.message.content) {
        if (block.type === 'text' && block.text) assistantTexts.push(block.text);
      }
    }
  }

  const usage = resultEvent?.usage;
  const totalCost = resultEvent?.total_cost_usd;

  return (
    <div className="stream-json-view">
      {/* Tool calls */}
      {toolUseEvents.length > 0 && (
        <div className="stream-section">
          <div className="stream-section-label">Tool Calls ({toolUseEvents.length})</div>
          {toolUseEvents.map((e, i) => (
            <ToolCallBlock key={e.id || i} event={e} result={resultMap.get(e.id)} />
          ))}
        </div>
      )}

      {/* Final result */}
      {resultEvent?.result && (
        <div className="stream-section">
          <div className="stream-section-label">Result</div>
          <div className="markdown-body stream-result">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{resultEvent.result}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Fallback: assistant text if no result event */}
      {!resultEvent && assistantTexts.length > 0 && (
        <div className="stream-section">
          <div className="stream-section-label">Output</div>
          <div className="markdown-body stream-result">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{assistantTexts.join('\n\n')}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Usage footer */}
      {(usage || totalCost !== undefined) && (
        <div className="stream-usage">
          {usage && (
            <>
              <span>{usage.input_tokens?.toLocaleString()} in</span>
              <span>{usage.output_tokens?.toLocaleString()} out</span>
              {usage.cache_read_input_tokens > 0 && (
                <span>{usage.cache_read_input_tokens?.toLocaleString()} cached</span>
              )}
            </>
          )}
          {totalCost !== undefined && <span>${totalCost.toFixed(4)}</span>}
          {resultEvent?.num_turns !== undefined && <span>{resultEvent.num_turns} turns</span>}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export default function RunDetail({ run, agentId, agent, output, onDelete }: Props) {
  const isClaudeStreamJson =
    agent?.cliPreset === 'claude' &&
    (agent?.claudeOptions?.outputFormat === 'stream-json' || !agent?.claudeOptions?.outputFormat);

  const defaultTab = isClaudeStreamJson ? 'result' : 'stdout';
  const [tab, setTab] = useState<'result' | 'stdout' | 'stderr' | 'artifacts'>(defaultTab);
  const [logContent, setLogContent] = useState<{ stdout: string | null; stderr: string | null }>({ stdout: null, stderr: null });
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [viewingArtifact, setViewingArtifact] = useState<{ name: string; content: string } | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.invoke(IPC.ARTIFACTS_LIST, run.runId).then(a => {
      const list = a || [];
      setArtifacts(list);
      if (list.length > 0 && run.status !== 'Running') setTab('artifacts');
    });
  }, [run.runId, run.status]);

  useEffect(() => {
    if (run.status !== 'Running') {
      api.invoke(IPC.LOG_GET, agentId, run.runId, 'stdout').then(s => setLogContent(prev => ({ ...prev, stdout: s })));
      api.invoke(IPC.LOG_GET, agentId, run.runId, 'stderr').then(s => setLogContent(prev => ({ ...prev, stderr: s })));
    }
  }, [run.runId, run.status, agentId]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [output, logContent, tab]);

  const stdoutContent = run.status === 'Running'
    ? (output?.stdout || '')
    : (logContent.stdout ?? output?.stdout ?? '');
  const stderrContent = run.status === 'Running'
    ? (output?.stderr || '')
    : (logContent.stderr ?? output?.stderr ?? '');

  const openArtifact = async (art: Artifact) => {
    if (art.fileName.endsWith('.md')) {
      const content = await api.invoke(IPC.ARTIFACT_CONTENT, art.filePath);
      if (content) setViewingArtifact({ name: art.fileName, content });
    } else {
      api.invoke(IPC.ARTIFACT_OPEN, art.filePath);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (run.status !== 'Running' || !run.startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(run.startedAt!).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [run.status, run.startedAt]);

  const formatSeconds = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  const duration = run.startedAt && run.completedAt
    ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {run.startedAt && <span>Started: {new Date(run.startedAt).toLocaleString()}</span>}
        {run.status === 'Running'
          ? <span style={{ color: 'var(--green)' }}>⏱ {formatSeconds(elapsed)}</span>
          : duration !== null && <span>Duration: {formatSeconds(duration)}</span>}
        {run.exitCode !== null && run.exitCode !== undefined && <span>Exit: {run.exitCode}</span>}
        {run.promptVersion && <span>Prompt v{run.promptVersion}</span>}
      </div>

      {/* Output tabs */}
      <div className="tabs">
        {isClaudeStreamJson && (
          <button className={`tab ${tab === 'result' ? 'active' : ''}`} onClick={() => setTab('result')}>Result</button>
        )}
        <button className={`tab ${tab === 'stdout' ? 'active' : ''}`} onClick={() => setTab('stdout')}>stdout</button>
        <button className={`tab ${tab === 'stderr' ? 'active' : ''}`} onClick={() => setTab('stderr')}>stderr</button>
        <button className={`tab ${tab === 'artifacts' ? 'active' : ''}`} onClick={() => setTab('artifacts')}>
          artifacts{artifacts.length > 0 ? ` (${artifacts.length})` : ''}
        </button>
      </div>

      {tab === 'result' && isClaudeStreamJson && (
        <StreamJsonView text={stdoutContent} />
      )}

      {tab === 'stdout' && (
        <div className="terminal" ref={termRef}>{stdoutContent || '(empty)'}</div>
      )}

      {tab === 'stderr' && (
        <div className="terminal" ref={termRef}>{stderrContent || '(empty)'}</div>
      )}

      {tab === 'artifacts' && (
        <div>
          {artifacts.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 10 }}>No artifacts</div>}
          {artifacts.map(a => (
            <div key={a.id} className="artifact-item" onClick={() => openArtifact(a)}
              onContextMenu={e => { e.preventDefault(); api.invoke(IPC.ARTIFACT_OPEN, a.filePath); }}
              style={{ cursor: 'pointer' }}>
              <span style={{ marginRight: 6 }}>{a.fileName.endsWith('.md') ? '📄' : '📎'}</span>
              <span className="name">{a.fileName}</span>
              <span className="size">{formatSize(a.fileSize)}</span>
            </div>
          ))}
          {viewingArtifact && (
            <div style={{ marginTop: 12, background: 'var(--bg)', borderRadius: 4, padding: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px 0', marginBottom: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{viewingArtifact.name}</span>
                <button className="btn btn-sm" onClick={() => setViewingArtifact(null)}>Close</button>
              </div>
              <div className="markdown-body">
                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{viewingArtifact.content}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {run.promptContent && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>Prompt used (v{run.promptVersion})</summary>
          <div className="prompt-preview" style={{ marginTop: 6 }}>{run.promptContent}</div>
        </details>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete Run</button>
      </div>
    </div>
  );
}
