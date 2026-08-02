import React, { useState } from 'react';

const JSONPreview = ({ data, title, isString = false }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <details style={{ marginBottom: '0.5rem', cursor: 'pointer' }} onToggle={(e) => setExpanded(e.target.open)}>
      <summary style={{ color: 'var(--accent-color)' }}>{title}</summary>
      {expanded && (
        <pre style={{ margin: '0.5rem 0', background: '#111', padding: '0.5rem', borderRadius: '4px', overflowX: 'auto', color: '#ccc', whiteSpace: isString ? 'pre-wrap' : 'pre', wordBreak: isString ? 'break-all' : 'normal' }}>
          {(() => {
            try {
              const str = isString ? data : JSON.stringify(data, null, 2);
              if (str && str.length > 50000) {
                return str.substring(0, 50000) + '\n... [TRUNCATED FOR PERFORMANCE]';
              }
              return str || String(data);
            } catch (e) {
              return `Error rendering trace: ${e.message}`;
            }
          })()}
        </pre>
      )}
    </details>
  );
};

export default JSONPreview;
