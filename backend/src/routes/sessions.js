const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { AgentRuntime } = require('../agent/AgentRuntime.js');
const { supportsTools } = require('../llm/chat.js');
const { buildSystemPrompt } = require('../agent/systemPrompt.js');
const { filterToolsForPersona, DEFAULT_PERSONA, PERSONAS } = require('../agent/personas.js');
const sessionStore = require('../agent/sessionStore.js');

const activeSessions = new Map();

// How long an idle session stays resident. Records live on disk, so eviction
// costs nothing but a reload — without it the Map grew for the process's life.
const IDLE_EVICT_MS = parseInt(process.env.ASTRA_SESSION_IDLE_MS || '3600000', 10);
const SWEEP_INTERVAL_MS = 60000;

function touch(session) {
  session.lastActiveAt = Date.now();
  return session;
}

/** Rebuilds the in-memory shape around a persisted record. */
function hydrate(record) {
  return touch({
    ...record,
    pendingApprovals: new Map(),
    clients: new Set(),
    running: false,
    runtime: null
  });
}

/** Resident if possible, from disk otherwise. */
function getSession(id, workspacePath) {
  const live = activeSessions.get(id);
  if (live) return touch(live);

  const record = sessionStore.load(id, workspacePath);
  if (!record) return null;

  const session = hydrate(record);
  activeSessions.set(id, session);
  return session;
}

const sweeper = setInterval(() => {
  const cutoff = Date.now() - IDLE_EVICT_MS;
  for (const [id, session] of activeSessions) {
    const idle = (session.lastActiveAt || 0) < cutoff;
    if (!idle || session.running || session.clients.size > 0) continue;
    sessionStore.save(session);
    activeSessions.delete(id);
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

// Personas the client can offer in its picker. Prompts stay server-side.
router.get('/personas', (req, res) => {
  res.json({
    personas: Object.entries(PERSONAS).map(([key, p]) => ({
      key, name: p.name, tools: p.tools
    })),
    defaultPersona: DEFAULT_PERSONA
  });
});

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
  const {
    workspacePath, model, authorityLevel, tools, maxIterations, initialContext, persona
  } = req.body;

  // The system prompt is assembled here, not by the client: it carries the
  // persona's real limits and the workspace's own AGENTS.md rules, and neither
  // should be droppable from the browser.
  const { prompt, projectFile } = buildSystemPrompt({ persona, workspacePath });

  // Any client-supplied system turn is replaced by ours.
  const history = (initialContext || []).filter(m => m.role !== 'system');

  const session = touch({
    id: sessionId,
    createdAt: Date.now(),
    workspacePath,
    persona: persona || DEFAULT_PERSONA,
    model: model || 'llama3.1',
    authorityLevel: authorityLevel || 'Supervised',
    tools: filterToolsForPersona(tools, persona),
    maxIterations: maxIterations || 10,
    context: [{ role: 'system', content: prompt }, ...history],
    pendingApprovals: new Map(),
    clients: new Set(),
    running: false,
    runtime: null
  });

  activeSessions.set(sessionId, session);
  sessionStore.save(session);

  res.json({ sessionId, projectFile });
});

// 1b. List persisted sessions for a workspace
router.get('/', (req, res) => {
  res.json({ sessions: sessionStore.list(req.query.workspacePath) });
});

// 1c. Resume: fetch a session's stored state
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id, req.query.workspacePath);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    id: session.id,
    workspacePath: session.workspacePath,
    persona: session.persona,
    model: session.model,
    authorityLevel: session.authorityLevel,
    running: session.running,
    context: session.context,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  });
});

// 1d. Delete a session and its record
router.delete('/:id', (req, res) => {
  const live = activeSessions.get(req.params.id);
  if (live?.running) {
    return res.status(409).json({ error: 'Cannot delete a session with a turn in progress' });
  }

  const workspacePath = req.query.workspacePath || live?.workspacePath;
  for (const client of live?.clients || []) {
    try { client.end(); } catch { /* already gone */ }
  }
  activeSessions.delete(req.params.id);

  const removed = sessionStore.remove(req.params.id, workspacePath);
  if (!removed && !live) return res.status(404).json({ error: 'Session not found' });

  res.json({ success: true });
});

// 2. Connect to SSE stream
router.get('/:id/stream', (req, res) => {
  const session = getSession(req.params.id, req.query.workspacePath);
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
  const session = getSession(req.params.id, req.body.workspacePath);
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
        emit(session, 'tool_executed', { callId, name, args, result }),
      onContextUsage: (usage) => emit(session, 'context_usage', usage)
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
    touch(session);
    sessionStore.save(session);
  }
});

// 4. Approve/deny a tool call, keyed by the canonical callId from the event
router.post('/:id/approve/:callId', (req, res) => {
  const session = activeSessions.get(req.params.id); // must be the live turn
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const resolve = session.pendingApprovals.get(req.params.callId);
  if (!resolve) return res.status(404).json({ error: 'No pending approval with that callId' });

  session.pendingApprovals.delete(req.params.callId);
  resolve({ approved: !!req.body.approved, editedCall: req.body.editedCall || null });

  res.json({ success: true });
});

// 5. Cancel an in-flight turn
router.post('/:id/cancel', (req, res) => {
  const session = activeSessions.get(req.params.id); // must be the live turn
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.runtime) session.runtime.cancel();
  for (const [callId, resolve] of session.pendingApprovals) {
    session.pendingApprovals.delete(callId);
    resolve({ approved: false, reason: 'cancelled' });
  }

  res.json({ success: true });
});

module.exports = router;
