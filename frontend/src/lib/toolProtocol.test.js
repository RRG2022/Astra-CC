import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  scanJsonObjects,
  normalizeCall,
  extractToolCallsFromText,
  resolveToolCalls,
  anchorToolsForNextTurn,
  CONTINUATION_MESSAGE
} from './toolProtocol.js';

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
  assert.deepEqual(calls[0], { name: 'read_file', arguments: { filePath: 'upload.js' } });
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
  const r = resolveToolCalls([], '{"name":"read_file","parameters":{"filePath":"a.js"}}');
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
