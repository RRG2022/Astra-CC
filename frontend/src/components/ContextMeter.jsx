import React from 'react';

const formatTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Shows how full the model's context window is.
 *
 * Context exhaustion is the thing most likely to be silently degrading the
 * agent's answers, and it was previously invisible — the user had no way to
 * tell a confused model from a full one.
 */
const ContextMeter = ({ usage }) => {
  if (!usage || !usage.budget) return null;

  const { used, budget, percent, compacted } = usage;
  const color = percent >= 90 ? '#e06c75' : percent >= 70 ? '#e5c07b' : '#5c6370';

  const title = `${used.toLocaleString()} of ~${budget.toLocaleString()} usable tokens`
    + ` (window ${usage.contextWindow.toLocaleString()})`
    + (compacted ? ' — older turns were compacted to make room' : '');

  return (
    <div
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        fontSize: '0.7rem', color: 'var(--text-secondary, #888)', whiteSpace: 'nowrap'
      }}
    >
      <div
        role="progressbar"
        aria-label="Context window usage"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: 48, height: 4, borderRadius: 2,
          background: '#3a3a3a', overflow: 'hidden'
        }}
      >
        <div style={{ width: `${Math.min(100, percent)}%`, height: '100%', background: color }} />
      </div>
      <span>{formatTokens(used)}/{formatTokens(budget)}</span>
      {compacted && <span style={{ color: '#e5c07b' }} title="Older turns were compacted">⤺</span>}
    </div>
  );
};

export default ContextMeter;
