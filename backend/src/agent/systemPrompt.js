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
 * Builds the system prompt for a session: persona, workspace, and the project's
 * own instructions. Assembled server-side so a client cannot drop the project
 * rules or widen the persona.
 */
function buildSystemPrompt({ persona, workspacePath, mode }) {
  const parts = [getPersona(persona).prompt];

  // Mode instructions go early: they narrow what the persona may do.
  const modePrompt = getMode(mode).prompt;
  if (modePrompt) parts.push(modePrompt);

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

module.exports = { buildSystemPrompt, loadProjectInstructions, PROJECT_FILES };
