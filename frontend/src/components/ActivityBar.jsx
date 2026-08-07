import React from 'react';
import { FileText, AlertCircle, History, Terminal } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';

export default function ActivityBar() {
  const { activeActivity, setActiveActivity, isLeftSidebarOpen, setIsLeftSidebarOpen, showTerminalPane, setShowTerminalPane } = useUIStore();

  const toggleActivity = (name) => {
    if (activeActivity === name) {
      setIsLeftSidebarOpen(!isLeftSidebarOpen);
    } else {
      setActiveActivity(name);
      setIsLeftSidebarOpen(true);
    }
  };

  const isActive = (name) => activeActivity === name && isLeftSidebarOpen;

  return (
    <div className="activity-bar" style={{ width: '48px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem 0', gap: '1.5rem', background: 'var(--surface-color)' }}>
      <button onClick={() => toggleActivity('explorer')} style={{ background: 'transparent', border: 'none', color: isActive('explorer') ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Explorer"><FileText size={24} strokeWidth={1.5} /></button>
      <button onClick={() => toggleActivity('search')} style={{ background: 'transparent', border: 'none', color: isActive('search') ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Search"><AlertCircle size={24} strokeWidth={1.5} /></button>
      <button onClick={() => toggleActivity('checkpoints')} style={{ background: 'transparent', border: 'none', color: isActive('checkpoints') ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }} title="Checkpoints"><History size={24} strokeWidth={1.5} /></button>
      <button onClick={() => setShowTerminalPane(!showTerminalPane)} style={{ background: 'transparent', border: 'none', color: showTerminalPane ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', marginTop: 'auto' }} title="Terminal"><Terminal size={24} strokeWidth={1.5} /></button>
    </div>
  );
}
