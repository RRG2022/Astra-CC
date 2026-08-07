/**
 * Shared wire-format helpers for provider adapters.
 *
 * Normalized event shapes yielded by every provider:
 *   { type: 'content',         text }
 *   { type: 'tool_call_start', name, id? }
 *   { type: 'tool_call_delta', argumentsDelta }
 *   { type: 'done' }
 */

class LlmError extends Error {
  constructor(message, { status, provider, retryable = false } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.provider = provider;
    this.retryable = retryable;
  }
}

/**
 * Yields complete lines from a fetch response body, carrying partial lines
 * across chunk boundaries. NDJSON lines routinely straddle TCP chunks; without
 * this a split line is silently dropped, which loses tool calls at random.
 */
async function* lineStream(body) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const reader = body.getReader ? body.getReader() : null;

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) yield line;
      }
    }
  } else {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) yield line;
      }
    }
  }

  // Flush whatever the stream ended on without a trailing newline.
  const tail = buffer.trim();
  if (tail) yield tail;
}

/** Yields the payload of each `data: ` line in an SSE stream, skipping [DONE]. */
async function* sseDataStream(body) {
  for await (const line of lineStream(body)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    yield payload;
  }
}

module.exports = { LlmError, lineStream, sseDataStream };
