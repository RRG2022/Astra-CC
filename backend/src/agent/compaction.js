const { estimateMessagesTokens, estimateTokens } = require('./tokens');

// Recent turns are what the model is actually working from; compaction always
// leaves this many untouched.
const KEEP_RECENT = 8;

// Tool results evicted in the first pass are replaced by this marker so the
// model knows the call happened and can re-run it if it needs the output again.
const EVICTED = (name) =>
  `[Output of an earlier ${name} call was removed to save context. `
  + `Call ${name} again if you still need it.]`;

/**
 * Rebuilds `messages` to fit `budget` estimated tokens.
 *
 * Two passes, cheapest loss first:
 *   1. Evict the bodies of older tool results — usually most of the bulk, and
 *      the easiest thing for the model to re-fetch.
 *   2. Replace the oldest turns with a digest of what was asked and done.
 *
 * Invariant: a `tool` message is only valid immediately after the assistant
 * turn whose `tool_calls` produced it. Every cut is therefore made at a `user`
 * boundary, so a tool result is never left orphaned from its call — providers
 * reject that outright.
 */
function compactContext(messages, { budget }) {
  const before = estimateMessagesTokens(messages);
  if (before <= budget || messages.length <= KEEP_RECENT + 2) {
    return { messages, compacted: false, before, after: before };
  }

  const system = messages[0]?.role === 'system' ? [messages[0]] : [];
  const bodyStart = system.length;
  const recentStart = Math.max(bodyStart, messages.length - KEEP_RECENT);

  let body = messages.slice(bodyStart, recentStart);
  const recent = messages.slice(recentStart);

  // Pass 1: evict old tool result bodies.
  body = body.map(m =>
    m.role === 'tool' && (m.content || '').length > 200
      ? { ...m, content: EVICTED(m.name || 'tool') }
      : m
  );

  let working = [...system, ...body, ...recent];
  if (estimateMessagesTokens(working) <= budget) {
    const after = estimateMessagesTokens(working);
    return { messages: working, compacted: true, before, after, strategy: 'evicted-tool-results' };
  }

  // Pass 2: digest the oldest turns, cutting only at user boundaries.
  const cuts = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i].role === 'user') cuts.push(i);
  }

  // Largest cut that still fits the budget.
  let chosen = null;
  for (const cut of cuts) {
    if (cut === 0) continue;
    const candidate = [...system, digestOf(body.slice(0, cut)), ...body.slice(cut), ...recent];
    chosen = { cut, candidate };
    if (estimateMessagesTokens(candidate) <= budget) break;
  }

  if (!chosen) {
    // No safe interior cut — digest the whole older section.
    const candidate = [...system, digestOf(body), ...recent];
    const after = estimateMessagesTokens(candidate);
    return { messages: candidate, compacted: true, before, after, strategy: 'digested-all' };
  }

  const after = estimateMessagesTokens(chosen.candidate);
  return { messages: chosen.candidate, compacted: true, before, after, strategy: 'digested-oldest' };
}

/** Condenses a run of turns into one note that preserves the thread of work. */
function digestOf(turns) {
  const asks = [];
  const toolsUsed = new Map();

  for (const m of turns) {
    if (m.role === 'user' && !m._synthetic && m.content) {
      asks.push(String(m.content).replace(/\s+/g, ' ').slice(0, 200));
    }
    for (const call of m.tool_calls || []) {
      const name = call.function?.name;
      if (name) toolsUsed.set(name, (toolsUsed.get(name) || 0) + 1);
    }
  }

  const lines = [`[${turns.length} earlier messages were summarized to save context.]`];
  if (asks.length) {
    lines.push('Earlier requests in this conversation:');
    for (const ask of asks) lines.push(`- ${ask}`);
  }
  if (toolsUsed.size) {
    lines.push(
      'Tools already used: '
      + [...toolsUsed].map(([n, c]) => (c > 1 ? `${n} (x${c})` : n)).join(', ')
      + '.'
    );
  }
  lines.push('Re-read any file whose current contents you need — earlier output is no longer in context.');

  return { role: 'user', content: lines.join('\n'), _synthetic: true, _digest: true };
}

/** Usage snapshot for the client's context meter. */
function usageSnapshot({ messages, tools, contextWindow, reserveForOutput }) {
  const used = estimateMessagesTokens(messages) + estimateTokens(JSON.stringify(tools || []));
  const budget = Math.max(1, contextWindow - reserveForOutput);
  return {
    used,
    budget,
    contextWindow,
    percent: Math.min(100, Math.round((used / budget) * 100))
  };
}

module.exports = { compactContext, digestOf, usageSnapshot, KEEP_RECENT };
