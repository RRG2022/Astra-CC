const express = require('express');

/**
 * A scriptable stand-in for the Ollama HTTP API.
 *
 * Each call to /api/chat shifts one scripted response off the queue and streams
 * it back as NDJSON. Responses are arrays of raw chunk objects, so a test can
 * reproduce exactly what a real model emits — including tool-call argument
 * fragments split across chunks, and JSON lines split mid-token across TCP
 * writes (which is what the AgentRuntime carry buffer exists to survive).
 */
function createFakeOllama() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const queue = [];
  const requests = [];
  let models = [{ name: 'test-model', family: 'test' }];
  let showResponse = { capabilities: ['tools'], model_info: { 'general.context_length': 32768 } };

  app.get('/api/tags', (req, res) => res.json({ models }));

  app.post('/api/show', (req, res) => res.json(showResponse));

  app.post('/api/chat', (req, res) => {
    requests.push(req.body);

    const scripted = queue.shift();
    if (!scripted) {
      return res.status(500).json({ error: 'fakeOllama: no scripted response queued' });
    }

    if (scripted.status && scripted.status !== 200) {
      return res.status(scripted.status).send(scripted.body || '');
    }

    const chunks = scripted.chunks || scripted;

    if (!req.body.stream) {
      // Collapse the scripted chunks into a single non-streaming message.
      const message = { role: 'assistant', content: '' };
      for (const c of chunks) {
        if (c.message?.content) message.content += c.message.content;
        if (c.message?.tool_calls) {
          message.tool_calls = [...(message.tool_calls || []), ...c.message.tool_calls];
        }
      }
      return res.json({ message, done: true });
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache'
    });

    const lines = chunks.map(c => JSON.stringify(c) + '\n');
    let payload = lines.join('') + JSON.stringify({ message: { content: '' }, done: true }) + '\n';

    if (scripted.splitAt) {
      // Deliberately break the stream mid-line to exercise the carry buffer.
      res.write(payload.slice(0, scripted.splitAt));
      setTimeout(() => {
        res.write(payload.slice(scripted.splitAt));
        res.end();
      }, 10);
      return;
    }

    res.write(payload);
    res.end();
  });

  let server;

  return {
    async start() {
      await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', resolve);
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async stop() {
      if (server) await new Promise(resolve => server.close(resolve));
    },
    /** Queue one scripted response. `chunks` is an array of raw NDJSON objects. */
    push(chunks, opts = {}) {
      queue.push({ chunks, ...opts });
      return this;
    },
    /** Queue an HTTP error response. */
    pushError(status, body) {
      queue.push({ status, body });
      return this;
    },
    setModels(m) { models = m; },
    setShowResponse(r) { showResponse = r; },
    get requests() { return requests; },
    get pending() { return queue.length; },
    reset() {
      queue.length = 0;
      requests.length = 0;
    }
  };
}

// --- chunk builders -------------------------------------------------------

/** Stream `text` as one content chunk per word, as a real model would. */
function textChunks(text) {
  return text.split(/(?<=\s)/).map(part => ({ message: { role: 'assistant', content: part } }));
}

/** A complete native tool call in a single chunk. */
function toolCallChunk(name, args, id) {
  return {
    message: {
      role: 'assistant',
      tool_calls: [{
        ...(id ? { id } : {}),
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
      }]
    }
  };
}

/**
 * A native tool call whose arguments arrive as fragments across several chunks,
 * which is what AgentRuntime's partialNativeCall accumulator handles.
 */
function fragmentedToolCallChunks(name, args, pieces = 3) {
  const json = typeof args === 'string' ? args : JSON.stringify(args);
  const size = Math.ceil(json.length / pieces);
  const chunks = [{ message: { role: 'assistant', tool_calls: [{ function: { name, arguments: '' } }] } }];
  for (let i = 0; i < json.length; i += size) {
    chunks.push({
      message: { role: 'assistant', tool_calls: [{ function: { arguments: json.slice(i, i + size) } }] }
    });
  }
  return chunks;
}

module.exports = { createFakeOllama, textChunks, toolCallChunk, fragmentedToolCallChunks };
