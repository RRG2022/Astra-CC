const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveChildTools, finalReport } = require('./subAgent.js');
const { executeTool } = require('./index.js');
const { TOOL_SCHEMAS } = require('./schemas.js');

const schema = (name) => TOOL_SCHEMAS.find(t => t.function.name === name);

test('a child inherits its parent tools but never spawn_agent', () => {
  // Recursion is bounded by construction: the tool is simply not in the set a
  // child is given, so there is no depth counter to get wrong.
  const parent = [schema('read_file'), schema('write_file'), schema('spawn_agent')];
  const names = resolveChildTools(parent).map(t => t.function.name);

  assert.deepEqual(names, ['read_file', 'write_file']);
});

test('a child can be narrowed to fewer tools', () => {
  const parent = [schema('read_file'), schema('write_file'), schema('grep_search')];
  const names = resolveChildTools(parent, ['read_file', 'grep_search']).map(t => t.function.name);

  assert.deepEqual(names, ['read_file', 'grep_search']);
});

test('a child cannot be given a tool the parent lacks', () => {
  // The security property: spawning must not be a way around plan mode or a
  // persona allowlist. A parent with no write_file cannot hand one out.
  const parent = [schema('read_file'), schema('list_dir')];

  assert.throws(
    () => resolveChildTools(parent, ['read_file', 'write_file']),
    (err) => /cannot give a sub-agent tools you do not have/.test(err.message)
      && /read_file, list_dir/.test(err.hint)
  );
});

test('asking a child to spawn is refused, not silently dropped', () => {
  const parent = [schema('read_file'), schema('spawn_agent')];
  assert.throws(() => resolveChildTools(parent, ['spawn_agent']), /do not have yourself: spawn_agent/);
});

test('the report is the last assistant message, not the last message', () => {
  const context = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'The answer is 42.' },
    { role: 'tool', content: '{"success":true}', name: 'read_file' }
  ];
  assert.equal(finalReport(context), 'The answer is 42.');
});

test('an empty final message reports nothing rather than whitespace', () => {
  assert.equal(finalReport([{ role: 'assistant', content: '   ' }]), '');
  assert.equal(finalReport([]), '');
});

test('spawn_agent outside an agent turn is refused', async () => {
  // routes/files.js calls executeTool with only a workspacePath. There is no
  // parent to inherit permissions from, so this must not quietly run with none.
  const result = await executeTool('spawn_agent', { task: 'do something' }, { workspacePath: '/tmp' });

  assert.equal(result.success, false);
  assert.match(result.error, /only be called from inside an agent turn/);
});

test('a sub-agent with no task is refused with a usable hint', async () => {
  const result = await executeTool(
    'spawn_agent',
    { task: '  ' },
    { workspacePath: '/tmp', agent: { tools: [schema('read_file')] } }
  );

  assert.equal(result.success, false);
  assert.match(result.hint, /cannot see this conversation/);
});
