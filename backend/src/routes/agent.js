const express = require('express');
const router = express.Router();
const axios = require('axios');
const { spawn } = require('child_process');
const { getSettings } = require('./settings');

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_OPTIONS = {
  num_ctx: parseInt(process.env.ASTRA_NUM_CTX || '8192', 10),
  temperature: parseFloat(process.env.ASTRA_TEMPERATURE || '0.1'),
  top_p: 0.9,
  repeat_penalty: 1.05
};
const OLLAMA_KEEP_ALIVE = process.env.ASTRA_KEEP_ALIVE || '30m';

// Get available models
router.get('/models', async (req, res) => {
  let externalModels = [];
  try {
    const settings = getSettings();
    if (settings.apiKeys.openai) externalModels.push({ name: 'gpt-4o', family: 'openai' });
    if (settings.apiKeys.anthropic) externalModels.push({ name: 'claude-3-opus', family: 'anthropic' });
    if (settings.apiKeys.gemini) externalModels.push({ name: 'gemini-1.5-pro', family: 'google' });

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    const data = response.data;
    data.models = [...externalModels, ...(data.models || [])];
    res.json(data);
  } catch (error) {
    console.error('Error fetching models from Ollama:', error.message);
    res.json({ models: externalModels });
  }
});

// Pull model in background
router.post('/models/pull', (req, res) => {
  const { model } = req.body;
  const p = spawn('ollama', ['pull', model], { stdio: 'ignore', detached: true });
  p.on('error', (err) => {
    console.error('Failed to spawn ollama pull:', err.message);
  });
  p.unref();
  res.json({ success: true, message: `Started pulling ${model} in background` });
});

// Orchestrate scaffold
router.post('/orchestrate', (req, res) => {
  const { task, agents } = req.body;
  const logs = [
    { role: 'planner', text: 'Analyzing task: ' + task },
    { role: 'planner', text: 'Breaking down into sub-tasks and delegating to ' + agents.join(', ') },
    { role: 'coder', text: 'Writing initial implementation...' },
    { role: 'reviewer', text: 'Reviewing code. Found 2 issues. Suggesting fixes.' },
    { role: 'coder', text: 'Applying fixes.' },
    { role: 'planner', text: 'Task completed successfully.' }
  ];
  setTimeout(() => {
    res.json({ success: true, message: 'Orchestration finished', logs });
  }, 1500);
});

// Generate response
router.post('/generate', async (req, res) => {
  try {
    const { model, prompt, stream } = req.body;
    if (stream) {
      const response = await axios({
        method: 'post',
        url: `${OLLAMA_BASE_URL}/api/generate`,
        data: { model, prompt, stream: true },
        responseType: 'stream'
      });
      response.data.pipe(res);
    } else {
      const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
        model,
        prompt,
        stream: false
      });
      res.json(response.data);
    }
  } catch (error) {
    console.error('Error in generation:', error.message);
    res.status(500).json({ error: 'Generation failed.' });
  }
});

// OpenAI Compatible Router (OpenAI & Gemini)
async function handleOpenAICompatibleChat(apiKey, modelName, endpointUrl, req, res) {
  const { messages, stream, tools } = req.body;

  const cleanedMessages = messages.map(m => ({
    role: m.role,
    content: m.content || '',
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {})
  }));

  try {
    const response = await axios({
      method: 'post',
      url: endpointUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      data: {
        model: modelName,
        messages: cleanedMessages,
        stream: stream || false,
        ...(tools && tools.length ? { tools } : {})
      },
      responseType: stream ? 'stream' : 'json'
    });

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      let carry = '';
      response.data.on('data', chunk => {
        carry += chunk.toString();
        let lines = carry.split('\n');
        carry = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta;
              if (delta) {
                const ollamaChunk = {};
                if (delta.content !== undefined) {
                  ollamaChunk.message = { role: 'assistant', content: delta.content };
                }
                if (delta.tool_calls) {
                  ollamaChunk.message = {
                    role: 'assistant',
                    tool_calls: delta.tool_calls.map(tc => ({
                      id: tc.id,
                      type: 'function',
                      function: {
                        name: tc.function?.name,
                        arguments: tc.function?.arguments
                      }
                    }))
                  };
                }
                res.write(JSON.stringify(ollamaChunk) + '\n');
              }
            } catch (e) {}
          }
        }
      });

      response.data.on('end', () => {
        res.end();
      });
    } else {
      const choice = response.data.choices?.[0];
      res.json({
        message: {
          role: 'assistant',
          content: choice?.message?.content || '',
          ...(choice?.message?.tool_calls ? { tool_calls: choice.message.tool_calls } : {})
        }
      });
    }
  } catch (error) {
    console.error(`${modelName} compatible chat error:`, error.response ? error.response.data : error.message);
    res.status(500).json({ error: `${modelName} chat completion failed.` });
  }
}

