/**
 * Token accounting for context budgeting.
 *
 * These are estimates, not exact counts: Astra talks to several providers with
 * different tokenizers and has no offline tokenizer for arbitrary local models.
 * The budget is therefore deliberately conservative — it is used to decide when
 * to compact, and compacting slightly early is much cheaper than discovering
 * the window overflowed and the task fell out of it.
 */

// Prose runs ~4 chars/token; code and JSON are denser. Tool-heavy transcripts
// are mostly the latter, so we assume the denser figure.
const CHARS_PER_TOKEN = 3.5;

// Every message carries role/formatting overhead on the wire.
const PER_MESSAGE_OVERHEAD = 4;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

function estimateMessageTokens(message) {
  let total = PER_MESSAGE_OVERHEAD + estimateTokens(message.content || '');

  for (const call of message.tool_calls || []) {
    total += estimateTokens(call.function?.name);
    const args = call.function?.arguments;
    total += estimateTokens(typeof args === 'string' ? args : JSON.stringify(args || {}));
  }

  if (message.name) total += estimateTokens(message.name);
  return total;
}

function estimateMessagesTokens(messages) {
  return (messages || []).reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/** Tool schemas are re-sent on every request and are far from free. */
function estimateToolsTokens(tools) {
  if (!tools || !tools.length) return 0;
  return estimateTokens(JSON.stringify(tools));
}

module.exports = {
  CHARS_PER_TOKEN,
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateToolsTokens
};
