const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildSystemPrompt, loadProjectInstructions } = require('./systemPrompt');
const { filterToolsForPersona, getPersona } = require('./personas');
const { createWorkspace } = require('../../test/helpers');

// Taken from the canonical schemas rather than restated here: a hardcoded copy
// silently stops covering whatever gets added next.
const { TOOL_SCHEMAS } = require('../tools/schemas');
const ALL_TOOLS = TOOL_SCHEMAS;

test('loads AGENTS.md from the workspace root', () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), '# Rules\nAlways use tabs.');

  const found = loadProjectInstructions(ws);
  assert.equal(found.source, 'AGENTS.md');
  assert.match(found.content, /Always use tabs/);
});

test('falls back to CLAUDE.md, then .agents/AGENTS.md', () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'claude rules');
  assert.equal(loadProjectInstructions(ws).source, 'CLAUDE.md');

  const nested = createWorkspace();
  fs.mkdirSync(path.join(nested, '.agents'));
  fs.writeFileSync(path.join(nested, '.agents', 'AGENTS.md'), 'nested rules');
  assert.equal(loadProjectInstructions(nested).source, '.agents/AGENTS.md');
});

test('AGENTS.md precedence beats CLAUDE.md', () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'second');
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), 'first');
  assert.equal(loadProjectInstructions(ws).source, 'AGENTS.md');
});

test('an oversized project file is truncated rather than dropped', () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), 'x'.repeat(50000));

  const found = loadProjectInstructions(ws);
  assert.equal(found.truncated, true);
  assert.ok(found.content.length < 50000);
});

test('a workspace with no instructions yields none', () => {
  assert.equal(loadProjectInstructions(createWorkspace()), null);
  assert.equal(loadProjectInstructions(''), null);
});

test('the system prompt carries persona, workspace, and project rules', () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), 'Never touch the vendor directory.');

  const { prompt, projectFile } = buildSystemPrompt({ persona: 'repo_builder', workspacePath: ws });

  assert.equal(projectFile, 'AGENTS.md');
  assert.match(prompt, /software engineering agent/);
  assert.match(prompt, new RegExp(ws.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')));
  assert.match(prompt, /Never touch the vendor directory/);
  // The chat escape hatch the old persona lacked.
  assert.match(prompt, /reply in plain prose and call no tools/);
});

test('the system prompt says so when no workspace is open', () => {
  const { prompt } = buildSystemPrompt({ persona: 'repo_builder', workspacePath: '' });
  assert.match(prompt, /No workspace is currently open/);
});

test('an unknown persona falls back to the default rather than an empty prompt', () => {
  const { prompt } = buildSystemPrompt({ persona: 'nonsense', workspacePath: '' });
  assert.match(prompt, /software engineering agent/);
});

test('app_admin is denied write tools at the capability level, not just in prose', () => {
  const allowed = filterToolsForPersona(ALL_TOOLS, 'app_admin').map(t => t.function.name);

  assert.ok(!allowed.includes('write_file'));
  assert.ok(!allowed.includes('edit_file'));
  assert.ok(allowed.includes('read_file'));
  assert.ok(allowed.includes('run_command'));
});

test('repo_builder keeps the full tool set', () => {
  const allowed = filterToolsForPersona(ALL_TOOLS, 'repo_builder').map(t => t.function.name);
  assert.deepEqual(allowed.sort(), getPersona('repo_builder').tools.slice().sort());
});
