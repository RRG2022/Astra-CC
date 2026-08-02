import React, { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import LiveTerminal from './LiveTerminal';

const ToolExecution = ({ tool, onRewind }) => {
  const [expanded, setExpanded] = useState(false);

  let taskId = null;
  let checkpointSha = null;
  if (tool.result && typeof tool.result === 'string') {
    if (tool.result.includes('taskId')) {
      try {
        const parsed = JSON.parse(tool.result);
        if (parsed.taskId) taskId = parsed.taskId;
      } catch (e) {}
    }
    if (tool.result.includes('checkpointSha')) {
      try {
        const parsed = JSON.parse(tool.result);
        if (parsed.checkpointSha) checkpointSha = parsed.checkpointSha;
      } catch (e) {}
    }
  }

  return (
    <div className="tool-execution-log" style={{ opacity: tool.status === 'running' ? 0.7 : 1 }}>
      <div className="tool-execution-header" onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', background: '#252526', border: '1px solid var(--border-color)', borderRadius: expanded || tool.status === 'running' ? '4px 4px 0 0' : '4px' }}>
        {tool.status === 'running' ? <div className="tool-spinner" style={{ width: '12px', height: '12px', border: '2px solid #ccc', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> : (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        <span style={{ fontSize: '0.85rem', flex: 1 }}>
          {tool.status === 'running' ? 'Running' : 'Executed'} <strong style={{ color: '#4fc1ff' }}>{tool.name}</strong>
        </span>
        {checkpointSha && onRewind && (
          <button 
            onClick={(e) => { e.stopPropagation(); onRewind(tool.arguments.filePath, checkpointSha); }}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#3c3c3c', border: '1px solid #555', color: '#ccc', borderRadius: '4px', padding: '2px 6px', fontSize: '0.75rem', cursor: 'pointer' }}
          >
            <RefreshCw size={12} /> Rewind
          </button>
        )}
      </div>
      {(expanded || tool.status === 'running') && (
        <div className="tool-execution-body" style={{ padding: '0.5rem', background: '#1e1e1e', border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 4px 4px', fontSize: '0.8rem', color: '#ccc', overflowX: 'auto' }}>
          {tool.status === 'running' ? (
            <div>
              <div style={{ color: '#888', marginBottom: '0.25rem' }}>Arguments:</div>
              <pre style={{ margin: 0 }}>{JSON.stringify(tool.arguments, null, 2)}</pre>
            </div>
          ) : (
            taskId ? (
              <div>
                <div style={{ color: '#888', marginBottom: '0.5rem' }}>[Task sent to background]</div>
                <LiveTerminal taskId={taskId} />
              </div>
            ) : (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tool.result}</pre>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default ToolExecution;
