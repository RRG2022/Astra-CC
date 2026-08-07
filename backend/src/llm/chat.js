const ollama = require('./providers/ollama');
const openai = require('./providers/openai');
const anthropic = require('./providers/anthropic');
const { LlmError } = require('./stream');
const { getSettings } = require('../routes/settings');

/**
 * Cloud models Astra offers by name. Anything not listed here is assumed to be
 * a local Ollama model.
 */
const CLOUD_MODELS = {
  'gpt-4o': {
    provider: 'openai',
    modelId: 'gpt-4o',
    keyName: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  'gemini-1.5-pro': {
    provider: 'openai',
    modelId: 'gemini-1.5-pro',
    keyName: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  },
  'claude-opus-5': {
    provider: 'anthropic',
    modelId: 'claude-opus-5',
    keyName: 'anthropic'
  },
  'claude-sonnet-5': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    keyName: 'anthropic'
  }
};

function resolveProvider(model) {
  const cloud = CLOUD_MODELS[model];
  if (!cloud) return { provider: 'ollama', modelId: model };

  const apiKey = getSettings().apiKeys?.[cloud.keyName];
  if (!apiKey) {
    throw new LlmError(
      `No API key configured for ${cloud.keyName}. Add one in Settings.`,
      { provider: cloud.provider, status: 400 }
    );
  }
  return { ...cloud, apiKey };
}

/**
 * Streams a chat completion as normalized events, regardless of provider.
 * See llm/stream.js for the event shapes.
 */
async function* streamChat({ model, messages, tools, signal }) {
  const target = resolveProvider(model);

  switch (target.provider) {
    case 'openai':
      yield* openai.stream({ ...target, model, messages, tools, signal });
      return;
    case 'anthropic':
      yield* anthropic.stream({ ...target, messages, tools, signal });
      return;
    default:
      yield* ollama.stream({ model: target.modelId, messages, tools, signal });
  }
}

/** Model list for the picker: configured cloud models plus local Ollama tags. */
async function listModels() {
  const settings = getSettings();
  const cloud = Object.entries(CLOUD_MODELS)
    .filter(([, cfg]) => settings.apiKeys?.[cfg.keyName])
    .map(([name, cfg]) => ({ name, family: cfg.provider }));

  let local = [];
  try {
    local = await ollama.listModels();
  } catch (err) {
    console.error('Error fetching models from Ollama:', err.message);
  }

  return [...cloud, ...local];
}

/**
 * Whether a model can accept tool schemas. Cloud models all can; for Ollama we
 * ask the daemon rather than pattern-matching the model name.
 */
const toolSupportCache = new Map();

async function supportsTools(model) {
  if (CLOUD_MODELS[model]) return true;
  if (toolSupportCache.has(model)) return toolSupportCache.get(model);

  let supported = true; // optimistic: the Ollama adapter retries without tools on rejection
  try {
    const info = await ollama.showModel(model);
    const caps = info.capabilities;
    if (Array.isArray(caps)) supported = caps.includes('tools');
  } catch {
    // /api/show unavailable — leave optimistic and let the retry path handle it
  }

  toolSupportCache.set(model, supported);
  return supported;
}

module.exports = { streamChat, listModels, supportsTools, resolveProvider, CLOUD_MODELS };
