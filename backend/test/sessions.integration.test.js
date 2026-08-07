const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { createFakeOllama, textChunks, toolCallChunk, fragmentedToolCallChunks } = require('./fakeOllama');
const { createWorkspace, openSse } = require('./helpers');

const TOKEN = 'test-token-' + crypto.randomBytes(8).toString('hex');

// Minimal tool schemas — the loop only needs names to route on.
const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] } } },
  { type: 'function', function: { name: 'write_file', description: 'write', parameters: { type: 'object', properties: { filePath: { type: 'string' }, content: { type: 'string' } }, required: ['filePath', 'content'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'list', parameters: { type: 'object', properties: { directoryPath: { type: 'string' } }, required: ['directoryPath'] } } }
];

let fake, server, baseUrl;
const openStreams = [];

test.before(async () => {
  fake = createFakeOllama();
  process.env.ASTRA_OLLAMA_URL = await fake.start();

  // Required after the env var is set, so the app picks up the fake.
  const { createApp } = require('../src/app');
  const { app } = createApp({ token: TOKEN, requestLogging: false, patchConsole: false });

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
  if (fake) await fake.stop();
});

test.beforeEach(() => fake.reset());

// Close SSE handles even when a test fails before reaching its own close(),
// otherwise the open connections keep the server alive and the run hangs.
test.afterEach(() => {
  while (openStreams.length) openStreams.pop().close();
});

// --- request helpers ------------------------------------------------------

async function api(pathname, { method = 'POST', body } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function startSession(workspacePath, overrides = {}) {
  const { body } = await api('/api/sessions', {
    body: {
      workspacePath,
      model: 'test-model',
      authorityLevel: 'Supervised',
      tools: TOOLS,
      maxIterations: 5,
      initialContext: [{ role: 'system', content: 'You are a test agent.' }],
      ...overrides
    }
  });
  assert.ok(body.sessionId, 'session creation must return a sessionId');
  const sse = await openSse(`${baseUrl}/api/sessions/${body.sessionId}/stream?token=${TOKEN}`);
  openStreams.push(sse);
  return { sessionId: body.sessionId, sse };
}

async function send(sessionId, content) {
  const assistantMessageId = crypto.randomUUID();
  await api(`/api/sessions/${sessionId}/message`, {
    body: { message: { role: 'user', content }, assistantMessageId }
  });
  return assistantMessageId;
}

/** Concatenate all streamed content deltas for a given assistant message. */
function assembledContent(sse, messageId) {
  return sse.of('message_update')
    .filter(e => e.data.messageId === messageId)
    .reduce((acc, e) => {
      const u = e.data.update;
      if (u.content_replace !== undefined) return u.content_replace;
      if (u.content !== undefined) return acc + u.content;
      return acc;
    }, '');
}

// --- tests ----------------------------------------------------------------

test('plain chat turn streams content and completes', async () => {
  const ws = createWorkspace();
  fake.push(textChunks('Hello there, nothing to do here.'));

  const { sessionId, sse } = await startSession(ws);
  const messageId = await send(sessionId, 'hi');

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(done.data.stopReason, 'complete');
  assert.equal(assembledContent(sse, messageId), 'Hello there, nothing to do here.');

  const start = sse.of('message_start')[0];
  assert.equal(start.data.messageId, messageId, 'events must be keyed by the id the client supplied');

  sse.close();
});

test('carry buffer survives a JSON line split across TCP writes', async () => {
  const ws = createWorkspace();
  const text = 'The quick brown fox jumps over the lazy dog.';
  fake.push(textChunks(text), { splitAt: 37 });

  const { sessionId, sse } = await startSession(ws);
  const messageId = await send(sessionId, 'say it');

  await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(assembledContent(sse, messageId), text, 'no content may be lost at the chunk boundary');

  sse.close();
});

test('executes an auto-approved tool and feeds the result back to the model', async () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'alpha.txt'), 'a');
  fs.writeFileSync(path.join(ws, 'beta.txt'), 'b');

  fake.push([toolCallChunk('list_dir', { directoryPath: '.' })]);
  fake.push(textChunks('There are two files.'));

  const { sessionId, sse } = await startSession(ws);
  const messageId = await send(sessionId, 'what is in this folder?');

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(done.data.stopReason, 'complete');

  const executed = sse.of('tool_executed');
  assert.equal(executed.length, 1);
  assert.equal(executed[0].data.name, 'list_dir');
  assert.equal(executed[0].data.result.success, true, 'the tool must actually succeed, not 401');
  assert.deepEqual(
    executed[0].data.result.items.map(i => i.name).sort(),
    ['alpha.txt', 'beta.txt']
  );

  // The model must have been called a second time, with the tool result in context.
  assert.equal(fake.requests.length, 2);
  const secondTurn = fake.requests[1].messages;
  const toolMsg = secondTurn.find(m => m.role === 'tool');
  assert.ok(toolMsg, 'tool result must be appended to context');
  assert.ok(toolMsg.tool_call_id, 'tool results must carry tool_call_id for correlation');

  assert.equal(assembledContent(sse, messageId), 'There are two files.');
  sse.close();
});

