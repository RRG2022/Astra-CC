const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { handleFsWrite, handleFsEdit, handleFsRewind, handleFsRead } = require('../src/handlers/fs');
const shadowGit = require('../shadowGit');

const app = express();
app.use(express.json());
app.post('/api/tools/fs/read', handleFsRead);
app.post('/api/tools/fs/write', handleFsWrite);
app.post('/api/tools/fs/edit', handleFsEdit);
app.post('/api/tools/fs/rewind', handleFsRewind);

let server;
let baseUrl;

test.before(async () => {
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
});

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-test-'));
}

async function request(endpoint, payload) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('Reject .git and .astra traversal', async () => {
  const ws = createWorkspace();
  
  const { status, data } = await request('/api/tools/fs/write', {
    workspacePath: ws,
    filePath: '.git/config',
    content: 'test'
  });
  
  assert.strictEqual(status, 500);
  assert.match(data.error, /Paths inside .git or .astra are restricted/);
});

test('Sequential edits, exact match rewind', async () => {
  const ws = createWorkspace();
  const filePath = 'file with spaces.txt';
  
  // 1. Write file
  const r1 = await request('/api/tools/fs/write', {
    workspacePath: ws,
    filePath,
    content: 'Initial content\n'
  });
  assert.strictEqual(r1.status, 200);
  const sha1 = r1.data.checkpointSha;
  
  // Read to get hash
  const readRes = await request('/api/tools/fs/read', {
    workspacePath: ws,
    filePath
  });
  const hash1 = readRes.data.contentHash;
  
  // 2. Edit file
  const r2 = await request('/api/tools/fs/edit', {
    workspacePath: ws,
    filePath,
    oldString: 'Initial',
    newString: 'Modified',
    contentHash: hash1
  });
  assert.strictEqual(r2.status, 200);
  const sha2 = r2.data.checkpointSha;
  
  // 3. Rewind to sha2 (state before edit)
  const r3 = await request('/api/tools/fs/rewind', {
    workspacePath: ws,
    filePath,
    checkpointSha: sha2
  });
  assert.strictEqual(r3.status, 200);
  
  const content = fs.readFileSync(path.join(ws, filePath), 'utf8');
  assert.strictEqual(content, 'Initial content\n');
  
  // 4. Rewind to sha1 (absent)
  const r4 = await request('/api/tools/fs/rewind', {
    workspacePath: ws,
    filePath,
    checkpointSha: sha1
  });
  assert.strictEqual(r4.status, 200);
  assert.strictEqual(fs.existsSync(path.join(ws, filePath)), false);
});

test('Reject binary writes and edits', async () => {
  const ws = createWorkspace();
  const filePath = 'binary.bin';
  const fullPath = path.join(ws, filePath);
  
  fs.writeFileSync(fullPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
  
  const r1 = await request('/api/tools/fs/edit', {
    workspacePath: ws,
    filePath,
    oldString: 'test',
    newString: 'test',
    contentHash: 'abc'
  });
  assert.strictEqual(r1.status, 400);
  assert.match(r1.data.error, /Cannot edit binary files/);
});

test('Symlink escape attempts', async () => {
  const ws = createWorkspace();
  const escapeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-escape-'));
  
  try {
    fs.symlinkSync(escapeDir, path.join(ws, 'link'), 'junction');
  } catch(e) {
    // Windows might need admin rights for symlinks, so skip if fails
    return;
  }
  
  const r1 = await request('/api/tools/fs/write', {
    workspacePath: ws,
    filePath: 'link/test.txt',
    content: 'pwn'
  });
  assert.strictEqual(r1.status, 500);
  assert.match(r1.data.error, /Symlink escape detected/);
});
