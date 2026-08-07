import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch, getSseUrl } from './api.js';

const IDLE_STATE = {
  isStreaming: false,
  isExecutingTool: false,
  pendingApproval: null,
  stopReason: null,
  error: null,
  currentActionId: null,
  iterationCount: 0,
  contextUsage: null,
  tasks: [],
  // A sub-agent's transcript never reaches us by design, so this is all there
  // is to show: which one is running and what it has touched.
  subAgent: null
};

/**
 * Drives a server-side agent session. The browser is a viewer: it posts a
 * message, watches an SSE stream, and answers approval requests. All events are
 * keyed by the assistant message id the client itself supplied, so the two
 * sides never have to agree on an array index.
 */
export function useAgentSession(options) {
  const {
    onMessageUpdate, onTraceLog, onToolExecuted,
    model, tools, workspacePath, authorityLevel, maxIterations, persona
  } = options;

  const [state, setState] = useState(IDLE_STATE);
  const [sessionId, setSessionId] = useState(null);

  // Held in a ref so the SSE listeners never close over stale callbacks.
  const callbacksRef = useRef({ onMessageUpdate, onTraceLog, onToolExecuted });
  useEffect(() => {
    callbacksRef.current = { onMessageUpdate, onTraceLog, onToolExecuted };
  }, [onMessageUpdate, onTraceLog, onToolExecuted]);

  const configRef = useRef({});
  configRef.current = { model, tools, workspacePath, authorityLevel, maxIterations, persona };

  const initSession = useCallback(async (context) => {
    const cfg = configRef.current;
    try {
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: cfg.workspacePath,
          model: cfg.model,
          authorityLevel: cfg.authorityLevel,
          maxIterations: cfg.maxIterations,
          persona: cfg.persona,
          initialContext: context
        })
      });
      const data = await res.json();
      setSessionId(data.sessionId);
      return data.sessionId;
    } catch (err) {
      console.error('Failed to init session:', err);
      setState(prev => ({ ...prev, stopReason: 'error', error: 'Could not start a session.' }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(getSseUrl(`/api/sessions/${sessionId}/stream`));

    es.addEventListener('state_change', (e) => {
      const next = JSON.parse(e.data);
      setState(prev => ({ ...prev, ...next }));
    });

    es.addEventListener('message_update', (e) => {
      const { messageId, update } = JSON.parse(e.data);
      callbacksRef.current.onMessageUpdate(messageId, update);
    });

    es.addEventListener('approval_requested', (e) => {
      const { callId, name, arguments: args, suggestedPattern, subject } = JSON.parse(e.data);
      setState(prev => ({
        ...prev,
        pendingApproval: { id: callId, name, arguments: args, suggestedPattern, subject }
      }));
    });

    es.addEventListener('context_usage', (e) => {
      setState(prev => ({ ...prev, contextUsage: JSON.parse(e.data) }));
    });

    es.addEventListener('trace_log', (e) => {
      callbacksRef.current.onTraceLog?.(JSON.parse(e.data));
    });

    es.addEventListener('tool_executed', (e) => {
      const { name, args, result } = JSON.parse(e.data);
      callbacksRef.current.onToolExecuted?.(name, args, result);
    });

    es.addEventListener('tasks_updated', (e) => {
      setState(prev => ({ ...prev, tasks: JSON.parse(e.data).tasks || [] }));
    });

    es.addEventListener('sub_agent', (e) => {
      const event = JSON.parse(e.data);
      setState(prev => {
        if (event.phase === 'started') {
          return { ...prev, subAgent: { callId: event.callId, task: event.task, toolsUsed: [] } };
        }
        if (prev.subAgent?.callId !== event.callId) return prev;
        if (event.phase === 'tool') {
          return { ...prev, subAgent: { ...prev.subAgent, toolsUsed: [...prev.subAgent.toolsUsed, event.name] } };
        }
        return { ...prev, subAgent: null }; // finished
      });
    });

    es.addEventListener('loop_completed', (e) => {
      const { stopReason, error } = JSON.parse(e.data);
      setState(prev => ({
        ...prev,
        isStreaming: false,
        isExecutingTool: false,
        pendingApproval: null,
        subAgent: null,
        stopReason,
        error: error || null
      }));
    });

    es.onerror = () => {
      // EventSource retries on its own; surface only that the stream dropped.
      setState(prev => (prev.isStreaming || prev.isExecutingTool)
        ? { ...prev, error: 'Lost connection to the agent stream.' }
        : prev);
    };

    return () => es.close();
  }, [sessionId]);

  /** Sends one user turn. `messageId` addresses the assistant reply. */
  const run = useCallback(async (context, messageId) => {
    let id = sessionId;
    if (!id) {
      // Everything but the new user turn becomes the session's opening context.
      id = await initSession(context.slice(0, -1));
      if (!id) return;
    }

    setState(prev => ({ ...prev, stopReason: null, error: null }));

    const res = await apiFetch(`/api/sessions/${id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: context[context.length - 1], assistantMessageId: messageId })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setState(prev => ({ ...prev, stopReason: 'error', error: body.error || 'Failed to send message.' }));
    }
  }, [sessionId, initSession]);

  const cancel = useCallback(async () => {
    if (!sessionId) return;
    await apiFetch(`/api/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
  }, [sessionId]);

  const decide = useCallback(async (callId, approved, { editedCall = null, rememberRule = null } = {}) => {
    if (!sessionId || !callId) return;
    setState(prev => ({ ...prev, pendingApproval: null }));
    await apiFetch(`/api/sessions/${sessionId}/approve/${callId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, editedCall, rememberRule })
    });
  }, [sessionId]);

  const approve = useCallback((callId, opts) => decide(callId, true, opts), [decide]);
  const deny = useCallback((callId, opts) => decide(callId, false, opts), [decide]);

  return { ...state, run, cancel, approve, deny };
}
