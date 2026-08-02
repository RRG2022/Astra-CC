import { useState, useRef, useEffect, useCallback } from 'react';

export function useAgentSession(options) {
  const { onMessageUpdate, onTraceLog, onToolExecuted, model, tools, workspacePath, authorityLevel, maxIterations } = options;

  const [state, setState] = useState({
    isStreaming: false,
    isExecutingTool: false,
    pendingApproval: null,
    stopReason: null,
    currentActionId: null,
    iterationCount: 0
  });

  const [sessionId, setSessionId] = useState(null);
  const eventSourceRef = useRef(null);
  
  // Create an active reference for latest initialContext
  const initialContextRef = useRef([]);

  // Store options in ref so SSE listeners don't become stale closures
  const callbacksRef = useRef({ onMessageUpdate, onTraceLog, onToolExecuted });
  useEffect(() => {
    callbacksRef.current = { onMessageUpdate, onTraceLog, onToolExecuted };
  }, [onMessageUpdate, onTraceLog, onToolExecuted]);

  const initSession = useCallback(async (context) => {
    try {
      const res = await fetch('http://localhost:8789/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          model,
          authorityLevel,
          tools,
          maxIterations,
          initialContext: context
        })
      });
      const data = await res.json();
      setSessionId(data.sessionId);
      return data.sessionId;
    } catch(err) {
      console.error('Failed to init session:', err);
      return null;
    }
  }, [workspacePath, model, authorityLevel, tools, maxIterations]);

  useEffect(() => {
    if (!sessionId) return;
    
    const es = new EventSource(`http://localhost:8789/api/sessions/${sessionId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener('state_change', (e) => {
      const newState = JSON.parse(e.data);
      setState(prev => ({ ...prev, ...newState }));
    });

    es.addEventListener('message_update', (e) => {
      const { index, update } = JSON.parse(e.data);
      callbacksRef.current.onMessageUpdate(index, update);
    });

    es.addEventListener('trace_log', (e) => {
      if (callbacksRef.current.onTraceLog) {
        callbacksRef.current.onTraceLog(JSON.parse(e.data));
      }
    });

    es.addEventListener('approval_requested', (e) => {
      const { call } = JSON.parse(e.data);
      setState(prev => ({ ...prev, pendingApproval: call }));
    });

    es.addEventListener('tool_executed', (e) => {
      const { name, args, result } = JSON.parse(e.data);
      if (callbacksRef.current.onToolExecuted) {
        callbacksRef.current.onToolExecuted(name, args, result);
      }
    });
    
    es.addEventListener('loop_completed', (e) => {
       // Loop finished
       setState(prev => ({ ...prev, isStreaming: false, isExecutingTool: false }));
    });

    return () => {
      es.close();
    };
  }, [sessionId]);

  const run = useCallback(async (initialContext, agentMsgIndex) => {
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = await initSession(initialContext.slice(0, -1)); // all but the latest user msg
    }

    if (!currentSessionId) return;

    const lastMsg = initialContext[initialContext.length - 1];
    await fetch(`http://localhost:8789/api/sessions/${currentSessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: lastMsg })
    });
  }, [sessionId, initSession]);

  const cancel = useCallback(() => {
    // optional: add cancellation endpoint
  }, []);

  const approve = useCallback(async (actionId, editedCall = null) => {
    if (!sessionId) return;
    await fetch(`http://localhost:8789/api/sessions/${sessionId}/approve/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, editedCall })
    });
    setState(prev => ({ ...prev, pendingApproval: null }));
  }, [sessionId]);

  const deny = useCallback(async (actionId) => {
    if (!sessionId) return;
    await fetch(`http://localhost:8789/api/sessions/${sessionId}/approve/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false })
    });
    setState(prev => ({ ...prev, pendingApproval: null }));
  }, [sessionId]);
  
  // Provide backwards compatible `requestApproval` structure if needed by other parts of App
  const requestApproval = useCallback((call) => {
     return new Promise(() => {
        // We never resolve this promise because the backend holds the actual pause.
        // But if the frontend relies on it returning a Promise to pause, this will do it.
     });
  }, []);

  return {
    ...state,
    run,
    cancel,
    approve,
    deny,
    requestApproval
  };
}
