import React, { useState } from 'react';
import { Folder, XOctagon, ArrowUp } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';
import { useWorkspaceStore } from '../lib/stores/useWorkspaceStore';
import { apiFetch } from '../lib/api';

export default function WorkspaceBrowser() {
  const { showBrowser, setShowBrowser } = useUIStore();
  const { setWorkspacePath, fetchDir } = useWorkspaceStore();

  const [repoSelectorPath, setRepoSelectorPath] = useState('');
  const [repoSelectorNodes, setRepoSelectorNodes] = useState([]);

  const fetchRepoDir = async (pathStr = '') => {
    try {
      const res = await apiFetch('/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: pathStr })
      });
      const data = await res.json();
      if (data.success) {
        setRepoSelectorNodes(data.directories);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpen = (startPath) => {
    setRepoSelectorPath(startPath);
    fetchRepoDir(startPath);
  };

  const goUp = () => {
    const parts = repoSelectorPath.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? parts.join('/') + '/' : 'C:/';
    setRepoSelectorPath(newPath);
    fetchRepoDir(newPath);
  };

  if (!showBrowser) return null;

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '8px', width: '450px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Select Repository</h3>
          <button onClick={() => setShowBrowser(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><XOctagon size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => handleOpen('C:\\')} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>C:\</button>
          <button onClick={() => handleOpen('D:\\')} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>D:\</button>
          <button onClick={() => handleOpen('E:\\')} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>E:\</button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={repoSelectorPath}
            onChange={(e) => setRepoSelectorPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchRepoDir(repoSelectorPath); }}
            style={{ flex: 1, background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem', color: 'var(--text-primary)', borderRadius: '4px' }}
            placeholder="Type path (e.g. D:\Projects) and press Enter"
          />
          <button
            onClick={() => fetchRepoDir(repoSelectorPath)}
            style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem 1rem', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}
          >
            Go
          </button>
          <button
            onClick={goUp}
            title="Go Up One Folder"
            style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', padding: '0.5rem', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowUp size={18} />
          </button>
        </div>

        <div style={{ height: '300px', overflowY: 'auto', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.5rem' }}>
          <div
            className="fs-node"
            onClick={goUp}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}
          >
            <Folder size={16} /> ..
          </div>
          {repoSelectorNodes.map((node, i) => (
            <div key={i} className="fs-node" onClick={() => {
              setRepoSelectorPath(node.path);
              fetchRepoDir(node.path);
            }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              <Folder size={16} /> {node.name}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={() => setShowBrowser(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', padding: '0.5rem 1rem', color: 'var(--text-primary)', cursor: 'pointer', borderRadius: '4px' }}>Cancel</button>
          <button onClick={() => {
            setWorkspacePath(repoSelectorPath);
            fetchDir(repoSelectorPath);
            setShowBrowser(false);
          }} style={{ background: '#2563eb', border: 'none', padding: '0.5rem 1rem', color: '#fafafa', cursor: 'pointer', borderRadius: '4px' }}>Select This Repository</button>
        </div>
      </div>
    </div>
  );
}
