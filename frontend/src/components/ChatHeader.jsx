import React from 'react';
import { Folder } from 'lucide-react';
import { useWorkspaceStore } from '../lib/stores/useWorkspaceStore';
import { useAgentStore } from '../lib/stores/useAgentStore';
import { useUIStore } from '../lib/stores/useUIStore';
import { PERSONAS } from '../lib/constants';

export default function ChatHeader({ clearMemory, handleBrowse, isGenerating, sidebarWidth }) {
  const { workspacePath, setWorkspacePath } = useWorkspaceStore();
  const { selectedPersona, setSelectedPersona, messages } = useAgentStore();

  return (
    <div style={{
      width: sidebarWidth,
      padding: '0.5rem 1rem',
      display: 'flex',
      alignItems: 'center',
      borderLeft: '1px solid var(--border-color)',
    }}>
      <div className="header-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', width: '100%', justifyContent: 'flex-start' }}>
        <div className="selector-group" title="Workspace" style={{ flex: '1 1 auto', minWidth: '120px' }}>
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
            <input
              type="text"
              id="workspace"
              className="workspace-input"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder="Workspace path..."
              style={{ background: '#1e1e1e', border: 'none', height: 32, flex: 1, minWidth: 0 }}
            />
            <button onClick={handleBrowse} className="browse-btn" title="Browse Workspace" style={{ background: '#1e1e1e', border: 'none', borderRadius: 4, padding: '0 0.5rem', cursor: 'pointer', color: 'var(--text-primary)', flexShrink: 0 }}><Folder size={14}/></button>
          </div>
        </div>
        <div className="selector-group" title="Persona" style={{ flex: '1 1 auto', minWidth: '100px' }}>
          <select
            id="persona"
            value={selectedPersona}
            onChange={(e) => setSelectedPersona(e.target.value)}
            style={{ background: '#1e1e1e', border: 'none', height: 32, width: '100%' }}
          >
            {Object.entries(PERSONAS).map(([key, data]) => (
              <option key={key} value={key}>{data.name}</option>
            ))}
          </select>
        </div>
        <button onClick={clearMemory} disabled={isGenerating || messages.length === 0} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }} title="Clear Memory">Clear</button>
      </div>
    </div>
  );
}
