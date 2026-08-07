const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { streamChat, listModels } = require('../llm/chat');

// Get available models (configured cloud models + local Ollama tags)
router.get('/models', async (req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (error) {
    console.error('Error listing models:', error.message);
    res.json({ models: [] });
  }
});

// Pull model in background
router.post('/models/pull', (req, res) => {
  const { model } = req.body;
  const p = spawn('ollama', ['pull', model], { stdio: 'ignore', detached: true });
  p.on('error', (err) => {
    console.error('Failed to spawn ollama pull:', err.message);
  });
  p.unref();
  res.json({ success: true, message: `Started pulling ${model} in background` });
});

/**
 * Chat completion, streamed as Ollama-style NDJSON.
 *
 * The agent loop does NOT go through here — it calls streamChat() in-process.
 * This route exists for external consumers and for debugging a model directly.
 */
router.post('/chat', async (req, res) => {
  const { model, messages, tools } = req.body;
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const events = streamChat({ model, messages, tools, signal: controller.signal });

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    let pendingCall = null;
    const flushCall = () => {
      if (!pendingCall) return;
      res.write(JSON.stringify({
        message: { role: 'assistant', tool_calls: [pendingCall] }
      }) + '\n');
      pendingCall = null;
    };

    for await (const event of events) {
      if (event.type === 'content') {
        res.write(JSON.stringify({ message: { role: 'assistant', content: event.text } }) + '\n');
      } else if (event.type === 'tool_call_start') {
        flushCall();
        pendingCall = {
          ...(event.id ? { id: event.id } : {}),
          type: 'function',
          function: { name: event.name, arguments: '' }
        };
      } else if (event.type === 'tool_call_delta' && pendingCall) {
        pendingCall.function.arguments += event.argumentsDelta;
      }
    }

    flushCall();
    res.write(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
    res.end();
  } catch (error) {
    console.error('Chat generation failed:', error.message);
    if (!res.headersSent) {
      res.status(error.status || 500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ error: error.message }) + '\n');
      res.end();
    }
  }
});

module.exports = router;
