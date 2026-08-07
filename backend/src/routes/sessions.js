const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { AgentRuntime } = require('../agent/AgentRuntime.js');
const { supportsTools } = require('../llm/chat.js');

const activeSessions = new Map();

// An unanswered approval otherwise pins the loop, its HTTP handler, and every
// SSE client attached to the session, forever.
const APPROVAL_TIMEOUT_MS = parseInt(process.env.ASTRA_APPROVAL_TIMEOUT_MS || '600000', 10);

function emit(session, eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of session.clients) {
    try {
      client.write(payload);
    } catch { /* client vanished mid-write; the close handler prunes it */ }
  }
}

// 1. Create session
router.post('/', (req, res) => {
  const sessionId = crypto.randomUUID();
  const { workspacePath, model, authorityLevel, tools, maxIterations, initialContext } = req.body;

  activeSessions.set(sessionId, {
    id: sessionId,
    workspacePath,
    model: model || 'llama3.1',
    authorityLevel: authorityLevel || 'Supervised',
    tools: tools || [],
    maxIterations: maxIterations || 10,
    context: initialContext || [],
    pendingApprovals: new Map(),
    clients: new Set(),
    running: false,
    runtime: null
  });

  res.json({ sessionId });
});

// 2. Connect to SSE stream
router.get('/:id/stream', (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  session.clients.add(res);
  req.on('close', () => session.clients.delete(res));
});

// 3. Send message (starts the loop)
router.post('/:id/message', async (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.running) {
    return res.status(409).json({ error: 'A turn is already in progress for this session' });
  }

  const { message, assistantMessageId } = req.body;
  const messageId = assistantMessageId || crypto.randomUUID();

  if (message) session.context.push(message);
  session.running = true;
  res.json({ success: true, messageId });

  if (!session.runtime) {
    session.runtime = new AgentRuntime({
      model: session.model,
      tools: session.tools,
      workspacePath: session.workspacePath,
      authorityLevel: session.authorityLevel,
      maxIterations: session.maxIterations,
      requestApproval: (call) => new Promise((resolve) => {
        const timer = setTimeout(() => {
          session.pendingApprovals.delete(call.id);
          resolve({ approved: false, reason: 'timeout' });
        }, APPROVAL_TIMEOUT_MS);

        session.pendingApprovals.set(call.id, (decision) => {
          clearTimeout(timer);
          resolve(decision);
        });

        emit(session, 'approval_requested', {
          callId: call.id,
          name: call.name,
          arguments: call.arguments
        });
      }),
      onStateChange: (state) => emit(session, 'state_change', state),
      onMessageUpdate: (id, update) => emit(session, 'message_update', { messageId: id, update }),
      onTraceLog: (log) => emit(session, 'trace_log', log),
      onToolExecuted: (name, args, result, callId) =>
        emit(session, 'tool_executed', { callId, name, args, result })
    });
  }

  // Attach tool schemas only if this model can actually accept them.
  session.runtime.options.tools = (await supportsTools(session.model)) ? session.tools : [];

  emit(session, 'message_start', { messageId });

  try {
    const stopReason = await session.runtime.run(session.context, messageId);
    session.context = session.runtime.context;
    emit(session, 'loop_completed', {
      stopReason,
      error: session.runtime.state.error || null,
      context: session.context
    });
  } catch (error) {
    console.error('Agent loop error:', error);
    emit(session, 'loop_completed', { stopReason: 'error', error: error.message });
  } finally {
    session.running = false;
  }
});

// 4. Approve/deny a tool call, keyed by the canonical callId from the event
router.post('/:id/approve/:callId', (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const resolve = session.pendingApprovals.get(req.params.callId);
  if (!resolve) return res.status(404).json({ error: 'No pending approval with that callId' });

  session.pendingApprovals.delete(req.params.callId);
  resolve({ approved: !!req.body.approved, editedCall: req.body.editedCall || null });

  res.json({ success: true });
});

// 5. Cancel an in-flight turn
router.post('/:id/cancel', (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.runtime) session.runtime.cancel();
  for (const [callId, resolve] of session.pendingApprovals) {
    session.pendingApprovals.delete(callId);
    resolve({ approved: false, reason: 'cancelled' });
  }

  res.json({ success: true });
});

module.exports = router;
