const fs = require('fs');
const path = require('path');
const { getPersona } = require('./personas');
const { getMode } = require('./modes');

// Checked in order; the first that exists wins.
const PROJECT_FILES = ['AGENTS.md', 'CLAUDE.md', '.agents/AGENTS.md'];

const MAX_PROJECT_FILE_CHARS = parseInt(process.env.ASTRA_MAX_PROJECT_DOC_CHARS || '8000', 10);

/**
 * Reads the workspace's own agent instructions, if it has any.
 *
 * These are project rules the user wrote for agents working in this repo — the
 * agent was previously blind to them, so it had no way to honour conventions
 * the repo documents.
 */
function loadProjectInstructions(workspacePath) {
  if (!workspacePath) return null;

  for (const relative of PROJECT_FILES) {
    const candidate = path.join(workspacePath, relative);
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      let content = fs.readFileSync(candidate, 'utf8').trim();
      if (!content) continue;

      let truncated = false;
      if (content.length > MAX_PROJECT_FILE_CHARS) {
        content = content.slice(0, MAX_PROJECT_FILE_CHARS);
        truncated = true;
      }
      return { source: relative, content, truncated };
    } catch {
      // Unreadable is the same as absent for this purpose.
    }
  }

  return null;
}

/**
 * A sub-agent's caller sees exactly one thing: its last message. Everything it
 * read, ran and reasoned about is discarded with its context — that is the
 * point of spawning it. So the report has to stand on its own, and a model that
 * signs off with "Done!" has returned nothing at all.
 */
const SUB_AGENT_RULES = `
You are running as a SUB-AGENT. Another agent delegated this task to you.

You cannot see its conversation and you cannot ask it anything — if the task is
underspecified, make a reasonable assumption, act on it, and say which
assumption you made in your report.

Your final message is the ONLY thing that returns to whoever asked. Nothing else
you do here survives. So end with a report that stands alone:
- The answer, stated directly and first.
- The specific evidence for it — file paths, line numbers, command output.
- Anything you could not determine, named as such rather than guessed at.

Do not address the user, do not offer follow-up work, and do not describe your
process except where it bears on trusting the answer.`.trim();

/**
 * Builds the system prompt for a session: persona, workspace, and the project's
 * own instructions. Assembled server-side so a client cannot drop the project
 * rules or widen the persona.
 */
function buildSystemPrompt({ persona, workspacePath, mode, subAgent = false }) {
  const parts = [getPersona(persona).prompt];

  // Mode instructions go early: they narrow what the persona may do.
  const modePrompt = getMode(mode).prompt;
  if (modePrompt) parts.push(modePrompt);

  if (subAgent) parts.push(SUB_AGENT_RULES);

  if (workspacePath) {
    parts.push(`Your active workspace is: ${workspacePath}`);
  } else {
    parts.push(
      'No workspace is currently open, so filesystem and terminal tools are unavailable. '
      + 'If the user asks for work in a project, ask them to open a workspace first.'
    );
  }

  const project = loadProjectInstructions(workspacePath);
  if (project) {
    parts.push(
      `The following instructions come from ${project.source} in this workspace. `
      + 'They are project rules written by the user and take precedence over your general habits'
      + (project.truncated ? ' (truncated):' : ':')
      + `\n\n${project.content}`
    );
  }

  return { prompt: parts.join('\n\n'), projectFile: project?.source || null, mode: getMode(mode) };
}

module.exports = { buildSystemPrompt, loadProjectInstructions, PROJECT_FILES, SUB_AGENT_RULES };