// Anthropic messages completions
async function handleAnthropicChat(apiKey, req, res) {
  const { messages, stream, tools } = req.body;

  let systemPrompt = '';
  const cleanedMessages = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt += m.content + '\n';
    } else if (m.role === 'tool') {
      cleanedMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id || 'unknown',
            content: m.content || ''
          }
        ]
      });
    } else if (m.tool_calls && m.tool_calls.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || 'unknown',
          name: tc.function?.name,
          input: JSON.parse(tc.function?.arguments || '{}')
        });
      }
      cleanedMessages.push({ role: 'assistant', content });
    } else {
      cleanedMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const anthropicTools = tools ? tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  })) : [];

  try {
    const response = await axios({
      method: 'post',
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      data: {
        model: 'claude-3-opus-20240229',
        messages: cleanedMessages,
        system: systemPrompt || undefined,
        max_tokens: 4096,
        stream: stream || false,
        ...(anthropicTools.length ? { tools: anthropicTools } : {})
      },
      responseType: stream ? 'stream' : 'json'
    });

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      let carry = '';
      let activeToolCall = null;

      response.data.on('data', chunk => {
        carry += chunk.toString();
        let lines = carry.split('\n');
        carry = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const ollamaChunk = {};

              if (data.type === 'content_block_delta') {
                const delta = data.delta;
                if (delta.type === 'text_delta') {
                  ollamaChunk.message = { role: 'assistant', content: delta.text };
                } else if (delta.type === 'input_json_delta') {
                  ollamaChunk.message = {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: activeToolCall?.id,
                        type: 'function',
                        function: {
                          arguments: delta.partial_json
                        }
                      }
                    ]
                  };
                }
              } else if (data.type === 'content_block_start') {
                if (data.content_block?.type === 'tool_use') {
                  activeToolCall = data.content_block;
                  ollamaChunk.message = {
                    role: 'assistant',
                    tool_calls: [
                      {
                        id: activeToolCall.id,
                        type: 'function',
                        function: {
                          name: activeToolCall.name,
                          arguments: ''
                        }
                      }
                    ]
                  };
                }
              }
              if (ollamaChunk.message) {
                res.write(JSON.stringify(ollamaChunk) + '\n');
              }
            } catch (e) {}
          }
        }
      });

      response.data.on('end', () => {
        res.end();
      });
    } else {
      const content = response.data.content || [];
      let text = '';
      const toolCalls = [];

      for (const block of content) {
        if (block.type === 'text') {
          text += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input)
            }
          });
        }
      }

      res.json({
        message: {
          role: 'assistant',
          content: text,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        }
      });
    }
  } catch (error) {
    console.error('Anthropic Chat error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Anthropic Chat generation failed.' });
  }
}

// Chat session
router.post('/chat', async (req, res) => {
  const { model, messages, stream, tools } = req.body;
  const settings = getSettings();

  // Route to the appropriate cloud provider if requested
  if (model === 'gpt-4o') {
    const apiKey = settings.apiKeys.openai;
    if (!apiKey) return res.status(400).json({ error: 'OpenAI API Key is missing. Please configure it in Settings.' });
    return handleOpenAICompatibleChat(apiKey, 'gpt-4o', 'https://api.openai.com/v1/chat/completions', req, res);
  }
  
  if (model === 'gemini-1.5-pro') {
    const apiKey = settings.apiKeys.gemini;
    if (!apiKey) return res.status(400).json({ error: 'Gemini API Key is missing. Please configure it in Settings.' });
    return handleOpenAICompatibleChat(apiKey, 'gemini-1.5-pro', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', req, res);
  }

  if (model === 'claude-3-opus') {
    const apiKey = settings.apiKeys.anthropic;
    if (!apiKey) return res.status(400).json({ error: 'Anthropic API Key is missing. Please configure it in Settings.' });
    return handleAnthropicChat(apiKey, req, res);
  }

  // Fallback to local Ollama
  try {
    const attemptRequest = async (useTools) => {
      const payload = {
        model,
        messages,
        stream,
        tools: useTools ? tools : undefined,
        options: OLLAMA_OPTIONS,
        keep_alive: OLLAMA_KEEP_ALIVE
      };
      if (!useTools) delete payload.tools;
      
      return await axios({
        method: 'post',
        url: `${OLLAMA_BASE_URL}/api/chat`,
        data: payload,
        responseType: stream ? 'stream' : 'json',
        validateStatus: false
      });
    };

    let response = await attemptRequest(true);

    if (response.status === 400) {
      let errMsg = '';
      if (stream) {
        errMsg = await new Promise((resolve) => {
           let data = '';
           response.data.on('data', chunk => data += chunk.toString());
           response.data.on('end', () => resolve(data));
        });
      } else {
        errMsg = JSON.stringify(response.data);
      }
      
      if (errMsg.includes('does not support tools')) {
        console.log(`[Ollama] Model ${model} does not support tools. Retrying without tools...`);
        const cleanedMessages = messages.filter(m => m.role !== 'tool').map(m => {
          const { tool_calls, ...rest } = m;
          return rest;
        });
        
        const retryPayload = {
          model,
          messages: cleanedMessages,
          stream,
          options: OLLAMA_OPTIONS,
          keep_alive: OLLAMA_KEEP_ALIVE
        };
        const retryResponse = await axios({
          method: 'post',
          url: `${OLLAMA_BASE_URL}/api/chat`,
          data: retryPayload,
          responseType: stream ? 'stream' : 'json'
        });
        
        if (stream) {
          return retryResponse.data.pipe(res);
        } else {
          return res.json(retryResponse.data);
        }
      } else {
         return res.status(400).send(errMsg);
      }
    }

    if (stream) {
      response.data.pipe(res);
    } else {
      res.json(response.data);
    }
  } catch (error) {
    console.error('Error in chat generation:', error.message);
    res.status(500).json({ error: 'Chat generation failed.' });
  }
});

module.exports = router;
