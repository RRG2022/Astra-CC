const { LlmError, sseDataStream } = require('../stream');

/**
 * OpenAI Chat Completions, also used for Gemini's OpenAI-compatible endpoint.
 */
function toWireMessages(messages) {
  return messages.map(m => ({
    role: m.role,
    content: m.content || '',
    ...(m.tool_calls ? {
      tool_calls: m.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments)
        }
      }))
    } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {})
  }));
}

async function* stream({ model, modelId, messages, tools, signal, apiKey, endpoint }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId || model,
      messages: toWireMessages(messages),
      stream: true,
      ...(tools && tools.length ? { tools } : {})
    }),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(
      `${modelId || model} returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
      { status: response.status, provider: 'openai' }
    );
  }

  // Tool calls arrive indexed; a new index means a new call.
  let currentIndex = null;

  for await (const payload of sseDataStream(response.body)) {
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }

    const delta = data.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: 'content', text: delta.content };
    }

    for (const tc of delta.tool_calls || []) {
      if (tc.index !== undefined && tc.index !== currentIndex) {
        currentIndex = tc.index;
        yield { type: 'tool_call_start', name: tc.function?.name, id: tc.id };
        if (tc.function?.arguments) {
          yield { type: 'tool_call_delta', argumentsDelta: tc.function.arguments };
        }
        continue;
      }
      if (tc.function?.name && currentIndex === null) {
        currentIndex = tc.index ?? 0;
        yield { type: 'tool_call_start', name: tc.function.name, id: tc.id };
      }
      if (tc.function?.arguments) {
        yield { type: 'tool_call_delta', argumentsDelta: tc.function.arguments };
      }
    }

    if (data.choices?.[0]?.finish_reason) yield { type: 'done' };
  }
}

module.exports = { stream, toWireMessages };