test('reassembles a tool call whose arguments arrive as fragments', async () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'notes.md'), 'hello from disk');

  fake.push(fragmentedToolCallChunks('read_file', { filePath: 'notes.md' }, 4));
  fake.push(textChunks('Got it.'));

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'read notes.md');

  await sse.waitFor('loop_completed', { label: 'loop_completed' });

  const executed = sse.of('tool_executed');
  assert.equal(executed.length, 1);
  assert.equal(executed[0].data.args.filePath, 'notes.md');
  assert.equal(executed[0].data.result.content, 'hello from disk');

  sse.close();
});

test('write_file pauses for approval and proceeds once approved', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'out.txt', content: 'written by agent' })]);
  fake.push(textChunks('Done.'));

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'create out.txt');

  const ask = await sse.waitFor('approval_requested', { label: 'approval_requested' });
  assert.ok(ask.data.callId, 'approval event must carry the id the client approves against');
  assert.equal(ask.data.name, 'write_file');
  assert.equal(
    fs.existsSync(path.join(ws, 'out.txt')), false,
    'the file must not exist while approval is pending'
  );

  const approve = await api(`/api/sessions/${sessionId}/approve/${ask.data.callId}`, {
    body: { approved: true }
  });
  assert.equal(approve.status, 200, 'the callId from the event must be a valid approval key');

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(done.data.stopReason, 'complete');
  assert.equal(fs.readFileSync(path.join(ws, 'out.txt'), 'utf8'), 'written by agent');

  sse.close();
});

test('denial stops the loop and leaves the workspace untouched', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'nope.txt', content: 'should not land' })]);

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'create nope.txt');

  const ask = await sse.waitFor('approval_requested', { label: 'approval_requested' });
  await api(`/api/sessions/${sessionId}/approve/${ask.data.callId}`, { body: { approved: false } });

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(done.data.stopReason, 'denied');
  assert.equal(fs.existsSync(path.join(ws, 'nope.txt')), false);
  assert.equal(fake.requests.length, 1, 'a denial must not trigger another model round-trip');

  sse.close();
});

test('an upstream model failure reports error, never complete', async () => {
  const ws = createWorkspace();
  fake.pushError(500, 'upstream exploded');

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'hi');

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(
    done.data.stopReason, 'error',
    'a failed model call must not be reported as a completed turn'
  );
  assert.ok(done.data.error, 'the failure reason must be surfaced to the client');

  sse.close();
});

test('a looping model is stopped at maxIterations', async () => {
  const ws = createWorkspace();
  // The model never stops asking for tools; the runtime must cap it.
  for (let i = 0; i < 10; i++) {
    fake.push([toolCallChunk('list_dir', { directoryPath: '.' })]);
  }

  const { sessionId, sse } = await startSession(ws, { maxIterations: 3 });
  await send(sessionId, 'loop forever');

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(done.data.stopReason, 'max_iterations');
  assert.equal(fake.requests.length, 3, 'must stop after exactly maxIterations model calls');

  sse.close();
});

test('cancel stops a turn waiting on approval', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'never.txt', content: 'x' })]);

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'write a file');

  await sse.waitFor('approval_requested', { label: 'approval_requested' });
  const cancelled = await api(`/api/sessions/${sessionId}/cancel`, { body: {} });
  assert.equal(cancelled.status, 200);

  const done = await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.ok(
    ['cancelled', 'denied'].includes(done.data.stopReason),
    `expected a terminal stop reason, got ${done.data.stopReason}`
  );
  assert.equal(fs.existsSync(path.join(ws, 'never.txt')), false);

  sse.close();
});

test('a second concurrent turn is rejected rather than racing', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'slow.txt', content: 'x' })]);

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'write a file');
  await sse.waitFor('approval_requested', { label: 'approval_requested' });

  const second = await api(`/api/sessions/${sessionId}/message`, {
    body: { message: { role: 'user', content: 'and another' }, assistantMessageId: crypto.randomUUID() }
  });
  assert.equal(second.status, 409, 'a turn is already in progress');

  await api(`/api/sessions/${sessionId}/cancel`, { body: {} });
  await sse.waitFor('loop_completed', { label: 'loop_completed' });
  sse.close();
});

test('an edited call is executed in place of the original', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'edited.txt', content: 'original' })]);
  fake.push(textChunks('Done.'));

  const { sessionId, sse } = await startSession(ws);
  await send(sessionId, 'write a file');

  const ask = await sse.waitFor('approval_requested', { label: 'approval_requested' });
  await api(`/api/sessions/${sessionId}/approve/${ask.data.callId}`, {
    body: {
      approved: true,
      editedCall: { name: 'write_file', arguments: { filePath: 'edited.txt', content: 'user edited' } }
    }
  });

  await sse.waitFor('loop_completed', { label: 'loop_completed' });
  assert.equal(fs.readFileSync(path.join(ws, 'edited.txt'), 'utf8'), 'user edited');

  sse.close();
});
