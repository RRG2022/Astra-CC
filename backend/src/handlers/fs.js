const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const shadowGit = require('../../shadowGit');
const { resolveSafePath } = require('../../security/safe-path');

// Basic binary check (reads first 4KB and checks for \x00)
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

async function handleFsRead(req, res) {
  const { filePath, workspacePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath is required' });
  
  try {
    const absolutePath = workspacePath ? resolveSafePath(workspacePath, filePath) : path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `File not found: ${absolutePath}` });
    }
    if (isBinaryFile(absolutePath)) {
      return res.status(400).json({ error: 'Cannot read binary files.' });
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    res.json({ success: true, content, contentHash });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

async function handleFsWrite(req, res) {
  const { filePath, content, workspacePath } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'filePath and content are required' });
  
  try {
    const absolutePath = workspacePath ? resolveSafePath(workspacePath, filePath) : path.resolve(filePath);
    if (isBinaryFile(absolutePath)) {
      return res.status(400).json({ error: 'Cannot write to binary files.' });
    }
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // We lock the workspace for the entire operation (checkpoint -> write -> validation)
    const activeWorkspace = workspacePath || process.cwd();
    
    const checkpointSha = await shadowGit.withWorkspaceLock(activeWorkspace, async () => {
      const sha = await shadowGit.commitFile(activeWorkspace, absolutePath);
      
      // Attempt atomic write using unique temporary file
      const tmpPath = `${absolutePath}.astra.${crypto.randomBytes(16).toString('hex')}.tmp`;
      let mode = 0o666;
      if (fs.existsSync(absolutePath)) {
        mode = fs.statSync(absolutePath).mode;
      }
      
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
      
      return sha;
    });
    
    res.json({ success: true, message: `File written to ${absolutePath}`, checkpointSha });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

async function handleFsEdit(req, res) {
  const { filePath, oldString, newString, contentHash, workspacePath } = req.body;
  if (!filePath || oldString === undefined || newString === undefined || !contentHash) {
    return res.status(400).json({ error: 'filePath, oldString, newString, and contentHash are required' });
  }
  
  try {
    const absolutePath = workspacePath ? resolveSafePath(workspacePath, filePath) : path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: `File not found: ${absolutePath}` });
    
    if (isBinaryFile(absolutePath)) {
      return res.status(400).json({ error: 'Cannot edit binary files.' });
    }
    
    // We lock the workspace for the entire operation
    const activeWorkspace = workspacePath || process.cwd();
    
    const checkpointSha = await shadowGit.withWorkspaceLock(activeWorkspace, async () => {
      const currentContent = fs.readFileSync(absolutePath, 'utf8');
      const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');
      
      if (currentHash !== contentHash) {
        throw new Error('Concurrent change detected. The file has been modified since it was read. Please re-read the file before editing.');
      }
      
      const count = currentContent.split(oldString).length - 1;
      if (count === 0) throw new Error('oldString not found in file');
      if (count > 1) throw new Error('oldString is ambiguous (appears multiple times in the file)');
      
      const newContent = currentContent.replace(oldString, newString);
      
      const sha = await shadowGit.commitFile(activeWorkspace, absolutePath);
      
      // Atomic Write
      const tmpPath = `${absolutePath}.astra.${crypto.randomBytes(16).toString('hex')}.tmp`;
      const mode = fs.statSync(absolutePath).mode;
      try {
        const fd = fs.openSync(tmpPath, 'wx', mode);
        try {
          fs.writeSync(fd, newContent, null, 'utf8');
          fs.fdatasyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(tmpPath, absolutePath);
      } catch (e) {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        throw e;
      }
      
      return sha;
    });
    
    res.json({ success: true, message: `File edited successfully`, checkpointSha });
  } catch (error) {
    // If it's a known error from our validations, return 409 or 400
    if (error.message.includes('Concurrent change detected')) {
      return res.status(409).json({ success: false, error: error.message });
    }
    if (error.message.includes('oldString')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
}

async function handleFsRewind(req, res) {
  const { filePath, checkpointSha, workspacePath } = req.body;
  if (!filePath || !checkpointSha) return res.status(400).json({ error: 'filePath and checkpointSha are required' });
  
  try {
    const absolutePath = workspacePath ? resolveSafePath(workspacePath, filePath) : path.resolve(filePath);
    const activeWorkspace = workspacePath || process.cwd();
    const recoverySha = await shadowGit.withWorkspaceLock(activeWorkspace, async () => {
      return await shadowGit.rewindFile(activeWorkspace, absolutePath, checkpointSha);
    });
    res.json({ success: true, message: `File rewound successfully`, recoverySha });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  isBinaryFile,
  handleFsRead,
  handleFsWrite,
  handleFsEdit,
  handleFsRewind
};
