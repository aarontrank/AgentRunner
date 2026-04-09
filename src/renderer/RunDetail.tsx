import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { Run, Artifact, IPC } from '../shared/types';

const api = typeof window !== 'undefined' && window.api ? window.api : { invoke: async () => null, on: () => () => {} };

interface Props {
  run: Run;
  agentId: string;
  output?: { stdout: string; stderr: string };
  onDelete: () => void;
}

export default function RunDetail({ run, agentId, output, onDelete }: Props) {
  const [tab, setTab] = useState<'stdout' | 'stderr' | 'artifacts'>('stdout');
  const [logContent, setLogContent] = useState<{ stdout: string | null; stderr: string | null }>({ stdout: null, stderr: null });
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [viewingArtifact, setViewingArtifact] = useState<{ name: string; content: string } | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.invoke(IPC.ARTIFACTS_LIST, run.runId).then(a => {
      const list = a || [];
      setArtifacts(list);
      // Auto-switch to artifacts tab if there are artifacts and run is done
      if (list.length > 0 && run.status !== 'Running') setTab('artifacts');
    });
  }, [run.runId, run.status]);

  // Load logs for completed runs
  useEffect(() => {
    if (run.status !== 'Running') {
      api.invoke(IPC.LOG_GET, agentId, run.runId, 'stdout').then(s => setLogContent(prev => ({ ...prev, stdout: s })));
      api.invoke(IPC.LOG_GET, agentId, run.runId, 'stderr').then(s => setLogContent(prev => ({ ...prev, stderr: s })));
    }
  }, [run.runId, run.status, agentId]);

  // Auto-scroll terminal
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [output, logContent, tab]);

  const displayContent = run.status === 'Running'
    ? (output?.[tab] || '')
    : (logContent[tab] ?? '(log not available)');

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

  const duration = run.startedAt && run.completedAt
    ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {run.startedAt && <span>Started: {new Date(run.startedAt).toLocaleString()}</span>}
        {duration !== null && <span>Duration: {duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`}</span>}
        {run.exitCode !== null && run.exitCode !== undefined && <span>Exit: {run.exitCode}</span>}
        {run.promptVersion && <span>Prompt v{run.promptVersion}</span>}
      </div>

      {/* Output tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'stdout' ? 'active' : ''}`} onClick={() => setTab('stdout')}>stdout</button>
        <button className={`tab ${tab === 'stderr' ? 'active' : ''}`} onClick={() => setTab('stderr')}>stderr</button>
        <button className={`tab ${tab === 'artifacts' ? 'active' : ''}`} onClick={() => setTab('artifacts')}>
          artifacts{artifacts.length > 0 ? ` (${artifacts.length})` : ''}
        </button>
      </div>

      {tab === 'artifacts' ? (
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

          {/* Inline markdown artifact viewer */}
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
      ) : (
        <div className="terminal" ref={termRef}>{displayContent || '(empty)'}</div>
      )}

      {/* Prompt used */}
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
