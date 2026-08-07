const test = require('node:test');
const assert = require('node:assert/strict');

const { compactContext, usageSnapshot, KEEP_RECENT } = require('./compaction');
const { estimateMessagesTokens, estimateTokens } = require('./tokens');

const big = (n) => 'x'.repeat(n);

function transcript(turns) {
  const messages = [{ role: 'system', content: 'You are Astra.' }];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: 'user', content: `request number ${i}` });
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: `call_${i}`, function: { name: 'read_file', arguments: '{"filePath":"a.js"}' } }]
    });
    messages.push({ role: 'tool', tool_call_id: `call_${i}`, name: 'read_file', content: big(4000) });
    messages.push({ role: 'assistant', content: `answer number ${i}` });
  }
  return messages;
}

/**
 * A `tool` message is only valid immediately after the assistant turn whose
 * tool_calls produced it. Compaction that breaks this makes every provider
 * reject the request, so it is checked after every strategy.
 */
function assertNoOrphanedToolResults(messages) {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'tool') continue;
    const prior = messages.slice(0, i).reverse()
      .find(m => m.role === 'assistant' || m.role === 'user');
    assert.ok(
      prior && prior.role === 'assistant' && prior.tool_calls?.length,
      `tool result at index ${i} is orphaned from its call`
    );
  }
}

test('a transcript under budget is returned untouched', () => {
  const messages = transcript(1);
  const result = compactContext(messages, { budget: 1000000 });

  assert.equal(result.compacted, false);
  assert.equal(result.messages, messages);
});

test('evicting tool result bodies is tried before dropping turns', () => {
  const messages = transcript(6);
  const before = estimateMessagesTokens(messages);

  const result = compactContext(messages, { budget: Math.floor(before * 0.5) });

  assert.equal(result.compacted, true);
  assert.equal(result.strategy, 'evicted-tool-results');
  // Same shape, smaller payload: no turn was lost.
  assert.equal(result.messages.length, messages.length);
  assert.ok(result.after < result.before);
  assertNoOrphanedToolResults(result.messages);
});

test('an evicted tool result tells the model how to get it back', () => {
  const messages = transcript(6);
  const result = compactContext(messages, { budget: 100 });

  const evicted = result.messages.find(m => m.role === 'tool' && m.content.includes('removed'));
  assert.ok(evicted, 'expected at least one evicted tool result');
  assert.match(evicted.content, /Call read_file again/);
});

test('oldest turns are digested when eviction is not enough', () => {
  const messages = transcript(12);
  const result = compactContext(messages, { budget: 500 });

  assert.equal(result.compacted, true);
  assert.match(result.strategy, /digested/);
  assert.ok(result.messages.length < messages.length);
  assertNoOrphanedToolResults(result.messages);
});

test('the digest preserves what was asked and which tools ran', () => {
  const messages = transcript(12);
  const result = compactContext(messages, { budget: 500 });

  const digest = result.messages.find(m => m._digest);
  assert.ok(digest, 'expected a digest message');
  assert.match(digest.content, /earlier messages were summarized/);
  assert.match(digest.content, /request number 0/);
  assert.match(digest.content, /read_file/);
  assert.match(digest.content, /Re-read any file/);
});

test('the system prompt and the most recent turns always survive', () => {
  const messages = transcript(20);
  const result = compactContext(messages, { budget: 200 });

  assert.equal(result.messages[0].role, 'system');
  assert.match(result.messages[0].content, /You are Astra/);

  const tail = messages.slice(-KEEP_RECENT);
  const resultTail = result.messages.slice(-KEEP_RECENT);
  assert.deepEqual(resultTail.map(m => m.role), tail.map(m => m.role));
  assert.equal(resultTail[resultTail.length - 1].content, tail[tail.length - 1].content);
});

test('an impossible budget still yields a valid, ordered transcript', () => {
  const messages = transcript(20);
  const result = compactContext(messages, { budget: 1 });

  assert.equal(result.messages[0].role, 'system');
  assertNoOrphanedToolResults(result.messages);
  assert.ok(result.after < result.before);
});

test('a transcript with no user boundary to cut at is still handled', () => {
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'the only request' },
    ...Array.from({ length: 12 }, (_, i) => ({ role: 'assistant', content: big(2000) + i }))
  ];

  const result = compactContext(messages, { budget: 100 });
  assert.equal(result.messages[0].role, 'system');
  assertNoOrphanedToolResults(result.messages);
});

test('usageSnapshot reports against the usable window, not the raw one', () => {
  const messages = [{ role: 'user', content: big(3500) }]; // ~1000 tokens
  const usage = usageSnapshot({
    messages, tools: [], contextWindow: 8192, reserveForOutput: 2048
  });

  assert.equal(usage.contextWindow, 8192);
  assert.equal(usage.budget, 8192 - 2048);
  assert.ok(usage.used >= 1000 && usage.used < 1100);
  assert.equal(usage.percent, Math.round((usage.used / usage.budget) * 100));
});

test('tool schemas count against the budget', () => {
  const tools = [{ type: 'function', function: { name: 'read_file', description: big(2000) } }];
  const withTools = usageSnapshot({ messages: [], tools, contextWindow: 8192, reserveForOutput: 0 });
  const without = usageSnapshot({ messages: [], tools: [], contextWindow: 8192, reserveForOutput: 0 });

  assert.ok(withTools.used > without.used + estimateTokens(big(1900)));
});
