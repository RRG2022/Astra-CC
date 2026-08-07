const { resolveToolCalls, anchorToolsForNextTurn, toWireToolCalls } = require('./toolProtocol.js');
const { streamChat } = require('../llm/chat.js');
const { executeTool, isMutating, needsWorkspace } = require('../tools');

/**
 * Terminal states. `error` exists so a failed model call can never be reported
 * as a finished turn — the two were indistinguishable before, which made a dead
 * backend look like a successful empty response.
 */
const STOP = {
  COMPLETE: 'complete',
  CANCELLED: 'cancelled',
  DENIED: 'denied',
  MAX_ITERATIONS: 'max_iterations',
  ERROR: 'error'
};

const APPROVAL_REQUIRED_BY_LEVEL = {
  Strict: () => true,
  Supervised: (name) => isMutating(name),
  Autonomous: () => false
};

class AgentRuntime {
  constructor(options) {
    this.options = {
      model: 'llama3.1',
      tools: [],
      workspacePath: '',
      authorityLevel: 'Supervised',
      maxIterations: 10,
      streamChat,
      executeTool,
      requestApproval: async () => false,
      onStateChange: () => {},
      onMessageUpdate: () => {},
      onTraceLog: () => {},
      onToolExecuted: () => {},
      ...options
    };

    this.state = {
      isStreaming: false,
      isExecutingTool: false,
      pendingApproval: null,
      stopReason: null,
      error: null,
      currentActionId: null,
      iterationCount: 0
    };

    this.abortController = null;
    this.messageId = null;
    this.context = [];
    this.sessionReadFiles = new Map();
  }

  updateState(updates) {
    this.state = { ...this.state, ...updates };
    this.options.onStateChange(this.state);
  }

  cancel() {
    this.updateState({ stopReason: STOP.CANCELLED });
    if (this.abortController) this.abortController.abort();
  }

  get cancelled() {
    return this.state.stopReason === STOP.CANCELLED;
  }

  /**
   * Runs one model turn. Returns the resolved tool calls, or null if the turn
   * failed — in which case stopReason is already set to `error`.
   */
  async stream(apiMessages) {
    this.updateState({ isStreaming: true });
    this.abortController = new AbortController();

    const trace = {
      timestamp: Date.now(),
      model: this.options.model,
      requestMessages: apiMessages,
      toolsAttached: (this.options.tools || []).map(t => t.function?.name).filter(Boolean),
      content: '',
      parsedToolCalls: []
    };

    let fullContent = '';
    const nativeToolCalls = [];

    try {
      const events = this.options.streamChat({
        model: this.options.model,
        messages: apiMessages,
        tools: this.options.tools,
        signal: this.abortController.signal
      });

      for await (const event of events) {
        if (event.type === 'content') {
          fullContent += event.text;
          this.options.onMessageUpdate(this.messageId, { content: event.text });
        } else if (event.type === 'tool_call_start') {
          nativeToolCalls.push({
            ...(event.id ? { id: event.id } : {}),
            function: { name: event.name, arguments: '' }
          });
        } else if (event.type === 'tool_call_delta') {
          const current = nativeToolCalls[nativeToolCalls.length - 1];
          if (current) current.function.arguments += event.argumentsDelta;
        }
      }
    } catch (err) {
      this.updateState({ isStreaming: false });
      if (err.name === 'AbortError' || this.cancelled) {
        this.updateState({ stopReason: STOP.CANCELLED });
      } else {
        this.updateState({ stopReason: STOP.ERROR, error: err.message });
        this.options.onMessageUpdate(this.messageId, { error: err.message });
      }
      trace.error = err.message;
      this.options.onTraceLog(trace);
      return null;
    }

    this.updateState({ isStreaming: false });

    // Text-shaped calls are only trusted when the model was never shown any
    // schemas — otherwise a native call is the only legitimate channel.
    const allowFallback = !(this.options.tools || []).length;
    const { toolCalls, cleanedContent } = resolveToolCalls(nativeToolCalls, fullContent, allowFallback);

    trace.content = fullContent;
    trace.parsedToolCalls = toolCalls;
    this.options.onTraceLog(trace);

    if (fullContent !== cleanedContent) {
      this.options.onMessageUpdate(this.messageId, { content_replace: cleanedContent });
    }

    return { toolCalls, content: cleanedContent };
  }

