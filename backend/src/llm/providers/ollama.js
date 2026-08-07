const { LlmError, lineStream } = require('../stream');

const baseUrl = () => process.env.ASTRA_OLLAMA_URL || 'http://localhost:11434';

const options = (numCtx) => ({
  num_ctx: numCtx || parseInt(process.env.ASTRA_NUM_CTX || '8192', 10),
  temperature: parseFloat(process.env.ASTRA_TEMPERATURE || '0.1'),
  top_p: 0.9,
  repeat_penalty: 1.05
});

const keepAlive = () => process.env.ASTRA_KEEP_ALIVE || '30m';

/** Drop tool schemas and tool turns, for models that reject them outright. */
function stripTools(messages) {
  return messages
    .filter(m => m.role !== 'tool')
    .map(({ tool_calls, tool_call_id, ...rest }) => rest);
}

async function post(body, signal) {
  return fetch(`${baseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
}

async function* stream({ model, messages, tools, signal, numCtx }) {
  const payload = {
    model,
    messages,
    stream: true,
    options: options(numCtx),
    keep_alive: keepAlive(),
    ...(tools && tools.length ? { tools } : {})
  };

  let response = await post(payload, signal);

  // Some Ollama models reject the `tools` field entirely. Retry once without it
  // rather than surfacing an error the user can do nothing about.
  if (!response.ok && response.status === 400 && payload.tools) {
    const body = await response.text();
    if (body.includes('does not support tools')) {
      response = await post(
        { ...payload, tools: undefined, messages: stripTools(messages) },
        signal
      );
    } else {
      throw new LlmError(`Ollama rejected the request: ${body.slice(0, 500)}`, {
        status: 400, provider: 'ollama'
      });
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(
      `Ollama returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
      { status: response.status, provider: 'ollama', retryable: response.status >= 500 }
    );
  }

  for await (const line of lineStream(response.body)) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a genuinely malformed line, not a split one
    }

    if (parsed.error) {
      throw new LlmError(`Ollama error: ${parsed.error}`, { provider: 'ollama' });
    }

    const message = parsed.message;
    if (message?.content) {
      yield { type: 'content', text: message.content };
    }

    for (const call of message?.tool_calls || []) {
      if (call.function?.name) {
        yield { type: 'tool_call_start', name: call.function.name, id: call.id };
        if (call.function.arguments !== undefined && call.function.arguments !== '') {
          yield {
            type: 'tool_call_delta',
            argumentsDelta: typeof call.function.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function.arguments)
          };
        }
      } else if (call.function?.arguments !== undefined) {
        yield {
          type: 'tool_call_delta',
          argumentsDelta: typeof call.function.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function.arguments)
        };
      }
    }

    if (parsed.done) yield { type: 'done' };
  }
}

async function listModels() {
  const res = await fetch(`${baseUrl()}/api/tags`);
  if (!res.ok) throw new LlmError(`Ollama /api/tags returned ${res.status}`, { provider: 'ollama' });
  const data = await res.json();
  return data.models || [];
}

async function showModel(model) {
  const res = await fetch(`${baseUrl()}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model })
  });
  if (!res.ok) throw new LlmError(`Ollama /api/show returned ${res.status}`, { provider: 'ollama' });
  return res.json();
}

module.exports = { stream, listModels, showModel, baseUrl, stripTools };
