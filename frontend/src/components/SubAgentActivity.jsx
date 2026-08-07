import React from 'react';
import { Users } from 'lucide-react';

/**
 * What a sub-agent is doing, while it does it.
 *
 * Its transcript deliberately never reaches this browser — that isolation is
 * the whole reason to spawn one. So the honest thing to show is the little
 * that is actually known: the task it was given and the tools it has reached
 * for. Anything richer would be invented.
 */
const SubAgentActivity = ({ subAgent }) => {
  if (!subAgent) return null;

  const { task, toolsUsed = [] } = subAgent;

  return (
    <div
      data-testid="sub-agent-activity"
      style={{
        background: '#1b2430', border: '1px solid #2f4a63', borderRadius: '8px',
        padding: '0.5rem 0.75rem', marginBottom: '0.5rem', fontSize: '0.78rem',
        color: 'var(--text-primary)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#61afef' }}>
        <Users size={14} />
        <span style={{ fontWeight: 600 }}>Sub-agent working</span>
        <span style={{ color: 'var(--text-secondary, #888)' }}>
          {toolsUsed.length} tool{toolsUsed.length === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ marginTop: '0.3rem', color: 'var(--text-secondary, #999)' }}>{task}</div>

      {toolsUsed.length > 0 && (
        <div style={{ marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
          {toolsUsed.slice(-8).map((name, i) => (
            <code
              key={i}
              style={{ background: '#0f1720', borderRadius: '3px', padding: '0.1rem 0.35rem', fontSize: '0.7rem' }}
            >
              {name}
            </code>
          ))}
        </div>
      )}
    </div>
  );
};

export default SubAgentActivity;
