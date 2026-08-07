const crypto = require('crypto');

const defaultMintId = () => `call_${crypto.randomBytes(8).toString('hex')}`;

function scanJsonObjects(text) {
  const found = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        const raw = text.slice(start, i + 1);
        try {
          found.push({ value: JSON.parse(raw), raw });
        } catch { }
        start = -1;
      }
    }
  }
  return found;
}

function normalizeCall(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.function && typeof raw.function === 'object' ? raw.function : raw;
  const name = typeof src.name === 'string' ? src.name : null;
  if (!name) return null;
  let args = src.arguments !== undefined ? src.arguments : src.parameters;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return null; }
  }
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return null;
  const call = { name, arguments: args };
  if (raw.id) call.id = raw.id;
  return call;
}

function callKey(call) {
  return call.name + '::' + JSON.stringify(call.arguments);
}

const FENCE_RE = /```(?:json|tool_call|tool)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

/**
 * Extracts tool calls the model wrote as text rather than as native calls.
 *
 * Two sources, with very different trust levels:
 *
 *   'whole' — the message is nothing but the call, whether bare JSON or a
 *     single fenced block. There is no surrounding prose for it to be
 *     documenting, so this is unambiguous intent and is always honoured.
 *     Several local models (qwen2.5-coder via Ollama among them) ask this way
 *     even when given real schemas; discarding it made the turn silently
 *     do nothing.
 *   'fence' — a fenced block inside a larger message. This is how a model
 *     *documents* a call while explaining itself, so honouring it can turn an
 *     explanation into an action — the original prose-execution bug. Only
 *     trusted when the model was given no schemas and has no other way to ask.
 */
function extractToolCallsFromText(content) {
  const calls = [];
  const spans = [];
  const text = (content || '').trim();
  if (!text) return { calls, spans };

  const consider = (objects, sourceSpan, source) => {
    const normalized = objects.map(o => normalizeCall(o.value)).filter(Boolean);
    if (!normalized.length || normalized.length !== objects.length) return false;
    for (const call of normalized) call.source = source;
    calls.push(...normalized);
    spans.push(sourceSpan);
    return true;
  };

  if (text.startsWith('{') && text.endsWith('}')) {
    const objects = scanJsonObjects(text);
    const covered = objects.reduce((n, o) => n + o.raw.length, 0);
    const gap = text.replace(/\s+/g, '').length - objects.reduce((n, o) => n + o.raw.replace(/\s+/g, '').length, 0);
    if (objects.length && covered > 0 && gap === 0 && consider(objects, text, 'whole')) {
      return { calls, spans };
    }
  }

  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const inner = match[1].trim();
    if (!inner.startsWith('{') || !inner.endsWith('}')) continue;

    // A message that is *nothing but* one fenced call is the model asking for
    // the tool — there is no surrounding explanation for it to be documenting.
    // A fence embedded in prose is the dangerous case: that is how a model
    // shows what it ran while explaining itself.
    const isEntireMessage = match[0].trim() === text;
    consider(scanJsonObjects(inner), match[0], isEntireMessage ? 'whole' : 'fence');
  }

  return { calls, spans };
}

/**
 * Every call leaves here with an `id`. That id is the single handle used for
 * the approval key, the UI card, the tool_call_id in context, and the audit
 * log — minting it in one place is what keeps those four in agreement.
 */
function resolveToolCalls(nativeToolCalls, content, allowFallback = false, mintId = defaultMintId) {
  const seen = new Set();
  const toolCalls = [];

  for (const raw of nativeToolCalls || []) {
    const call = normalizeCall(raw);
    if (!call) continue;
    const key = callKey(call);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!call.id) call.id = mintId();
    toolCalls.push(call);
  }

  const nativeCount = toolCalls.length;
  const { calls, spans } = extractToolCallsFromText(content);

  // A native call always wins; text is only consulted when there wasn't one.
  if (nativeCount === 0) {
    for (const call of calls) {
      // A whole-message call is unambiguous and always honoured. A fenced one
      // may be documentation, so it needs the model to have had no other way
      // to ask — otherwise explaining a call could re-run it.
      if (call.source === 'fence' && !allowFallback) continue;

      const key = callKey(call);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!call.id) call.id = mintId();
      toolCalls.push(call);
    }
  }

  let cleanedContent = content || '';
  if (calls.length) {
    for (const span of spans) cleanedContent = cleanedContent.replace(span, '');
    cleanedContent = cleanedContent.trim();
  }

  return {
    toolCalls,
    cleanedContent,
    usedFallback: allowFallback && nativeCount === 0 && toolCalls.length > 0
  };
}

function toWireToolCalls(toolCalls) {
  return toolCalls.map(c => ({
    ...(c.id ? { id: c.id } : {}),
    function: { name: c.name, arguments: c.arguments }
  }));
}

const CONTINUATION_MESSAGE =
  'The tool results above are the output of the calls you requested. '
  + 'Continue the task using them. Call another tool if more work is needed, '
  + 'otherwise reply to me directly with the final answer.';

function anchorToolsForNextTurn(context) {
  const last = context[context.length - 1];
  if (!last || last.role !== 'tool') return context;
  return [...context, { role: 'user', content: CONTINUATION_MESSAGE, _synthetic: true }];
}

module.exports = {
  defaultMintId,
  scanJsonObjects,
  normalizeCall,
  callKey,
  extractToolCallsFromText,
  resolveToolCalls,
  toWireToolCalls,
  CONTINUATION_MESSAGE,
  anchorToolsForNextTurn
};
