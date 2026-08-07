import React, { useState } from 'react';
import { Circle, CircleDot, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

const ICONS = {
  pending: { Icon: Circle, color: '#5c6370' },
  in_progress: { Icon: CircleDot, color: '#e5c07b' },
  completed: { Icon: CheckCircle2, color: '#98c379' }
};

/**
 * The agent's own plan for a multi-step job.
 *
 * The list is whatever the model last sent — it replaces itself wholesale — so
 * what is rendered here is exactly what the model believes it is doing. That is
 * the point: a plan the user can watch drift is a plan they can interrupt.
 */
const TaskList = ({ tasks }) => {
  const [collapsed, setCollapsed] = useState(false);
  if (!tasks || !tasks.length) return null;

  const done = tasks.filter(t => t.status === 'completed').length;
  const current = tasks.find(t => t.status === 'in_progress');
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div
      data-testid="task-list"
      style={{
        background: '#1e1e1e', border: '1px solid var(--border-color)', borderRadius: '8px',
        padding: '0.5rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.8rem'
      }}
    >
      <button
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--text-secondary, #888)', fontSize: '0.75rem', textAlign: 'left'
        }}
      >
        <Chevron size={14} />
        <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>PLAN</span>
        <span>{done}/{tasks.length}</span>
        {collapsed && current && (
          <span style={{ color: '#e5c07b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            — {current.task}
          </span>
        )}
      </button>

      {!collapsed && (
        <ul style={{ listStyle: 'none', margin: '0.5rem 0 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {tasks.map((task) => {
            const { Icon, color } = ICONS[task.status] || ICONS.pending;
            return (
              <li key={task.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem' }}>
                <Icon size={13} color={color} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                <span style={{
                  color: task.status === 'completed' ? 'var(--text-secondary, #888)' : 'var(--text-primary)',
                  textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                  fontWeight: task.status === 'in_progress' ? 600 : 400
                }}>
                  {task.task}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TaskList;
