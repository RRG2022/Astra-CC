const test = require('node:test');
const assert = require('node:assert/strict');

const { executeTool } = require('./index.js');

const run = (tasks) => executeTool('update_tasks', { tasks });

test('a task list comes back normalized, with progress counted', async () => {
  const result = await run([
    { id: 'a', task: 'Read the config', status: 'completed' },
    { id: 'b', task: 'Change the port', status: 'in_progress' },
    { id: 'c', task: 'Run the tests', status: 'pending' }
  ]);

  assert.equal(result.success, true);
  assert.equal(result.tasks.length, 3);
  assert.equal(result.summary, '1/3 complete');
  assert.equal(result.current, 'Change the port');
});

test('ids are assigned when the model omits them', async () => {
  const result = await run([{ task: 'One', status: 'pending' }, { task: 'Two', status: 'pending' }]);
  assert.deepEqual(result.tasks.map(t => t.id), ['1', '2']);
});

test('status defaults to pending rather than being rejected', async () => {
  const result = await run([{ task: 'Something' }]);
  assert.equal(result.tasks[0].status, 'pending');
});

test('two tasks in progress at once is refused', async () => {
  // A list where everything is "in progress" is not a plan, and it is the
  // shape a model drifts into when nothing stops it.
  const result = await run([
    { task: 'First', status: 'in_progress' },
    { task: 'Second', status: 'in_progress' }
  ]);

  assert.equal(result.success, false);
  assert.match(result.error, /in_progress at once/);
  assert.match(result.hint, /Exactly one/);
});

test('an unknown status is refused with the valid ones', async () => {
  const result = await run([{ task: 'Something', status: 'nearly' }]);
  assert.equal(result.success, false);
  assert.match(result.hint, /pending, in_progress, completed/);
});

test('an empty task text is refused', async () => {
  const result = await run([{ task: '   ', status: 'pending' }]);
  assert.equal(result.success, false);
  assert.match(result.error, /position 0/);
});

test('a non-array is refused with the replace-whole-list rule', async () => {
  const result = await executeTool('update_tasks', { tasks: 'do the thing' });
  assert.equal(result.success, false);
  assert.match(result.hint, /whole list every time/);
});

test('an empty list is allowed — clearing the plan is legitimate', async () => {
  const result = await run([]);
  assert.equal(result.success, true);
  assert.equal(result.summary, '0/0 complete');
});

test('update_tasks needs no workspace', async () => {
  // It records a plan, not a change to anything on disk, so it must work
  // before a workspace is open.
  const result = await executeTool('update_tasks', { tasks: [{ task: 'Plan', status: 'pending' }] }, {});
  assert.equal(result.success, true);
});
