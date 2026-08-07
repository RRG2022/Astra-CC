const { badRequest } = require('./errors');

/**
 * Sub-agents: a nested agent turn that keeps its own context window.
 *
 * The value is in what the parent does *not* pay for. A search that needs
 * twenty tool results to answer costs the parent one message — the child's
 * final report — instead of twenty. That only works if the child's transcript
 * never re-enters the parent's context, so it never does: the report is the
 * entire return value, and the parent cannot see the working.
 *
 * Three properties this must not lose:
 *
 *   - **A child can never do more than its parent.** Its tools are the
 *     parent's, optionally narrowed, never widened. Spawning is therefore not
 *     a way out of plan mode or a persona's allowlist.
 *   - **A child cannot spawn.** spawn_agent is removed from the inherited set,
 *     which bounds recursion by construction rather than by a counter someone
 *     can get wrong later.
 *   - **A child's approvals are the parent's approvals.** requestApproval is
 *     passed straight through, so a sub-agent is not a way to get a write past
 *     the user, and its calls land in the same audit log.
 */

const MAX_REPORT_CHARS = parseInt(process.env.ASTRA_MAX_SUBAGENT_REPORT_CHARS || '6000', 10);
const DEFAULT_MAX_ITERATIONS = parseInt(process.env.ASTRA_SUBAGENT_MAX_ITERATIONS || '8', 10);

/** The child's tools: the parent's set, minus spawning, optionally narrowed. */
function resolveChildTools(inherited, requested) {
  const available = inherited.filter(t => t.function?.name !== 'spawn_agent');
  if (!Array.isArray(requested) || !requested.length) return available;

  const byName = new Map(available.map(t => [t.function.name, t]));
  const unavailable = requested.filter(name => !byName.has(name));
  if (unavailable.length) {
    throw badRequest(
      `You cannot give a sub-agent tools you do not have yourself: ${unavailable.join(', ')}.`,
      `Available to delegate: ${[...byName.keys()].join(', ') || 'none'}.`
    );
  }

  return requested.map(name => byName.get(name));
}

/** The child's answer is its last assistant message — there is nothing else. */
function finalReport(context) {
  for (let i = context.length - 1; i >= 0; i--) {
    const message = context[i];
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

async function spawnAgent(args, ctx) {
  // Required lazily: AgentRuntime pulls in the tool registry and the registry
  // pulls in this file. Resolving the cycle at call time rather than at load
  // time is what keeps either side from seeing a half-initialised module.
  const { AgentRuntime } = require('../agent/AgentRuntime.js');
  const { buildSystemPrompt } = require('../agent/systemPrompt.js');

  const parent = ctx.agent;
  if (!parent) {
    throw badRequest(
      'spawn_agent can only be called from inside an agent turn.',
      'It has nothing to inherit its tools, permissions and approvals from otherwise.'
    );
  }

  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) {
    throw badRequest(
      'task is required.',
      'Describe the whole job in one instruction. The sub-agent cannot see this '
      + 'conversation, so anything it needs to know must be in the task itself.'
    );
  }

  const tools = resolveChildTools(parent.tools || [], args.tools);
  if (!tools.length) {
    throw badRequest(
      'There are no tools left to delegate.',
      'Do this work yourself rather than spawning an agent that cannot act.'
    );
  }

  const { prompt } = buildSystemPrompt({
    persona: parent.persona,
    workspacePath: parent.workspacePath,
    mode: parent.mode,
    subAgent: true
  });

  const toolsUsed = [];
  const child = new AgentRuntime({
    model: parent.model,
    tools,
    workspacePath: parent.workspacePath,
    sessionId: parent.sessionId,
    persona: parent.persona,
    mode: parent.mode,
    authorityLevel: parent.authorityLevel,
    permissionRules: parent.permissionRules,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    // The seams the parent was built with, so a test harness drives the child
    // through the same fakes.
    streamChat: parent.streamChat,
    executeTool: parent.executeTool,
    // Same gate, same user, same log. A sub-agent asks with the parent's voice.
    requestApproval: parent.requestApproval,
    auditAgent: `sub:${ctx.callId || 'unknown'}`,
    // The child's tokens are not part of the parent's reply, so they are not
    // streamed into it. Only its activity is reported, for the UI to show.
    onToolExecuted: (name) => {
      toolsUsed.push(name);
      parent.onSubAgentEvent?.({ callId: ctx.callId, phase: 'tool', name });
    }
  });

  const release = parent.adoptChild?.(child) || (() => {});
  parent.onSubAgentEvent?.({ callId: ctx.callId, phase: 'started', task, tools: tools.map(t => t.function.name) });

  let stopReason;
  try {
    stopReason = await child.run(
      [{ role: 'system', content: prompt }, { role: 'user', content: task }],
      `${ctx.callId || 'sub'}-message`
    );
  } finally {
    release();
  }

  const report = finalReport(child.context);
  const truncated = report.length > MAX_REPORT_CHARS;

  parent.onSubAgentEvent?.({
    callId: ctx.callId, phase: 'finished', stopReason, iterations: child.state.iterationCount
  });

  const result = {
    success: stopReason === 'complete' && !!report,
    stopReason,
    iterations: child.state.iterationCount,
    toolsUsed,
    report: truncated ? `${report.slice(0, MAX_REPORT_CHARS)}\n\n[report truncated]` : report,
    ...(truncated ? { truncated: true } : {})
  };

  // A sub-agent that ran out of road has findings but not an answer, and the
  // parent must not read the two the same way.
  if (!result.success) {
    result.error = stopReason === 'complete'
      ? 'The sub-agent finished without producing a report.'
      : `The sub-agent stopped early (${stopReason}); anything in report is partial.`;
    result.hint = 'Treat the report as incomplete. Verify it yourself or narrow the task and retry.';
  }

  return result;
}

module.exports = { spawnAgent, resolveChildTools, finalReport, DEFAULT_MAX_ITERATIONS };
