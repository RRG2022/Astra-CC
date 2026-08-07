import React, { useState, useEffect } from 'react';
import { Plus, X, XOctagon } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';
import { useWorkspaceStore } from '../lib/stores/useWorkspaceStore';
import { useAgentStore } from '../lib/stores/useAgentStore';
import { apiFetch, getSseUrl } from '../lib/api';
import InteractiveTerminal from './InteractiveTerminal';
import LiveTerminal from './LiveTerminal';

export default function TerminalPane() {
  const { showTerminalPane, setShowTerminalPane, activeTerminalTab, setActiveTerminalTab, shells, setShells } = useUIStore();
  const { workspacePath } = useWorkspaceStore();
  const { activeTask } = useAgentStore();

  // Problems panel state
  const [problems, setProblems] = useState(null);
  const [isLinting, setIsLinting] = useState(false);

  // Output logs state
  const [outputLogs, setOutputLogs] = useState([]);

  // SSE subscription for output logs
  useEffect(() => {
    const sse = new EventSource(getSseUrl('/api/output/stream'));
    sse.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data);
        setOutputLogs(prev => [...prev, log]);
      } catch (err) {}
    };
    return () => sse.close();
  }, []);

  const runLinter = async () => {
    setIsLinting(true);
    try {
      const res = await apiFetch('/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspacePath })
      });
      const data = await res.json();
      setProblems(data.problems || []);
    } catch (e) {
      setProblems([]);
    } finally {
      setIsLinting(false);
    }
  };

  if (!showTerminalPane) return null;

  return (
    <div className="terminal-pane" style={{ flex: '0 0 35%', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="code-viewer-header" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 1rem', background: '#1e1e1e', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span onClick={() => setActiveTerminalTab('problems')} style={{ cursor: 'pointer', color: activeTerminalTab === 'problems' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === 'problems' ? '1px solid var(--text-primary)' : 'none' }}>Problems</span>
          <span onClick={() => setActiveTerminalTab('output')} style={{ cursor: 'pointer', color: activeTerminalTab === 'output' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === 'output' ? '1px solid var(--text-primary)' : 'none' }}>Output</span>

          {shells.map((sh, idx) => (
            <div key={sh.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span
                onClick={() => setActiveTerminalTab(sh.id)}
                style={{ cursor: 'pointer', color: activeTerminalTab === sh.id ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === sh.id ? '1px solid var(--text-primary)' : 'none' }}>
                Terminal {idx + 1}
              </span>
              <button onClick={(e) => {
                e.stopPropagation();
                const newShells = shells.filter(s => s.id !== sh.id);
                setShells(newShells);
                if (activeTerminalTab === sh.id) {
                  setActiveTerminalTab(newShells[0] ? newShells[0].id : 'problems');
                }
              }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }} title="Close Shell"><X size={12} /></button>
            </div>
          ))}
          <button onClick={() => {
            const newId = `shell-${Date.now()}`;
            setShells([...shells, { id: newId }]);
            setActiveTerminalTab(newId);
          }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="New Shell"><Plus size={14} /></button>

          {activeTask && (
            <span
              onClick={() => setActiveTerminalTab('task')}
              style={{ cursor: 'pointer', color: activeTerminalTab === 'task' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTerminalTab === 'task' ? '1px solid var(--text-primary)' : 'none' }}>
              Task: {activeTask.split('-')[0]}...
            </span>
          )}
        </div>
        <button onClick={() => setShowTerminalPane(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><XOctagon size={16} /></button>
      </div>
      <div className="live-terminal-content" style={{ flex: 1, overflow: 'auto', background: '#0d1117' }}>
        {shells.map(sh => (
          <div key={sh.id} style={{ display: activeTerminalTab === sh.id ? 'block' : 'none', height: '100%' }}>
            <InteractiveTerminal workspacePath={workspacePath} sessionId={sh.id} />
          </div>
        ))}
        {activeTerminalTab === 'task' && activeTask ? <LiveTerminal taskId={activeTask} /> : null}
        {activeTerminalTab === 'problems' && (
          <div style={{ padding: '0.5rem', color: 'var(--text-primary)', height: '100%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0.5rem 1rem' }}>
              <h3 style={{ margin: 0 }}>Problems</h3>
              <button onClick={runLinter} disabled={isLinting} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.25rem 0.5rem', cursor: 'pointer', borderRadius: '4px' }}>
                {isLinting ? 'Linting...' : 'Run Linter'}
              </button>
            </div>
            {problems === null ? (
              <div style={{ color: 'var(--text-secondary)', padding: '0 1rem' }}>Click "Run Linter" to scan workspace.</div>
            ) : problems.length === 0 ? (
              <div style={{ color: '#4ade80', padding: '0 1rem' }}>No problems detected in the workspace!</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {problems.map((p, i) => (
                  <div key={i} style={{ padding: '0.25rem 1rem', display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                    <span style={{ color: p.severity === 2 ? '#f87171' : '#facc15', width: '20px' }}>{p.severity === 2 ? '✖' : '⚠'}</span>
                    <span style={{ flex: 1 }}>{p.message}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{p.file}:{p.line}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTerminalTab === 'output' && (
          <div style={{ padding: '0.5rem', color: 'var(--text-primary)', height: '100%', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem' }}>
            {outputLogs.map((log, i) => (
              <div key={i} style={{ color: log.type === 'error' ? '#f87171' : 'var(--text-primary)', marginBottom: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)', marginRight: '0.5rem' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                {log.msg}
              </div>
            ))}
            {outputLogs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No output from backend...</div>}
          </div>
        )}
      </div>
    </div>
  );
}
