import React, { useState, useEffect } from 'react';
import { History, Undo, FileText, Check, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useWorkspaceStore } from '../lib/stores/useWorkspaceStore';
import { useFileStore } from '../lib/stores/useFileStore';

// LCS Line Diffing implementation
function diffLines(oldStr, newStr) {
  const oldLines = (oldStr || '').split(/\r?\n/);
  const newLines = (newStr || '').split(/\r?\n/);
  
  const dp = Array(oldLines.length + 1).fill(null).map(() => Array(newLines.length + 1).fill(0));
  
  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const result = [];
  let i = oldLines.length;
  let j = newLines.length;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'normal', value: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', value: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', value: oldLines[i - 1] });
      i--;
    }
  }
  
  return result;
}

export default function CheckpointPanel({ onClose, handleRewind }) {
  const { workspacePath } = useWorkspaceStore();
  const { activeFileIdMain, openFilesMain } = useFileStore();

  const [history, setHistory] = useState([]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitContent, setCommitContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [rewinding, setRewinding] = useState(false);

  const activeFile = openFilesMain.find(f => f.name === activeFileIdMain);
  const currentContent = activeFile ? activeFile.content : '';

  // Load history when active file changes
  useEffect(() => {
    if (!workspacePath || !activeFileIdMain) {
      setHistory([]);
      setSelectedCommit(null);
      return;
    }

    const fetchHistory = async () => {
      setLoading(true);
      try {
        const res = await fetch('http://localhost:8789/api/shadow/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspacePath, filePath: activeFileIdMain })
        });
        const data = await res.json();
        if (data.success) {
          setHistory(data.history || []);
        }
      } catch (e) {
        console.error('Failed to load checkpoint history:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [workspacePath, activeFileIdMain]);

  // Load content at selected commit
  useEffect(() => {
    if (!selectedCommit || !workspacePath || !activeFileIdMain) {
      setCommitContent('');
      return;
    }

    const fetchCommitContent = async () => {
      try {
        const res = await fetch('http://localhost:8789/api/shadow/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspacePath,
            filePath: activeFileIdMain,
            commitSha: selectedCommit.sha
          })
        });
        const data = await res.json();
        if (data.success) {
          setCommitContent(data.content || '');
        }
      } catch (e) {
        console.error('Failed to fetch commit content:', e);
      }
    };

    fetchCommitContent();
  }, [selectedCommit, workspacePath, activeFileIdMain]);

  const handlePerformRewind = async () => {
    if (!selectedCommit || !activeFileIdMain) return;
    setRewinding(true);
    try {
      await handleRewind(activeFileIdMain, selectedCommit.sha);
      // Reload history
      const res = await fetch('http://localhost:8789/api/shadow/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, filePath: activeFileIdMain })
      });
      const data = await res.json();
      if (data.success) {
        setHistory(data.history || []);
      }
      setSelectedCommit(null);
    } catch (e) {
      console.error(e);
    } finally {
      setRewinding(false);
    }
  };

  if (!activeFileIdMain) {
    return (
      <div style={{ width: '380px', borderLeft: '1px solid var(--border-color)', background: 'var(--bg-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', padding: '2rem', textAlign: 'center' }}>
        <History size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
        <h3>No File Open</h3>
        <p style={{ fontSize: '0.85rem' }}>Open a file in the editor to see its revision history.</p>
      </div>
    );
  }

  const diffResult = selectedCommit ? diffLines(commitContent, currentContent) : [];

  return (
    <div style={{ width: '420px', borderLeft: '1px solid var(--border-color)', background: 'var(--bg-color)', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '1rem', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <History size={18} style={{ color: 'var(--text-primary)' }} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Checkpoints</span>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem' }}>Close</button>
      </div>

      {/* Main Section */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {selectedCommit ? (
          /* Checkpoint Diff Mode */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '0.75rem 1rem', background: '#252526', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button onClick={() => setSelectedCommit(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <ArrowLeft size={16} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCommit.message}</div>
                <div style={{ fontSize: '0.7rem', color: '#888' }}>{selectedCommit.date}</div>
              </div>
            </div>

            {/* Diff View */}
            <div style={{ flex: 1, overflow: 'auto', background: '#1e1e1e', fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.5rem' }}>
              {diffResult.map((line, idx) => {
                let bgColor = 'transparent';
                let textColor = '#d4d4d4';
                let prefix = ' ';

                if (line.type === 'added') {
                  bgColor = '#1d3a23';
                  textColor = '#c2f8cb';
                  prefix = '+';
                } else if (line.type === 'removed') {
                  bgColor = '#3a1d1d';
                  textColor = '#f8c2c2';
                  prefix = '-';
                }

                return (
                  <pre key={idx} style={{ margin: 0, padding: '0.1rem 0.25rem', backgroundColor: bgColor, color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    <span style={{ opacity: 0.5, marginRight: '0.5rem', userSelect: 'none' }}>{prefix}</span>
                    {line.value || ' '}
                  </pre>
                );
              })}
            </div>

            {/* Action Bar */}
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-color)' }}>
              <button 
                onClick={handlePerformRewind} 
                disabled={rewinding}
                style={{ 
                  background: 'var(--text-primary)', 
                  border: 'none', 
                  color: 'var(--bg-color)', 
                  padding: '0.5rem 1rem', 
                  borderRadius: '4px', 
                  cursor: 'pointer', 
                  fontWeight: 'bold', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.25rem' 
                }}
              >
                <Undo size={14} /> {rewinding ? 'Rolling back...' : 'Rollback to this state'}
              </button>
            </div>
          </div>
        ) : (
          /* Checkpoint List Mode */
          <div style={{ padding: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: '#888', padding: '0.5rem', fontWeight: 600 }}>FILE: {activeFileIdMain}</div>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <div className="tool-spinner"></div>
              </div>
            ) : history.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                No revisions found. Changes are committed automatically when files are modified by the agent.
              </div>
            ) : (
              history.map((commit) => (
                <div 
                  key={commit.sha} 
                  onClick={() => setSelectedCommit(commit)}
                  style={{ 
                    padding: '0.75rem', 
                    borderRadius: '6px', 
                    cursor: 'pointer', 
                    border: '1px solid transparent',
                    background: '#252526',
                    marginBottom: '0.5rem',
                    transition: 'all 0.2s'
                  }}
                  className="checkpoint-item"
                >
                  <div style={{ display: 'flex', justifyBetween: 'space-between', marginBottom: '0.25rem', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{commit.message}</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span>{commit.date}</span>
                    <span style={{ fontFamily: 'monospace' }}>{commit.sha.substring(0, 7)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
