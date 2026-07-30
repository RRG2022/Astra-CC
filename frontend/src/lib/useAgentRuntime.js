import { useState, useRef, useEffect, useCallback } from 'react';
import { AgentRuntime } from './AgentRuntime.js';

export function useAgentRuntime(options) {
  const { onMessageUpdate, onTraceLog, executeTool, requestApproval, model, tools, workspacePath, authorityLevel, maxIterations } = options;

  const [state, setState] = useState({
    isStreaming: false,
    isExecutingTool: false,
    pendingApproval: null,
    stopReason: null,
    currentActionId: null,
    iterationCount: 0
  });

  const runtimeRef = useRef(null);

  // Initialize runtime lazily once
  if (!runtimeRef.current) {
    runtimeRef.current = new AgentRuntime({
      onStateChange: (newState) => {
        setState(prev => ({ ...prev, ...newState }));
      }
    });
  }

  // Keep options synced without re-instantiating
  useEffect(() => {
    if (runtimeRef.current) {
      Object.assign(runtimeRef.current.options, {
        onMessageUpdate,
        onTraceLog,
        executeTool,
        requestApproval,
        model,
        tools,
        workspacePath,
        authorityLevel,
        maxIterations
      });
    }
  }, [onMessageUpdate, onTraceLog, executeTool, requestApproval, model, tools, workspacePath, authorityLevel, maxIterations]);

  const run = useCallback(async (initialContext, agentMsgIndex) => {
    if (runtimeRef.current) {
      await runtimeRef.current.run(initialContext, agentMsgIndex);
    }
  }, []);

  const cancel = useCallback(() => {
    if (runtimeRef.current) {
      runtimeRef.current.cancel();
    }
  }, []);

  return {
    ...state,
    run,
    cancel
  };
}
