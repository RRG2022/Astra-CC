const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { createFakeOllama, textChunks, toolCallChunk } = require('./fakeOllama');
const { createWorkspace } = require('./helpers');

const CLI = path.join(__dirname, '..', 'bin', 'astra.js');

let fake, ollamaUrl;

test.before(async () => {
  fake = createFakeOllama();
  ollamaUrl = await fake.start();
});

test.after(async () => { if (fake) await fake.stop(); });
test.beforeEach(() => fake.reset());

/** Runs the CLI as a real subprocess, as a user or a CI job would. */
function runCli(args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath, [CLI, ...args],
      { env: { ...process.env, ASTRA_OLLAMA_URL: ollamaUrl }, timeout },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })
    );
  });
}

test('--help exits cleanly and documents the exit codes', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /astra run --workspace/);
  assert.match(stdout, /Exit codes/);
});

test('a missing workspace fails fast rather than starting a run', async () => {
  const { code, stderr } = await runCli(['run', '--workspace', '/nope/nope', '--prompt', 'hi']);
  assert.equal(code, 1);
  assert.match(stderr, /must be an existing directory/);
});

test('a missing prompt is refused', async () => {
  const ws = createWorkspace();
  const { code, stderr } = await runCli(['run', '--workspace', ws]);
  assert.equal(code, 1);
  assert.match(stderr, /--prompt/);
});

test('runs a whole agent turn headlessly and prints the answer', async () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'alpha.txt'), 'a');
  fake.push([toolCallChunk('list_dir', { directoryPath: '.' })]);
  fake.push(textChunks('There is one file: alpha.txt'));

  const { code, stdout } = await runCli([
    'run', '--workspace', ws, '--prompt', 'what is here?',
    '--model', 'test-model', '--authority', 'Autonomous', '--quiet'
  ]);

  assert.equal(code, 0);
  assert.match(stdout, /There is one file: alpha\.txt/);

  // The run is auditable afterwards, which is the point of running unattended.
  const audit = fs.readFileSync(path.join(ws, '.astra', 'audit.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].tool, 'list_dir');
});

test('--json emits the raw event stream for piping', async () => {
  const ws = createWorkspace();
  fake.push(textChunks('done'));

  const { code, stdout } = await runCli([
    'run', '--workspace', ws, '--prompt', 'hi', '--model', 'test-model', '--json'
  ]);

  assert.equal(code, 0);
  const events = stdout.split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(events.some(e => e.event === 'message_start'));
  assert.ok(events.some(e => e.event === 'loop_completed'));
});

test('an unattended run refuses a call that would prompt, and says how to allow it', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'out.txt', content: 'x' })]);
  fake.push(textChunks('I could not write it.'));

  // Supervised, no --yes: nobody is there to answer, so it must not hang.
  const { code, stderr } = await runCli([
    'run', '--workspace', ws, '--prompt', 'write a file', '--model', 'test-model'
  ]);

  assert.equal(code, 2, 'exit 2 signals blocked-on-approval to a caller');
  assert.match(stderr, /needs approval and no one is here/);
  assert.match(stderr, /"tool": "write_file"/, 'it prints the rule that would unblock it');
  assert.equal(fs.existsSync(path.join(ws, 'out.txt')), false);
});

test('--yes approves what would otherwise prompt', async () => {
  const ws = createWorkspace();
  fake.push([toolCallChunk('write_file', { filePath: 'out.txt', content: 'written' })]);
  fake.push(textChunks('Written.'));

  const { code } = await runCli([
    'run', '--workspace', ws, '--prompt', 'write a file', '--model', 'test-model', '--yes'
  ]);

  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(ws, 'out.txt'), 'utf8'), 'written');
});

test('a workspace deny rule still blocks an unattended --yes run', async () => {
  const ws = createWorkspace();
  fs.mkdirSync(path.join(ws, '.astra'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.astra', 'permissions.json'), JSON.stringify({
    rules: [{ effect: 'deny', tool: 'write_file', pattern: 'secrets/**' }]
  }));

  fake.push([toolCallChunk('write_file', { filePath: 'secrets/key.txt', content: 'oops' })]);
  fake.push(textChunks('That path is protected.'));

  // --yes must not be able to override a standing deny rule.
  const { code } = await runCli([
    'run', '--workspace', ws, '--prompt', 'write a secret', '--model', 'test-model', '--yes'
  ]);

  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(ws, 'secrets', 'key.txt')), false);

  const audit = fs.readFileSync(path.join(ws, '.astra', 'audit.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(audit[0].outcome, 'denied-by-rule');
});

test('--mode plan runs read-only', async () => {
  const ws = createWorkspace();
  fake.push(textChunks('Here is the plan.'));

  const { code } = await runCli([
    'run', '--workspace', ws, '--prompt', 'plan a change',
    '--model', 'test-model', '--mode', 'plan', '--quiet'
  ]);

  assert.equal(code, 0);
  const sent = (fake.requests[0].tools || []).map(t => t.function.name);
  assert.ok(sent.includes('read_file'));
  assert.ok(!sent.includes('write_file'), 'plan mode must withhold write tools headlessly too');
});

test('an upstream failure exits non-zero rather than reporting success', async () => {
  const ws = createWorkspace();
  fake.pushError(500, 'model exploded');

  const { code, stderr } = await runCli([
    'run', '--workspace', ws, '--prompt', 'hi', '--model', 'test-model'
  ]);

  assert.equal(code, 1);
  assert.match(stderr, /Error:/);
});
