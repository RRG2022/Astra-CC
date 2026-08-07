const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  scanJsonObjects,
  normalizeCall,
  extractToolCallsFromText,
  resolveToolCalls,
  anchorToolsForNextTurn,
  CONTINUATION_MESSAGE
} = require('./toolProtocol.js');

test('scanJsonObjects ignores braces inside string values', () => {
  const src = '{"name":"write_file","arguments":{"content":"function f() { return 1; }"}}';
  const found = scanJsonObjects(src);
  assert.equal(found.length, 1);
  assert.equal(found[0].value.arguments.content, 'function f() { return 1; }');
});

test('scanJsonObjects handles escaped quotes', () => {
  const src = '{"name":"run_command","arguments":{"command":"echo \\"hi\\""}}';
  assert.equal(scanJsonObjects(src)[0].value.arguments.command, 'echo "hi"');
});

test('scanJsonObjects finds several concatenated objects', () => {
  assert.equal(scanJsonObjects('{"a":1} {"b":2}').length, 2);
});

test('scanJsonObjects drops truncated JSON rather than guessing', () => {
  assert.deepEqual(scanJsonObjects('{"name":"grep_search","arguments":{"query":"upl'), []);
});

test('normalizeCall unwraps the native function envelope', () => {
  const c = normalizeCall({ id: 'call_1', function: { name: 'list_dir', arguments: { directoryPath: '.' } } });
  assert.deepEqual(c, { name: 'list_dir', arguments: { directoryPath: '.' }, id: 'call_1' });
});

test('normalizeCall accepts llama-style `parameters`', () => {
  const c = normalizeCall({ name: 'read_file', parameters: { filePath: 'upload.js' } });
  assert.deepEqual(c, { name: 'read_file', arguments: { filePath: 'upload.js' } });
});

test('normalizeCall parses arguments delivered as a JSON string', () => {
  const c = normalizeCall({ name: 'list_dir', arguments: '{"directoryPath":"src"}' });
  assert.deepEqual(c.arguments, { directoryPath: 'src' });
});

test('normalizeCall defaults missing arguments to an empty object', () => {
  assert.deepEqual(normalizeCall({ name: 'list_dir' }).arguments, {});
});

test('normalizeCall rejects non-calls', () => {
  assert.equal(normalizeCall({ arguments: { a: 1 } }), null);
  assert.equal(normalizeCall('nope'), null);
  assert.equal(normalizeCall({ name: 'x', arguments: [1, 2] }), null);
});

test('extract reads a whole-message tool call', () => {
  const text = '{\n  "name": "list_dir",\n  "arguments": { "directoryPath": "." }\n}';
  const { calls, spans } = extractToolCallsFromText(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'list_dir');
  assert.equal(spans.length, 1);
});

test('extract reads llama `parameters` from a whole message', () => {
  const { calls } = extractToolCallsFromText('{"name": "read_file", "parameters": {"filePath": "upload.js"}}');
  assert.deepEqual(calls[0], {
    name: 'read_file',
    arguments: { filePath: 'upload.js' },
    source: 'whole' // trust level: the whole message was the call
  });
});

test('extract reads a fenced block', () => {
  const text = 'Here you go:\n\n```json\n{"name":"run_command","arguments":{"command":"ls","reason":"list"}}\n```';
  const { calls } = extractToolCallsFromText(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'run_command');
});

test('extract IGNORES a tool call embedded in prose (the original RCE bug)', () => {
  const text = 'I ran the command {"name":"run_command","arguments":{"command":"echo hi"}} for you already.';
  assert.deepEqual(extractToolCallsFromText(text).calls, []);
});

test('extract ignores a fenced block that is ordinary JSON data', () => {
  const text = '```json\n{"version":"1.0.0","private":true}\n```';
  assert.deepEqual(extractToolCallsFromText(text).calls, []);
});

test('resolve prefers native calls and does not also run the text copy', () => {
  const native = [{ function: { name: 'list_dir', arguments: { directoryPath: '.' } } }];
  const text = '{"name":"list_dir","arguments":{"directoryPath":"."}}';
  const r = resolveToolCalls(native, text);
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.usedFallback, false);
});

test('resolve strips protocol JSON from displayed content even when native calls won', () => {
  const native = [{ function: { name: 'list_dir', arguments: { directoryPath: '.' } } }];
  const r = resolveToolCalls(native, '{"name":"list_dir","arguments":{"directoryPath":"."}}');
  assert.equal(r.cleanedContent, '');
});

test('resolve falls back to text when there are no native calls', () => {
  const r = resolveToolCalls([], '{"name":"read_file","parameters":{"filePath":"a.js"}}', true);
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].name, 'read_file');
  assert.equal(r.usedFallback, true);
});

test('resolve de-duplicates identical calls', () => {
  const dup = { function: { name: 'run_command', arguments: { command: 'echo hi' } } };
  assert.equal(resolveToolCalls([dup, dup], '').toolCalls.length, 1);
});

test('resolve leaves ordinary prose untouched', () => {
  const r = resolveToolCalls([], 'Hello! How can I assist you today?');
  assert.deepEqual(r.toolCalls, []);
  assert.equal(r.cleanedContent, 'Hello! How can I assist you today?');
  assert.equal(r.usedFallback, false);
});

