const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { AgentRuntime } = require('../agent/AgentRuntime.js');

const activeSessions = new Map();

async function executeToolOnBackend(toolCall, workspacePath) {
  const name = toolCall.function ? toolCall.function.name : toolCall.name;
  const argsObj = toolCall.function ? toolCall.function.arguments : toolCall.arguments;
  let parsedArgs = argsObj;
  if (typeof argsObj === 'string') {
    try { parsedArgs = JSON.parse(argsObj); } catch(e) {}
  }
  
  try {
    const payload = { ...parsedArgs, workspacePath };
    let url = '';
    if (name === 'read_file') url = 'http://localhost:8789/api/tools/fs/read';
    else if (name === 'write_file') url = 'http://localhost:8789/api/tools/fs/write';
    else if (name === 'edit_file') url = 'http://localhost:8789/api/tools/fs/edit';
    else if (name === 'list_dir') url = 'http://localhost:8789/api/tools/fs/list';
    else if (name === 'grep_search') url = 'http://localhost:8789/api/tools/fs/grep';
    else if (name === 'run_command') url = 'http://localhost:8789/api/tools/terminal/run';
    else return JSON.stringify({ error: 'Unknown tool' });

    const res = await axios.post(url, payload);
    return JSON.stringify(res.data);
  } catch(err) {
    return JSON.stringify({ error: err.response?.data?.error || err.message });
  }
}

// 1. Create session
router.post('/', (req, res) => {
  const sessionId = crypto.randomUUID();
  const { workspacePath, model, authorityLevel, tools, maxIterations, initialContext } = req.body;
  
  const session = {
    id: sessionId,
    workspacePath,
    model: model || 'llama3.1',
    authorityLevel: authorityLevel || 'Supervised',
    tools: tools || [],
    maxIterations: maxIterations || 10,
    context: initialContext || [],
    pendingApprovals: new Map(),
    clients: new Set(),
    agentMsgIndex: (initialContext || []).length
  };
  
  activeSessions.set(sessionId, session);
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

  const client = { res };
  session.clients.add(client);

  req.on('close', () => {
    session.clients.delete(client);
  });
});

function emitToSession(session, eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of session.clients) {
    client.res.write(payload);
  }
}

// 3. Send message (starts/resumes the loop)
router.post('/:id/message', async (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { message } = req.body;
  if (message) {
    session.context.push(message);
  }

  // Acknowledge receipt
  res.json({ success: true });

  // Start the agent loop in background
  if (!session.runtime) {
    session.runtime = new AgentRuntime({
      model: session.model,
      tools: session.tools,
      workspacePath: session.workspacePath,
      authorityLevel: session.authorityLevel,
      maxIterations: session.maxIterations,
      executeTool: async (call) => await executeToolOnBackend(call, session.workspacePath),
      requestApproval: async (call) => {
        return new Promise((resolve) => {
          const callId = call.id;
          session.pendingApprovals.set(callId, resolve);
          emitToSession(session, 'approval_requested', { call });
        });
      },
      onStateChange: (state) => {
        emitToSession(session, 'state_change', state);
      },
      onMessageUpdate: (idx, update) => {
        emitToSession(session, 'message_update', { index: idx, update });
      },
      onTraceLog: (log) => {
        emitToSession(session, 'trace_log', log);
      },
      onToolExecuted: (name, args, result) => {
        emitToSession(session, 'tool_executed', { name, args, result });
      }
    });
  }

  // The agentMsgIndex is where the assistant's new response will land
  const agentMsgIndex = session.context.length;
  // Initialize an empty assistant message placeholder in context
  session.context.push({ role: 'assistant', content: '' });

  emitToSession(session, 'message_start', { index: agentMsgIndex });

  try {
    await session.runtime.run(session.context.slice(0, -1), agentMsgIndex);
    // After run, session.runtime.context contains the mutated context with tool results
    session.context = session.runtime.context;
    emitToSession(session, 'loop_completed', { context: session.context });
  } catch (error) {
    console.error('Agent loop error:', error);
    emitToSession(session, 'error', { message: error.message });
  }
});

// 4. Approve/Deny tool
router.post('/:id/approve/:actionId', (req, res) => {
  const session = activeSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const resolve = session.pendingApprovals.get(req.params.actionId);
  if (!resolve) return res.status(404).json({ error: 'Pending approval not found' });

  const { approved, editedCall } = req.body;
  resolve({ approved, editedCall });
  session.pendingApprovals.delete(req.params.actionId);

  res.json({ success: true });
});

module.exports = router;
