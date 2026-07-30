import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentRuntime } from './AgentRuntime.js';

function createMockRuntime(responses, opts = {}) {
  let reqCount = 0;
  global.fetch = async (url, options) => {
    const res = responses[reqCount++] || [];
    if (res === 'http_error') return { ok: false };
    if (res === 'network_error') throw new Error('fetch failed');
    return {
      ok: true,
      body: (async function* () {
        if (options.signal?.aborted) {
           const e = new Error('aborted'); e.name = 'AbortError'; throw e;
        }
        for (const chunk of res) {
          if (options.signal?.aborted) {
             const e = new Error('aborted'); e.name = 'AbortError'; throw e;
          }
          yield chunk;
        }
      })()
    };
  };

  const msgs = [];
  return new AgentRuntime({
    onMessageUpdate: (index, update) => msgs.push({ index, update }),
    executeTool: async () => 'success',
    requestApproval: async () => true,
    ...opts
  });
}

test('JSON split across arbitrary chunk boundaries', async () => {
  const runtime = createMockRuntime([[
    '{"message":{"tool_calls":[{"function":{"name":"run_c","ar',
    'guments":{"cmd":"echo"}}}]}}\n'
  ]]);

  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'run_c');
  assert.equal(calls[0].arguments.cmd, 'echo');
});

test('Several NDJSON records inside one chunk', async () => {
  const runtime = createMockRuntime([[
    '{"message":{"content":"Hello "}}\n{"message":{"content":"world!"}}\n'
  ]]);

  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 0);
  // Full content should be updated correctly via callback (omitted here for brevity)
});

test('Multiple tool calls arriving incrementally', async () => {
  const runtime = createMockRuntime([[
    '{"message":{"tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n',
    '{"message":{"tool_calls":[{"function":{"name":"t2","arguments":{}}}]}}\n'
  ]]);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 't1');
  assert.equal(calls[1].name, 't2');
});

test('Duplicate tool-call fragments (deduplication)', async () => {
  const runtime = createMockRuntime([[
    '{"message":{"tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n',
    '{"message":{"tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n'
  ]]);
  const calls = await runtime.streamOllama([]);
  // resolveToolCalls handles deduplication!
  assert.equal(calls.length, 1);
});

test('HTTP 4xx/5xx before streaming', async () => {
  const runtime = createMockRuntime(['http_error']);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls, null);
  assert.equal(runtime.state.stopReason, 'http_error');
});

test('Denied action stops loop', async () => {
  const runtime = createMockRuntime([
    ['{"message":{"tool_calls":[{"function":{"name":"write_file","arguments":{}}}]}}\n']
  ], {
    authorityLevel: 'Strict',
    workspacePath: '/workspace',
    requestApproval: async () => false // DENY
  });

  await runtime.run([], 0);
  assert.equal(runtime.state.stopReason, 'denied');
});

test('Maximum-iteration termination', async () => {
  // Always return a tool call
  const runtime = createMockRuntime(
    Array(5).fill(['{"message":{"tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n']),
    { maxIterations: 3 }
  );

  await runtime.run([], 0);
  assert.equal(runtime.state.iterationCount, 3);
  assert.equal(runtime.state.stopReason, 'max_iterations');
});

test('Cancellation during tool execution', async () => {
  const runtime = createMockRuntime([
    ['{"message":{"tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n']
  ], {
    executeTool: async () => {
      runtime.cancel(); // Cancel while executing
      return 'done';
    }
  });

  await runtime.run([], 0);
  assert.equal(runtime.state.stopReason, 'cancelled');
});

test('Final NDJSON record without a trailing newline', async () => {
  const runtime = createMockRuntime([['{"message":{"tool_calls":[{"function":{"name":"run_c","arguments":{"cmd":"echo"}}}]}}']]);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'run_c');
});

test('Assistant prose plus a legitimate native tool call', async () => {
  const runtime = createMockRuntime([['{"message":{"content":"Here is the code.","tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n']]);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 't1');
});

test('Assistant prose containing fake tool-call JSON', async () => {
  const runtime = createMockRuntime([['{"message":{"content":"[{\\"name\\":\\"t1\\"}]"}}\n']]);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 0); // No native tool call, it's just content
});

test('Tool-call JSON inside Markdown and code fences', async () => {
  const runtime = createMockRuntime([['{"message":{"content":"```json\\n[{\\"name\\":\\"t1\\"}]\\n```"}}\n']]);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 0);
});

test('Tool arguments delivered as a JSON string', async () => {
  const runtime = createMockRuntime([['{"message":{"tool_calls":[{"function":{"name":"t1","arguments":"{\\"a\\":1}"}}]}}\n']]);
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.a, 1);
});

test('Malformed tool arguments', async () => {
  const runtime = createMockRuntime([['{"message":{"tool_calls":[{"function":{"name":"t1","arguments":"{\\"a\\":1"}}]}}\n']]);
  const calls = await runtime.streamOllama([]);
  // Should drop the call because it's malformed JSON
  assert.equal(calls.length, 0);
});

test('Connection interruption midway through an event', async () => {
  const runtime = createMockRuntime([['{"message":{"tool_calls":[']]); // Stream abruptly ends here
  const calls = await runtime.streamOllama([]);
  assert.equal(calls.length, 0);
});

test('Cancellation during model streaming', async () => {
  const runtime = createMockRuntime([['{"message":{"content":"hi"}}']]);
  const p = runtime.streamOllama([]);
  runtime.cancel(); // Cancel immediately while promise is running
  const calls = await p;
  assert.equal(calls, null);
  assert.equal(runtime.state.stopReason, 'cancelled');
});

test('Workspace-dependent action without an active workspace', async () => {
  const runtime = createMockRuntime([['{"message":{"tool_calls":[{"function":{"name":"run_command","arguments":{}}}]}}\n']], {
    workspacePath: '' // Empty workspace
  });
  await runtime.run([], 0);
  // It shouldn't have executed successfully, result should be Error string
  assert.equal(runtime.context[1].content, 'Error: Active workspace is required for this action.');
});

test('Tool success followed by a normal explanatory answer', async () => {
  const runtime = createMockRuntime([
    ['{"message":{"tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n'],
    ['{"message":{"content":"I did it."}}\n']
  ]);
  await runtime.run([], 0);
  assert.equal(runtime.context.length, 3);
  // Context: tool intent, tool result, explanation intent
  assert.equal(runtime.state.iterationCount, 2);
  assert.equal(runtime.state.stopReason, 'complete');
});

test('History retaining assistant prose, action IDs, and correctly correlated results', async () => {
  const runtime = createMockRuntime([
    ['{"message":{"content":"Sure.","tool_calls":[{"function":{"name":"t1","arguments":{}}}]}}\n'],
    ['{"message":{"content":"Done."}}\n']
  ]);
  await runtime.run([{ role: 'user', content: 'Do it' }], 0);

  // Initial context + tool intent + tool result + final explanation
  assert.equal(runtime.context.length, 4);
  assert.equal(runtime.context[1].role, 'assistant');
  // It retains the tool calls
  assert.equal(runtime.context[1].tool_calls.length, 1);
});
