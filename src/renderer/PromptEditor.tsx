import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { IPC, PromptVersion } from '../shared/types';

const api = typeof window !== 'undefined' && window.api ? window.api : { invoke: async () => null, on: () => () => {} };

interface Props {
  agentId: string;
  initialContent: string;
  onSave: (content: string) => void;
  onClose: () => void;
}

export default function PromptEditor({ agentId, initialContent, onSave, onClose }: Props) {
  const [content, setContent] = useState(initialContent);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PromptVersion[]>([]);

  useEffect(() => {
    if (showHistory) {
      api.invoke(IPC.PROMPT_HISTORY, agentId).then(h => setHistory(h || []));
    }
  }, [showHistory, agentId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 's' && e.metaKey) { e.preventDefault(); onSave(content); }
  };

  return (
    <div className="prompt-editor-overlay" onKeyDown={handleKeyDown}>
      <div className="prompt-editor-toolbar">
        <div className="btn-group">
          <button className="btn btn-sm" onClick={onClose}>← Back</button>
          <button className="btn btn-sm" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Editor' : 'History'}
          </button>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(content)}>Save (⌘S)</button>
      </div>

      {showHistory ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {history.length === 0 && <div style={{ color: 'var(--text-muted)' }}>No history yet</div>}
          {history.map(v => (
            <div key={v.id} className="section" style={{ marginBottom: 8 }}>
              <div className="section-header">
                <span className="section-title">v{v.version} — {new Date(v.createdAt).toLocaleString()}</span>
                <button className="btn btn-sm" onClick={() => { setContent(v.content); setShowHistory(false); }}>Restore</button>
              </div>
              <div className="prompt-preview" style={{ maxHeight: 120 }}>{v.content.slice(0, 500)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="prompt-editor-content">
          <textarea value={content} onChange={e => setContent(e.target.value)} autoFocus />
          <div className="prompt-editor-preview markdown-body">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