  needsApproval(toolName) {
    const rule = APPROVAL_REQUIRED_BY_LEVEL[this.options.authorityLevel] || (() => true);
    return rule(toolName);
  }

  /** Pre-flight checks that refuse a call without ever executing it. */
  guard(name, args) {
    if (needsWorkspace(name) && !this.options.workspacePath) {
      return 'Error: An active workspace is required for this action.';
    }

    if (name === 'edit_file') {
      const path = normalizePath(args.filePath);
      if (!path || !this.sessionReadFiles.has(path)) {
        return 'Error: You must read the file with read_file before editing it. '
          + 'This is a strict safety invariant.';
      }
    }

    return null;
  }

  async runToolCall(call) {
    const { id: callId, name } = call;
    const args = call.arguments || {};

    this.updateState({ currentActionId: callId });
    this.options.onMessageUpdate(this.messageId, {
      tool_execution: { id: callId, name, arguments: args, status: 'running', result: null }
    });

    let resultString;
    const blocked = this.guard(name, args);

    if (blocked) {
      resultString = blocked;
    } else if (this.needsApproval(name)) {
      this.updateState({ pendingApproval: { id: callId, name, arguments: args } });
      const decision = await this.options.requestApproval({ id: callId, name, arguments: args });
      this.updateState({ pendingApproval: null });

      const approved = typeof decision === 'boolean' ? decision : !!(decision && decision.approved);
      const edited = decision && typeof decision === 'object' ? decision.editedCall : null;

      if (!approved) {
        resultString = 'Error: User explicitly denied permission to execute this tool.';
        this.updateState({ stopReason: STOP.DENIED });
      } else {
        const effective = edited ? normalizeEditedCall(edited, call) : call;
        resultString = await this.execute(effective);
      }
    } else {
      resultString = await this.execute(call);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(resultString);
    } catch { /* non-JSON tool output */ }

    if (name === 'read_file' && parsed?.success && parsed.contentHash) {
      const path = normalizePath(args.filePath);
      if (path) this.sessionReadFiles.set(path, parsed.contentHash);
    }

    if (parsed) this.options.onToolExecuted(name, args, parsed, callId);

    this.options.onMessageUpdate(this.messageId, {
      tool_execution_result: { id: callId, status: 'completed', result: resultString }
    });

    // tool_call_id is what lets the model (and the Anthropic adapter) match a
    // result to the call that produced it.
    this.context.push({
      role: 'tool',
      tool_call_id: callId,
      name,
      content: resultString
    });
  }

  async execute(call) {
    const result = await this.options.executeTool(
      call.name,
      call.arguments || {},
      { workspacePath: this.options.workspacePath }
    );
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  async run(initialContext, messageId) {
    this.messageId = messageId;
    this.context = [...initialContext];
    this.updateState({ stopReason: null, error: null, iterationCount: 0 });

    while (this.state.iterationCount < this.options.maxIterations) {
      if (this.cancelled) break;
      this.updateState({ iterationCount: this.state.iterationCount + 1 });

      const turn = await this.stream(this.context);
      if (!turn) return this.state.stopReason; // stream() already set an honest reason

      if (this.cancelled) break;

      if (!turn.toolCalls.length) {
        this.updateState({ stopReason: STOP.COMPLETE });
        return this.state.stopReason;
      }

      this.context.push({
        role: 'assistant',
        content: turn.content || '',
        tool_calls: toWireToolCalls(turn.toolCalls)
      });

      this.updateState({ isExecutingTool: true });

      for (const call of turn.toolCalls) {
        if (this.cancelled) break;
        await this.runToolCall(call);
        if (this.state.stopReason === STOP.DENIED) break;
      }

      this.updateState({ isExecutingTool: false, currentActionId: null });

      if (this.state.stopReason === STOP.DENIED) break;
      if (this.cancelled) break;

      this.context = anchorToolsForNextTurn(this.context);
    }

    if (!this.state.stopReason) {
      this.updateState({ stopReason: STOP.MAX_ITERATIONS });
    }
    return this.state.stopReason;
  }
}

function normalizePath(filePath) {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Accepts an edited call in either the wire or the resolved shape. */
function normalizeEditedCall(edited, original) {
  const src = edited.function || edited;
  let args = src.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = original.arguments; }
  }
  return {
    id: original.id,
    name: src.name || original.name,
    arguments: args || original.arguments
  };
}

module.exports = { AgentRuntime, STOP };
