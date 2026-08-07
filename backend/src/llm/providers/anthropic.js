const { LlmError, sseDataStream } = require('../stream');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Streaming, so there is room for a large budget. On current models max_tokens
// caps thinking + response text together, so this needs headroom.
const MAX_TOKENS = parseInt(process.env.ASTRA_ANTHROPIC_MAX_TOKENS || '32000', 10);

/**
 * Converts Astra's OpenAI-shaped message list into Anthropic's content-block
 * format. The system prompt is hoisted out into its own top-level field.
 */
function toAnthropicMessages(messages) {
  let system = '';
  const out = [];

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n' : '') + (m.content || '');
      continue;
    }

    if (m.role === 'tool') {
      // Anthropic carries tool results as a user turn holding tool_result blocks.
      // tool_call_id is required — a placeholder here is rejected by the API.
      if (!m.tool_call_id) {
        throw new LlmError(
          'Tool result is missing tool_call_id; Anthropic requires it to correlate the call.',
          { provider: 'anthropic' }
        );
      }
      const last = out[out.length - 1];
      const block = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content || ''
      };
      // Consecutive tool results must be merged into one user turn.
      if (last && last.role === 'user' && Array.isArray(last.content) &&
          last.content.every(b => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.tool_calls && m.tool_calls.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        const args = tc.function.arguments;
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: typeof args === 'string' ? JSON.parse(args || '{}') : (args || {})
        });
      }
      out.push({ role: 'assistant', content });
      continue;
    }

    out.push({ role: m.role, content: m.content || '' });
  }

  return { system, messages: out };
}

function toAnthropicTools(tools) {
  return (tools || []).map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));
}

async function* stream({ modelId, messages, tools, signal, apiKey }) {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const anthropicTools = toAnthropicTools(tools);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION
    },
    body: JSON.stringify({
      model: modelId,
      messages: converted,
      ...(system ? { system } : {}),
      max_tokens: MAX_TOKENS,
      stream: true,
      ...(anthropicTools.length ? { tools: anthropicTools } : {})
    }),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(
      `Anthropic returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
      { status: response.status, provider: 'anthropic' }
    );
  }

  for await (const payload of sseDataStream(response.body)) {
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }

    if (data.type === 'error') {
      throw new LlmError(`Anthropic error: ${data.error?.message || 'unknown'}`, {
        provider: 'anthropic'
      });
    }

    if (data.type === 'content_block_start') {
      const block = data.content_block;
      if (block?.type === 'tool_use') {
        yield { type: 'tool_call_start', name: block.name, id: block.id };
      }
      // `thinking` blocks are ignored — they carry no text under the default
      // display setting, and Astra has no surface for them yet.
      continue;
    }

    if (data.type === 'content_block_delta') {
      const delta = data.delta;
      if (delta?.type === 'text_delta') {
        yield { type: 'content', text: delta.text };
      } else if (delta?.type === 'input_json_delta') {
        yield { type: 'tool_call_delta', argumentsDelta: delta.partial_json };
      }
      continue;
    }

    if (data.type === 'message_stop') {
      yield { type: 'done' };
    }
  }
}

module.exports = { stream, toAnthropicMessages, toAnthropicTools };
