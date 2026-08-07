const { isMutating } = require('../tools');

/**
 * Session modes.
 *
 * Plan mode is a capability filter, not a prompt convention: the mutating
 * tools are physically absent from the request, so "it changed something while
 * I was still deciding" cannot happen regardless of what the model decides to
 * do. That is the whole reason it is worth having.
 */
const MODES = {
  build: {
    name: 'Build',
    readOnly: false,
    prompt: null
  },
  plan: {
    name: 'Plan',
    readOnly: true,
    prompt: `You are in PLAN MODE.

You can read, list, and search the workspace, but you have no tools that change
anything — no writing, no editing, no running commands. They are not available
to you, so do not claim to have made a change or offer to make one right now.

Investigate the request properly, then produce a plan the user can approve:
- What you found, briefly, and how it bears on the task.
- The concrete steps you would take, in order, naming the files each touches.
- Anything genuinely uncertain, and what you would check first.
- Anything risky or hard to reverse, called out explicitly.

Keep the plan proportional: a small change deserves a short plan. End your turn
with the plan and nothing else — the user will approve it before any work runs.`
  }
};

const DEFAULT_MODE = 'build';

function getMode(key) {
  return MODES[key] || MODES[DEFAULT_MODE];
}

/** In a read-only mode, mutating tools are removed rather than merely discouraged. */
function filterToolsForMode(tools, mode) {
  if (!getMode(mode).readOnly) return tools || [];
  return (tools || []).filter(t => !isMutating(t.function?.name));
}

module.exports = { MODES, DEFAULT_MODE, getMode, filterToolsForMode };
