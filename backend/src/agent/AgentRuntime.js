const {
  resolveToolCalls, anchorToolsForNextTurn, toWireToolCalls, textCallCorrection, callKey
} = require('./toolProtocol.js');
const { streamChat, getContextWindow } = require('../llm/chat.js');
const { executeTool, isMutating, needsWorkspace } = require('../tools');
const { compactContext, usageSnapshot } = require('./compaction.js');
const { estimateToolsTokens } = require('./tokens.js');
const permissions = require('./permissions.js');
const auditLog = require('./auditLog.js');

// Compact once the prompt passes this share of the usable window.
const COMPACT_AT = parseFloat(process.env.ASTRA_COMPACT_AT || '0.7');

// Headroom left for the model's own reply, so budgeting never squeezes the
// answer out of the window.
const RESERVE_FOR_OUTPUT = parseInt(process.env.ASTRA_RESERVE_OUTPUT_TOKENS || '2048', 10);

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

// How many times in one turn the model is told that a tool call it wrote as
// text was not run. Enough to recover from the habit; not so many that a model
// which keeps doing it burns the whole iteration budget on being corrected.
const MAX_TEXT_CALL_CORRECTIONS = parseInt(process.env.ASTRA_MAX_TEXT_CALL_CORRECTIONS || '2', 10);

// A single unbounded tool result can evict the task from the context window.
// The UI still receives the full result; only the model's copy is capped.
const MAX_TOOL_RESULT_CHARS = parseInt(process.env.ASTRA_MAX_TOOL_RESULT_CHARS || '10000', 10);

/**
 * Shrinks an oversized tool result for the model.
 *
 * Structured results are trimmed field-wise rather than by slicing the raw
 * JSON — cutting mid-document would take the contentHash with it, and that
 * hash is the precondition for the next edit_file.
 */
function capForContext(resultString, toolName) {
  if (resultString.length <= MAX_TOOL_RESULT_CHARS) return resultString;

  let parsed;
  try {
    parsed = JSON.parse(resultString);
  } catch {
    return resultString.slice(0, MAX_TOOL_RESULT_CHARS)
      + `\n\n[truncated: ${resultString.length - MAX_TOOL_RESULT_CHARS} more characters]`;
  }

  if (parsed && typeof parsed.content === 'string') {
    const budget = Math.max(0, MAX_TOOL_RESULT_CHARS - 500);
    const kept = parsed.content.slice(0, budget);
    const shownLines = kept.split('\n').length;
    return JSON.stringify({
      ...parsed,
      content: kept,
      truncated: true,
      note: `Content truncated to the first ~${shownLines} lines. `
        + `Call ${toolName} again with offset and limit to read a specific range.`
    });
  }

  if (Array.isArray(parsed?.results) || Array.isArray(parsed?.items)) {
    const key = Array.isArray(parsed.results) ? 'results' : 'items';
    const list = parsed[key];
    const kept = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
    return capForContext(JSON.stringify({
      ...parsed,
      [key]: kept,
      truncated: true,
      note: `Showing ${kept.length} of ${list.length} entries. Narrow the query to see more.`
    }), toolName);
  }

  return resultString.slice(0, MAX_TOOL_RESULT_CHARS) + '\n\n[truncated]';
}

