/**
 * Tool-call protocol adapter.
 *
 * Local models disagree about how a tool call is expressed, and the same model
 * disagrees with itself depending on where it is in a conversation. This module
 * is the single place that reconciles those differences, so the agent loop only
 * ever deals with one normalised shape.
 *
 * Observed behaviour that motivates each piece (all verified against Ollama
 * 0.30.7 through this project's backend):
 *
 *  - llama3.1 returns proper native `tool_calls` on the first turn.
 *  - After a tool result is appended, llama3.1's chat template stops rendering
 *    the function signatures entirely: the schemas are only emitted when the
 *    LAST message is a user turn (`{{- if and $.Tools $last }}`). The model then
 *    has no tool definitions and falls back to emitting the assistant-side
 *    format as plain text.
 *  - That fallback text uses `parameters`, not `arguments`, because that is what
 *    llama's own template demonstrates.
 *  - qwen2.5-coder never emits native tool calls at all; every call arrives as
 *    text, usually as the whole message, sometimes inside a ```json fence.
 *  - Ollama sometimes hands back `arguments` as a JSON string rather than an
 *    object.
 */

/** Tool calls are only read from text when the text is *entirely* a tool call,
 * or when it sits alone inside a fenced block. Scanning free prose for JSON is
 * what caused Astra to execute the model's own explanations of its commands. */

/**
 * Scan a string for top-level JSON objects, respecting string literals and
 * escapes so that braces inside values do not terminate an object early.
 * Returns the objects with the exact source span each came from.
 */
export function scanJsonObjects(text) {
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
        } catch {
          // Not valid JSON (truncated generation, trailing commas) — ignore.
        }
        start = -1;
      }
    }
  }

  return found;
}

/**
 * Coerce one raw tool call from any known dialect into { name, arguments }.
 * Returns null if it is not recognisably a tool call.
 */
export function normalizeCall(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // Native Ollama shape nests the payload under `function`.
  const src = raw.function && typeof raw.function === 'object' ? raw.function : raw;

  const name = typeof src.name === 'string' ? src.name : null;
  if (!name) return null;

  // llama-family text fallback uses `parameters`; everything else uses
  // `arguments`. Treat them as the same field.
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

/** Stable key for de-duplicating calls within a turn. */
export function callKey(call) {
  return call.name + '::' + JSON.stringify(call.arguments);
}

const FENCE_RE = /```(?:json|tool_call|tool)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

/**
 * Recover tool calls from message text, but only from positions where a tool
 * call is unambiguous: the whole message, or a fenced block on its own.
 * Returns the calls plus the exact substrings to remove from display.
 */
export function extractToolCallsFromText(content) {
  const calls = [];
  const spans = [];
  const text = (content || '').trim();
  if (!text) return { calls, spans };

  const consider = (objects, sourceSpan) => {
    const normalized = objects.map(o => normalizeCall(o.value)).filter(Boolean);
    // Only treat the span as a tool call if EVERY object in it is one; a block
    // holding arbitrary JSON data is not a call site.
    if (!normalized.length || normalized.length !== objects.length) return false;
    calls.push(...normalized);
    spans.push(sourceSpan);
    return true;
  };

  // Case 1: the entire message is one or more JSON objects and nothing else.
  if (text.startsWith('{') && text.endsWith('}')) {
    const objects = scanJsonObjects(text);
    const covered = objects.reduce((n, o) => n + o.raw.length, 0);
    const gap = text.replace(/\s+/g, '').length - objects.reduce((n, o) => n + o.raw.replace(/\s+/g, '').length, 0);
    if (objects.length && covered > 0 && gap === 0 && consider(objects, text)) {
      return { calls, spans };
    }
  }

  // Case 2: fenced blocks, each considered independently.
  FENCE_RE.lastIndex = 0;
  let match;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const inner = match[1].trim();
    if (!inner.startsWith('{') || !inner.endsWith('}')) continue;
    consider(scanJsonObjects(inner), match[0]);
  }

  return { calls, spans };
}

export function resolveToolCalls(nativeToolCalls, content, allowFallback = false) {
  const seen = new Set();
  const toolCalls = [];

  for (const raw of nativeToolCalls || []) {
    const call = normalizeCall(raw);
    if (!call) continue;
    const key = callKey(call);
    if (seen.has(key)) continue;
    seen.add(key);
    toolCalls.push(call);
  }

  const nativeCount = toolCalls.length;
  const { calls, spans } = extractToolCallsFromText(content);

  // Text calls are only *executed* when explicitly allowed (e.g. models without native support)
  // but the spans are always stripped so raw protocol JSON never reaches the user.
  if (allowFallback && nativeCount === 0) {
    for (const call of calls) {
      const key = callKey(call);
      if (seen.has(key)) continue;
      seen.add(key);
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

/** Shape a normalised call back into the wire format Ollama expects. */
export function toWireToolCalls(toolCalls) {
  return toolCalls.map(c => ({
    ...(c.id ? { id: c.id } : {}),
    function: { name: c.name, arguments: c.arguments }
  }));
}

/**
 * Templates that only render tool schemas on a trailing user turn leave the
 * model blind to its own tools on every round after a tool result. Appending a
 * short user-role continuation restores the schemas without inventing a fake
 * result. The message is context-only and is never shown in the transcript.
 */
export const CONTINUATION_MESSAGE =
  'The tool results above are the output of the calls you requested. '
  + 'Continue the task using them. Call another tool if more work is needed, '
  + 'otherwise reply to me directly with the final answer.';

export function anchorToolsForNextTurn(context) {
  const last = context[context.length - 1];
  if (!last || last.role !== 'tool') return context;
  return [...context, { role: 'user', content: CONTINUATION_MESSAGE, _synthetic: true }];
}
