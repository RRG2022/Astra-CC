const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeTool } = require('../src/tools');
const { createWorkspace } = require('./helpers');

// These exercise the tool functions directly rather than over HTTP — the HTTP
// routes are now thin wrappers, so the behaviour under test lives here.
const call = (name, args, ws) => executeTool(name, args, { workspacePath: ws });

test('Reject .git and .astra traversal', async () => {
  const ws = createWorkspace();

  const result = await call('write_file', { filePath: '.git/config', content: 'test' }, ws);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /Paths inside .git or .astra are restricted/);
});

test('Sequential edits, exact match rewind', async () => {
  const ws = createWorkspace();
  const filePath = 'file with spaces.txt';

  // 1. Write file
  const r1 = await call('write_file', { filePath, content: 'Initial content\n' }, ws);
  assert.strictEqual(r1.success, true);
  const sha1 = r1.checkpointSha;

  // Read to get hash
  const readRes = await call('read_file', { filePath }, ws);
  assert.strictEqual(readRes.success, true);

  // 2. Edit file
  const r2 = await call('edit_file', {
    filePath,
    oldString: 'Initial',
    newString: 'Modified',
    contentHash: readRes.contentHash
  }, ws);
  assert.strictEqual(r2.success, true);
  const sha2 = r2.checkpointSha;

  assert.strictEqual(fs.readFileSync(path.join(ws, filePath), 'utf8'), 'Modified content\n');

  // 3. Rewind to sha2 (state before the edit)
  const r3 = await call('rewind_file', { filePath, checkpointSha: sha2 }, ws);
  assert.strictEqual(r3.success, true);
  assert.strictEqual(fs.readFileSync(path.join(ws, filePath), 'utf8'), 'Initial content\n');

  // 4. Rewind to sha1 (file absent)
  const r4 = await call('rewind_file', { filePath, checkpointSha: sha1 }, ws);
  assert.strictEqual(r4.success, true);
  assert.strictEqual(fs.existsSync(path.join(ws, filePath)), false);
});

test('Stale contentHash is rejected as a conflict', async () => {
  const ws = createWorkspace();
  const filePath = 'race.txt';

  await call('write_file', { filePath, content: 'one\n' }, ws);
  const read = await call('read_file', { filePath }, ws);

  // Someone else changes the file after the agent read it.
  fs.writeFileSync(path.join(ws, filePath), 'two\n');

  const result = await call('edit_file', {
    filePath,
    oldString: 'two',
    newString: 'three',
    contentHash: read.contentHash
  }, ws);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, 'ECONFLICT');
  assert.match(result.hint, /read_file/);
});

test('Ambiguous oldString is rejected with a usable hint', async () => {
  const ws = createWorkspace();
  const filePath = 'dupes.txt';

  await call('write_file', { filePath, content: 'x\nx\n' }, ws);
  const read = await call('read_file', { filePath }, ws);

  const result = await call('edit_file', {
    filePath, oldString: 'x', newString: 'y', contentHash: read.contentHash
  }, ws);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /ambiguous/);
  assert.match(result.hint, /surrounding context/);
});

test('Reject binary writes and edits', async () => {
  const ws = createWorkspace();
  const filePath = 'binary.bin';

  fs.writeFileSync(path.join(ws, filePath), Buffer.from([0x00, 0x01, 0x02, 0x03]));

  const result = await call('edit_file', {
    filePath, oldString: 'test', newString: 'test', contentHash: 'abc'
  }, ws);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /Cannot edit binary files/);
});

test('Symlink escape attempts', async () => {
  const ws = createWorkspace();
  const escapeDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'astra-escape-')));

  try {
    fs.symlinkSync(escapeDir, path.join(ws, 'link'), 'junction');
  } catch {
    return; // Windows may need admin rights for symlinks
  }

  const result = await call('write_file', { filePath: 'link/test.txt', content: 'pwn' }, ws);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /Symlink escape detected/);
});

test('Unknown tools are refused with the available list', async () => {
  const ws = createWorkspace();
  const result = await call('rm_rf', { path: '/' }, ws);

  assert.strictEqual(result.success, false);
  assert.match(result.error, /Unknown tool/);
  assert.match(result.hint, /read_file/);
});

test('Tools requiring a workspace refuse when none is pinned', async () => {
  const result = await executeTool('list_dir', { directoryPath: '.' }, {});
  assert.strictEqual(result.success, false);
  assert.match(result.error, /workspace is required/);
});

test('read_file slices by offset and limit', async () => {
  const ws = createWorkspace();
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
  fs.writeFileSync(path.join(ws, 'big.txt'), lines.join('\n'));

  const whole = await call('read_file', { filePath: 'big.txt' }, ws);
  assert.strictEqual(whole.totalLines, 100);
  assert.strictEqual(whole.truncated, undefined);

  const slice = await call('read_file', { filePath: 'big.txt', offset: 10, limit: 5 }, ws);
  assert.strictEqual(slice.content, 'line 10\nline 11\nline 12\nline 13\nline 14');
  assert.strictEqual(slice.lineCount, 5);
  assert.strictEqual(slice.totalLines, 100);
  assert.strictEqual(slice.truncated, true);

  // The hash must cover the whole file, not the slice — edit_file depends on it.
  assert.strictEqual(slice.contentHash, whole.contentHash);
});

test('read_file slice hash still satisfies edit_file', async () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'code.js'), 'a\nb\nUNIQUE\nd\ne\n');

  const slice = await call('read_file', { filePath: 'code.js', offset: 0, limit: 2 }, ws);
  const edited = await call('edit_file', {
    filePath: 'code.js', oldString: 'UNIQUE', newString: 'CHANGED', contentHash: slice.contentHash
  }, ws);

  assert.strictEqual(edited.success, true);
  assert.match(fs.readFileSync(path.join(ws, 'code.js'), 'utf8'), /CHANGED/);
});

test('read_file rejects an offset past the end with a usable hint', async () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'short.txt'), 'one\ntwo\n');

  const result = await call('read_file', { filePath: 'short.txt', offset: 500 }, ws);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /past the end/);
  assert.match(result.hint, /without an offset/);
});

test('list_dir hides .astra, which the agent cannot open anyway', async () => {
  const ws = createWorkspace();
  fs.writeFileSync(path.join(ws, 'visible.txt'), 'x');
  fs.mkdirSync(path.join(ws, '.astra', 'sessions'), { recursive: true });

  const listed = await call('list_dir', { directoryPath: '.' }, ws);
  const names = listed.items.map(i => i.name);
  assert.ok(names.includes('visible.txt'));
  assert.ok(!names.includes('.astra'));

  // And it stays unreachable if the model asks for it directly.
  const denied = await call('list_dir', { directoryPath: '.astra' }, ws);
  assert.strictEqual(denied.success, false);
});
