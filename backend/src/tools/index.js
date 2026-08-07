const fsTools = require('./fsTools');
const terminal = require('./terminal');
const tasks = require('./tasks');
const subAgent = require('./subAgent');
const { ToolError, badRequest } = require('./errors');

/**
 * The single source of truth for what the agent can do.
 *
 * Every entry is a plain `async (args, ctx) => result` function. The Express
 * routes in routes/files.js and the AgentRuntime both call through here, so
 * there is no in-process HTTP hop and no way for the two paths to disagree
 * about what a tool does.
 *
 *   `mutating` — requires approval under the Supervised authority level.
 *   `needsWorkspace` — refused outright when no workspace is pinned.
 */
const REGISTRY = {
  read_file:   { run: fsTools.readFile,    mutating: false, needsWorkspace: true },
  list_dir:    { run: fsTools.listDir,     mutating: false, needsWorkspace: true },
  grep_search: { run: fsTools.grepSearch,  mutating: false, needsWorkspace: true },
  write_file:  { run: fsTools.writeFile,   mutating: true,  needsWorkspace: true },
  edit_file:   { run: fsTools.editFile,    mutating: true,  needsWorkspace: true },
  rewind_file: { run: fsTools.rewindFile,  mutating: true,  needsWorkspace: true },
  run_command: { run: terminal.runCommand, mutating: true,  needsWorkspace: true },
  // Bookkeeping, not an action: it changes the agent's plan, not the workspace.
  update_tasks: { run: tasks.updateTasks,  mutating: false, needsWorkspace: false },
  // Not mutating in itself — the child's own calls are gated one by one, with
  // the parent's rules and the parent's approval prompt.
  spawn_agent: { run: subAgent.spawnAgent, mutating: false, needsWorkspace: true }
};

function getTool(name) {
  return REGISTRY[name] || null;
}

function isMutating(name) {
  const tool = getTool(name);
  return tool ? tool.mutating : true; // unknown tools are treated as dangerous
}

function needsWorkspace(name) {
  const tool = getTool(name);
  return tool ? tool.needsWorkspace : true;
}

function toolNames() {
  return Object.keys(REGISTRY);
}

/**
 * Executes a tool and always resolves to a plain result object — never throws.
 * Failures come back as `{ success: false, error, code, hint? }` so the agent
 * loop can hand them straight to the model as a repair signal.
 */
async function executeTool(name, args, ctx = {}) {
  const tool = getTool(name);
  if (!tool) {
    return badRequest(
      `Unknown tool: ${name}`,
      `Available tools: ${toolNames().join(', ')}`
    ).toResult();
  }

  if (tool.needsWorkspace && !ctx.workspacePath) {
    return badRequest('An active workspace is required for this action.').toResult();
  }

  try {
    return await tool.run(args || {}, ctx);
  } catch (err) {
    if (err instanceof ToolError) return err.toResult();
    return { success: false, error: err.message, code: err.code || 'TOOL_ERROR' };
  }
}

module.exports = {
  REGISTRY,
  executeTool,
  getTool,
  isMutating,
  needsWorkspace,
  toolNames,
  terminal
};
