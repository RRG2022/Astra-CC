const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const shadowGit = require('../../shadowGit');
const { resolveSafePath } = require('../../security/safe-path');
const { ToolError, notFound, badRequest, conflict } = require('./errors');

/** Basic binary check (reads first 4KB and looks for a NUL byte). */
function isBinaryFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return false;

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, 4096));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function requireWorkspace(ctx) {
  if (!ctx || !ctx.workspacePath) {
    throw badRequest('An active workspace is required for this action.');
  }
  return ctx.workspacePath;
}

/** Write `content` to `absolutePath` atomically, preserving mode. */
function atomicWrite(absolutePath, content) {
  const tmpPath = `${absolutePath}.astra.${crypto.randomBytes(16).toString('hex')}.tmp`;
  let mode = 0o666;
  if (fs.existsSync(absolutePath)) mode = fs.statSync(absolutePath).mode;

  try {
    const fd = fs.openSync(tmpPath, 'wx', mode);
    try {
      fs.writeSync(fd, content, null, 'utf8');
      fs.fdatasyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, absolutePath);
  } catch (e) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw e;
  }
}

async function readFile(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const { filePath, offset, limit } = args;
  if (!filePath) throw badRequest('filePath is required');

  const absolutePath = resolveSafePath(workspacePath, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw notFound(`File not found: ${filePath}`, 'Use list_dir to see what exists at that path.');
  }
  if (isBinaryFile(absolutePath)) {
    throw badRequest('Cannot read binary files.');
  }

  const full = fs.readFileSync(absolutePath, 'utf8');

  // The hash always covers the whole file: it is the edit_file precondition,
  // so a hash over a slice would let a stale edit through.
  const contentHash = crypto.createHash('sha256').update(full).digest('hex');

  const lines = full.split('\n');
  const totalLines = lines.length;

  if (offset === undefined && limit === undefined) {
    return { success: true, content: full, contentHash, totalLines };
  }

  const start = Math.max(0, Math.floor(offset || 0));
  if (start >= totalLines) {
    throw badRequest(
      `offset ${start} is past the end of the file (${totalLines} lines)`,
      'Read without an offset first to see how long the file is.'
    );
  }

  const end = limit === undefined ? totalLines : Math.min(totalLines, start + Math.max(0, Math.floor(limit)));

  return {
    success: true,
    content: lines.slice(start, end).join('\n'),
    contentHash,
    totalLines,
    offset: start,
    lineCount: end - start,
    truncated: end < totalLines || start > 0
  };
}

async function writeFile(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const { filePath, content } = args;
  if (!filePath || content === undefined) {
    throw badRequest('filePath and content are required');
  }

  const absolutePath = resolveSafePath(workspacePath, filePath);
  if (isBinaryFile(absolutePath)) throw badRequest('Cannot write to binary files.');

  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Lock the workspace for the whole operation (checkpoint -> write).
  const checkpointSha = await shadowGit.withWorkspaceLock(workspacePath, async () => {
    const sha = await shadowGit.commitFile(workspacePath, absolutePath);
    atomicWrite(absolutePath, content);
    return sha;
  });

  return { success: true, message: `File written to ${filePath}`, checkpointSha };
}

async function editFile(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const { filePath, oldString, newString, contentHash } = args;
  if (!filePath || oldString === undefined || newString === undefined || !contentHash) {
    throw badRequest(
      'filePath, oldString, newString, and contentHash are required',
      'contentHash comes from the read_file result for this file.'
    );
  }

  const absolutePath = resolveSafePath(workspacePath, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw notFound(`File not found: ${filePath}`, 'Use list_dir to see what exists at that path.');
  }
  if (isBinaryFile(absolutePath)) throw badRequest('Cannot edit binary files.');

  const checkpointSha = await shadowGit.withWorkspaceLock(workspacePath, async () => {
    const currentContent = fs.readFileSync(absolutePath, 'utf8');
    const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');

    if (currentHash !== contentHash) {
      throw conflict(
        'Concurrent change detected. The file has been modified since it was read.',
        'Call read_file again to get the current contentHash, then retry the edit.'
      );
    }

    const count = currentContent.split(oldString).length - 1;
    if (count === 0) {
      throw badRequest(
        'oldString not found in file',
        'oldString must match the file byte-for-byte, including indentation.'
      );
    }
    if (count > 1) {
      throw badRequest(
        `oldString is ambiguous (appears ${count} times in the file)`,
        'Include more surrounding context so the match is unique.'
      );
    }

    const sha = await shadowGit.commitFile(workspacePath, absolutePath);
    atomicWrite(absolutePath, currentContent.replace(oldString, newString));
    return sha;
  });

  return { success: true, message: 'File edited successfully', checkpointSha };
}