test('anchor appends a continuation turn after a tool result', () => {
  const ctx = [{ role: 'user', content: 'go' }, { role: 'tool', content: '{}', name: 'list_dir' }];
  const out = anchorToolsForNextTurn(ctx);
  assert.equal(out.length, 3);
  assert.equal(out[2].role, 'user');
  assert.equal(out[2].content, CONTINUATION_MESSAGE);
});

test('anchor is a no-op when the last turn is not a tool result', () => {
  const ctx = [{ role: 'user', content: 'go' }];
  assert.equal(anchorToolsForNextTurn(ctx), ctx);
});

test('a whole-message tool call is honoured even when native schemas were sent', () => {
  // Observed with qwen2.5-coder via Ollama: it writes the call as the entire
  // message instead of emitting a native tool_call. Ignoring it meant the turn
  // completed having done nothing.
  const content = '{\n  "name": "list_dir",\n  "arguments": {\n    "directoryPath": "."\n  }\n}';
  const { toolCalls, cleanedContent } = resolveToolCalls([], content, false);

  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, 'list_dir');
  assert.deepEqual(toolCalls[0].arguments, { directoryPath: '.' });
  assert.equal(cleanedContent, '');
});

test('a fenced call is ignored when the model had real schemas', () => {
  // A fenced block is also how a model documents a call while explaining
  // itself; honouring it would turn an explanation into an action.
  const content = 'Here is what I ran:\n\n```json\n{"name":"run_command","arguments":{"command":"rm -rf /"}}\n```';
  const { toolCalls } = resolveToolCalls([], content, false);

  assert.equal(toolCalls.length, 0);
});

test('a message that is only a fenced call is honoured, schemas or not', () => {
  // Observed live from qwen2.5-coder: it wraps the call in a ```json fence
  // with nothing else in the message. Discarding that made the turn complete
  // having run nothing at all.
  const content = '```json\n{"name":"list_dir","arguments":{"directoryPath":"."}}\n```';

  assert.equal(resolveToolCalls([], content, true).toolCalls.length, 1);
  assert.equal(resolveToolCalls([], content, false).toolCalls.length, 1);
  assert.equal(resolveToolCalls([], content, false).cleanedContent, '');
});

test('a fenced call surrounded by prose stays gated behind allowFallback', () => {
  // The dangerous shape: the model explaining what it did. Honouring this is
  // what turned an explanation into a second execution.
  const content = 'I ran this for you:\n\n```json\n{"name":"run_command","arguments":{"command":"ls"}}\n```\n\nThat listed the directory.';

  assert.equal(resolveToolCalls([], content, false).toolCalls.length, 0);
  assert.equal(resolveToolCalls([], content, true).toolCalls.length, 1);
});

test('a tool call quoted inside prose is still never executed', () => {
  const content = 'I previously called {"name":"run_command","arguments":{"command":"ls"}} to check.';
  assert.equal(resolveToolCalls([], content, true).toolCalls.length, 0);
  assert.equal(resolveToolCalls([], content, false).toolCalls.length, 0);
});

test('a message of nothing but fenced calls runs all of them', () => {
  // Observed live from qwen2.5-coder asked for two tools in one turn: it wrote
  // two ```json fences back to back and no prose at all. The old rule only
  // recognised a *single* fence filling the message, so each of these looked
  // like documentation and the turn did nothing.
  const content = '```json\n{"name":"update_tasks","arguments":{"tasks":[]}}\n```\n'
    + '```json\n{"name":"list_dir","arguments":{"directoryPath":"."}}\n```';
  const { toolCalls, cleanedContent } = resolveToolCalls([], content, false);

  assert.deepEqual(toolCalls.map(c => c.name), ['update_tasks', 'list_dir']);
  assert.equal(cleanedContent, '');
});

test('prose alongside several fenced calls still gates all of them', () => {
  // One sentence of explanation is enough to make these documentation again.
  const content = 'Here is what I ran:\n\n```json\n{"name":"run_command","arguments":{"command":"ls"}}\n```\n'
    + '```json\n{"name":"run_command","arguments":{"command":"rm -rf /"}}\n```';

  assert.equal(resolveToolCalls([], content, false).toolCalls.length, 0);
});

test('a fenced call beside a fenced blob of data stays gated', () => {
  // The message is doing something other than asking, so the conservative
  // reading wins.
  const content = '```json\n{"name":"read_file","arguments":{"filePath":"a.js"}}\n```\n'
    + '```json\n{"version":"1.0.0","private":true}\n```';

  assert.equal(resolveToolCalls([], content, false).toolCalls.length, 0);
});

test('a refused fenced call stays in the reply instead of vanishing', () => {
  // Observed live from qwen2.5-coder: "Now I will write this to summary.md"
  // followed by a fenced write_file. The call is correctly not run, but it was
  // also being stripped from the content — so the user saw the model announce
  // a write, no tool card, no file, and a turn reported as complete.
  const content = 'Now, I will write this summary to a file called summary.md.\n\n'
    + '```json\n{"name":"write_file","arguments":{"filePath":"summary.md","content":"hi"}}\n```';
  const { toolCalls, cleanedContent } = resolveToolCalls([], content, false);

  assert.equal(toolCalls.length, 0, 'the guard still refuses it');
  assert.match(cleanedContent, /write_file/, 'what was asked for must remain visible');
});