class AgentRuntime {
  constructor(options) {
    this.options = {
      model: 'llama3.1',
      tools: [],
      workspacePath: '',
      sessionId: null,
      persona: null,
      mode: null,
      authorityLevel: 'Supervised',
      permissionRules: [],
      maxIterations: 10,
      // Distinguishes the main loop from a sub-agent in the audit log.
      auditAgent: null,
      streamChat,
      executeTool,
      requestApproval: async () => false,
      onStateChange: () => {},
      onMessageUpdate: () => {},
      onTraceLog: () => {},
      onToolExecuted: () => {},
      onContextUsage: () => {},
      onRuleAdded: () => {},
      onTasksUpdated: () => {},
      onSubAgentEvent: () => {},
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
    this.tasks = [];
    // Text-shaped calls refused last turn. If the model writes one of these
    // again after being told, that is its answer and the call runs.
    this.awaitingConfirmation = new Set();
    // Sub-agents running under this turn. Cancelling has to reach them, or a
    // cancelled turn leaves a child still reading and writing the workspace.
    this.children = new Set();
  }

  updateState(updates) {
    this.state = { ...this.state, ...updates };
    this.options.onStateChange(this.state);
  }

  cancel() {
    this.updateState({ stopReason: STOP.CANCELLED });
    if (this.abortController) this.abortController.abort();
    for (const child of this.children) child.cancel();
  }

  /**
   * What a sub-agent inherits — deliberately an explicit list rather than a
   * spread of the parent's options. A child gets the parent's capabilities and
   * nothing beyond them, so spawning can never widen what is permitted.
   */
  childInheritance() {
    const o = this.options;
    return {
      model: o.model,
      tools: o.tools,
      workspacePath: o.workspacePath,
      sessionId: o.sessionId,
      persona: o.persona,
      mode: o.mode,
      authorityLevel: o.authorityLevel,
      permissionRules: o.permissionRules,
      streamChat: o.streamChat,
      executeTool: o.executeTool,
      requestApproval: o.requestApproval,
      onSubAgentEvent: o.onSubAgentEvent,
      adoptChild: (child) => {
        this.children.add(child);
        if (this.cancelled) child.cancel();
        return () => this.children.delete(child);
      }
    };
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
        numCtx: this.contextWindow,
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
    const { toolCalls, refusedCalls, cleanedContent } = resolveToolCalls(
      nativeToolCalls, fullContent, allowFallback, { confirmed: this.awaitingConfirmation }
    );

    trace.content = fullContent;
    trace.parsedToolCalls = toolCalls;
    this.options.onTraceLog(trace);

    if (fullContent !== cleanedContent) {
      this.options.onMessageUpdate(this.messageId, { content_replace: cleanedContent });
    }

    return { toolCalls, refusedCalls, content: cleanedContent };
  }

  /**
   * Rules first, authority level as the fallback. Returns the decision plus
   * the rule that produced it, so the UI can say why it is asking.
   */
  decide(name, args) {
    return permissions.evaluate({
      tool: name,
      args,
      rules: this.options.permissionRules || [],
      authorityLevel: this.options.authorityLevel
    });
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
    let outcome;
    let effectiveCall = call;

    const blocked = this.guard(name, args);
    const { decision, rule, subject } = blocked ? {} : this.decide(name, args);

    if (blocked) {
      resultString = blocked;
      outcome = 'blocked';
    } else if (decision === 'deny') {
      resultString = `Error: A permission rule forbids this call`
        + (rule?.pattern ? ` (deny ${rule.tool} ${rule.pattern}).` : '.')
        + ' Do not retry it; tell the user it is blocked.';
      outcome = 'denied-by-rule';
      // A standing rule is a policy, not a conversation stopper: the model is
      // told no and may continue with something else.
    } else if (decision === 'ask') {
      this.updateState({ pendingApproval: { id: callId, name, arguments: args } });
      const answer = await this.options.requestApproval({
        id: callId, name, arguments: args,
        suggestedPattern: permissions.suggestPattern(name, args),
        subject
      });
      this.updateState({ pendingApproval: null });

      const approved = typeof answer === 'boolean' ? answer : !!(answer && answer.approved);
      const edited = answer && typeof answer === 'object' ? answer.editedCall : null;
      const remember = answer && typeof answer === 'object' ? answer.rememberRule : null;

      // "Allow always for this pattern" — persisted so the next run inherits it.
      if (remember && this.options.workspacePath) {
        const saved = permissions.addRule(this.options.workspacePath, remember);
        if (saved) {
          this.options.permissionRules = [...(this.options.permissionRules || []), saved];
          this.options.onRuleAdded?.(saved);
        }
      }

      if (!approved) {
        resultString = 'Error: User explicitly denied permission to execute this tool.';
        outcome = 'denied-by-user';
        this.updateState({ stopReason: STOP.DENIED });
      } else {
        effectiveCall = edited ? normalizeEditedCall(edited, call) : call;
        resultString = await this.execute(effectiveCall);
        outcome = edited ? 'approved-edited' : 'approved';
      }
    } else {
      resultString = await this.execute(call);
      outcome = rule ? 'allowed-by-rule' : 'allowed';
    }

    let parsed = null;
    try {
      parsed = JSON.parse(resultString);
    } catch { /* non-JSON tool output */ }

    if (name === 'read_file' && parsed?.success && parsed.contentHash) {
      const path = normalizePath(args.filePath);
      if (path) this.sessionReadFiles.set(path, parsed.contentHash);
    }

    // The list replaces itself wholesale, so the last successful call is the
    // state — there is nothing to merge.
    if (name === 'update_tasks' && parsed?.success && Array.isArray(parsed.tasks)) {
      this.tasks = parsed.tasks;
      this.options.onTasksUpdated(this.tasks);
    }

    auditLog.record(this.options.workspacePath, {
      sessionId: this.options.sessionId || null,
      agent: this.options.auditAgent || null,
      callId,
      tool: name,
      args: effectiveCall.arguments || args,
      decision: decision || 'blocked',
      rule: rule ? `${rule.effect} ${rule.tool} ${rule.pattern}` : null,
      outcome,
      success: parsed ? parsed.success !== false : !String(resultString).startsWith('Error:'),
      error: parsed?.error || null
    });

    if (parsed) this.options.onToolExecuted(name, args, parsed, callId);

    this.options.onMessageUpdate(this.messageId, {
      tool_execution_result: { id: callId, status: 'completed', result: resultString, outcome }
    });

    // tool_call_id is what lets the model (and the Anthropic adapter) match a
    // result to the call that produced it.
    this.context.push({
      role: 'tool',
      tool_call_id: callId,
      name,
      content: capForContext(resultString, name)
    });
  }

  async execute(call) {
    const result = await this.options.executeTool(
      call.name,
      call.arguments || {},
      {
        workspacePath: this.options.workspacePath,
        callId: call.id,
        agent: this.childInheritance()
      }
    );
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /**
   * Fits the context to the model's window before a turn, and reports usage.
   *
   * This runs every iteration because tool results — not user messages — are
   * what actually fill the window during a long task.
   */
  async budgetContext() {
    const window = this.contextWindow
      || (this.contextWindow = await getContextWindow(this.options.model));

    const toolsTokens = estimateToolsTokens(this.options.tools);
    const budget = Math.max(1, Math.floor((window - RESERVE_FOR_OUTPUT) * COMPACT_AT) - toolsTokens);

    const result = compactContext(this.context, { budget });
    if (result.compacted) {
      this.context = result.messages;
      this.options.onTraceLog({
        timestamp: Date.now(),
        type: 'compaction',
        strategy: result.strategy,
        tokensBefore: result.before,
        tokensAfter: result.after
      });
    }

    this.options.onContextUsage({
      ...usageSnapshot({
        messages: this.context,
        tools: this.options.tools,
        contextWindow: window,
        reserveForOutput: RESERVE_FOR_OUTPUT
      }),
      compacted: result.compacted,
      model: this.options.model
    });
  }

  async run(initialContext, messageId) {
    this.messageId = messageId;
    this.context = [...initialContext];
    this.updateState({ stopReason: null, error: null, iterationCount: 0 });

    let corrections = 0;
    this.awaitingConfirmation = new Set();

    while (this.state.iterationCount < this.options.maxIterations) {
      if (this.cancelled) break;
      this.updateState({ iterationCount: this.state.iterationCount + 1 });

      await this.budgetContext();
      const turn = await this.stream(this.context);
      // Consumed: a confirmation only ever covers the turn straight after the
      // correction that asked for it.
      this.awaitingConfirmation = new Set();
      if (!turn) return this.state.stopReason; // stream() already set an honest reason

      if (this.cancelled) break;

      if (!turn.toolCalls.length) {
        // The final reply must land in context. Dropping it means the next
        // turn has no record of what the assistant said, so it repeats itself
        // and the conversation cannot refer back to its own answers.
        if (turn.content) {
          this.context.push({ role: 'assistant', content: turn.content });
        }

        // The model announced an action and wrote the call as text, so the
        // guard declined it. Ending here would report a turn as finished with
        // the announced work never done — tell it instead, and let it either
        // make the call properly or say it was only illustrating.
        if (turn.refusedCalls?.length && corrections < MAX_TEXT_CALL_CORRECTIONS) {
          corrections++;
          this.awaitingConfirmation = new Set(turn.refusedCalls.map(callKey));
          this.context.push({
            role: 'user',
            content: textCallCorrection(turn.refusedCalls),
            _synthetic: true
          });
          this.options.onTraceLog({
            timestamp: Date.now(),
            type: 'text_call_correction',
            attempt: corrections,
            calls: turn.refusedCalls.map(c => c.name)
          });
          continue;
        }

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