async function rewindFile(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const { filePath, checkpointSha } = args;
  if (!filePath || !checkpointSha) throw badRequest('filePath and checkpointSha are required');

  const absolutePath = resolveSafePath(workspacePath, filePath);
  const recoverySha = await shadowGit.withWorkspaceLock(workspacePath, async () =>
    shadowGit.rewindFile(workspacePath, absolutePath, checkpointSha)
  );

  return { success: true, message: 'File rewound successfully', recoverySha };
}

async function listDir(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const absolutePath = resolveSafePath(workspacePath, args.directoryPath || '.');

  if (!fs.existsSync(absolutePath)) {
    throw notFound(`Directory not found: ${args.directoryPath || '.'}`);
  }
  if (!fs.statSync(absolutePath).isDirectory()) {
    throw badRequest(`Path is not a directory: ${args.directoryPath}`);
  }

  const items = fs.readdirSync(absolutePath)
    // .astra holds Astra's own state (shadow git, session records). resolveSafePath
    // refuses to open it, so listing it only invites calls that must fail.
    .filter(file => file !== '.astra')
    .map(file => {
      try {
        const stats = fs.statSync(path.join(absolutePath, file));
        return { name: file, isDirectory: stats.isDirectory(), size: stats.size };
      } catch {
        return { name: file, isDirectory: false, size: 0, error: true };
      }
    });

  return { success: true, path: absolutePath, items };
}

const GREP_IGNORE = new Set(['node_modules', '.git', '.astra', 'dist', 'build', '.next']);
const GREP_LIMIT = 50;

async function grepSearch(args, ctx) {
  const workspacePath = requireWorkspace(ctx);
  const { query, directoryPath } = args;
  if (!query) throw badRequest('query is required');

  const absolutePath = resolveSafePath(workspacePath, directoryPath || '.');
  if (!fs.existsSync(absolutePath)) {
    throw notFound(`Directory not found: ${directoryPath || '.'}`);
  }

  const results = [];

  const walk = (currentPath) => {
    if (results.length >= GREP_LIMIT) return;

    let items;
    try {
      items = fs.readdirSync(currentPath);
    } catch { return; }

    for (const item of items) {
      if (results.length >= GREP_LIMIT) break;
      if (GREP_IGNORE.has(item)) continue;

      const itemPath = path.join(currentPath, item);
      let stat;
      try {
        stat = fs.statSync(itemPath);
      } catch { continue; }

      if (stat.isDirectory()) {
        walk(itemPath);
      } else if (stat.isFile()) {
        if (stat.size > 250000) continue;
        try {
          const lines = fs.readFileSync(itemPath, 'utf8').split('\n');
          lines.forEach((line, index) => {
            if (line.includes(query) && results.length < GREP_LIMIT) {
              results.push({
                file: path.relative(workspacePath, itemPath),
                line: index + 1,
                content: line.trim()
              });
            }
          });
        } catch { /* unreadable or binary */ }
      }
    }
  };

  walk(absolutePath);
  return { success: true, count: results.length, results, truncated: results.length >= GREP_LIMIT };
}

module.exports = {
  isBinaryFile,
  atomicWrite,
  readFile,
  writeFile,
  editFile,
  rewindFile,
  listDir,
  grepSearch,
  ToolError
};
