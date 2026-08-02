const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const os = require('os');
const { resolveSafePath } = require('../../security/safe-path');
const { handleFsRead, handleFsWrite, handleFsEdit, handleFsRewind } = require('../handlers/fs');

const activeTasks = new Map();

// GET /api/fs/browse-native
router.get('/fs/browse-native', (req, res) => {
  const scriptPath = path.join(__dirname, '..', '..', 'browse.ps1');
  
  if (os.platform() === 'win32') {
    spawn('powershell.exe', ['-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath])
      .stdout.on('data', (data) => {
        const selectedPath = data.toString().trim();
        if (selectedPath) {
          res.json({ success: true, path: selectedPath });
        } else {
          res.json({ success: false, error: 'User cancelled' });
        }
      });
  } else {
    // macOS fallback: we can use AppleScript to choose a folder!
    const appleScript = `osascript -e 'POSIX path of (choose folder with prompt "Select Astra Workspace Folder")'`;
    const exec = require('child_process').exec;
    exec(appleScript, (error, stdout, stderr) => {
      if (error) {
        return res.json({ success: false, error: 'User cancelled' });
      }
      const selectedPath = stdout.trim();
      res.json({ success: true, path: selectedPath });
    });
  }
});

// POST /api/fs/list
router.post('/fs/list', async (req, res) => {
  const { dirPath } = req.body;
  const defaultPath = os.platform() === 'win32' ? 'C:\\' : '/';
  const targetPath = dirPath || defaultPath;
  try {
    const items = await fs.promises.readdir(targetPath, { withFileTypes: true });
    const directories = items.map(item => ({
      name: item.name,
      path: path.join(targetPath, item.name),
      isDirectory: item.isDirectory()
    }));
    
    directories.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ success: true, directories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/fs/search
router.post('/fs/search', (req, res) => {
  const { workspacePath, query } = req.body;
  if (!workspacePath || !query) {
    return res.status(400).json({ success: false, error: 'workspacePath and query are required' });
  }

  const results = [];
  const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.agents', '.dart_tool', '.vscode'];

  function searchDir(dirPath) {
    if (results.length > 150) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length > 150) return;
        const fullPath = path.join(dirPath, entry.name).replace(/\\/g, '/');
        
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.includes(entry.name)) {
            searchDir(fullPath);
          }
        } else if (entry.isFile()) {
          try {
            let matchedFilename = false;
            if (entry.name.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                file: fullPath,
                line: 1,
                text: '(Filename match)'
              });
              matchedFilename = true;
              if (results.length > 150) return;
            }

            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue;
            
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                  results.push({
                    file: fullPath,
                    line: i + 1,
                    text: lines[i].trim().substring(0, 120)
                  });
                  if (results.length > 150) return;
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('Search error in ' + dirPath, e);
    }
  }

  searchDir(workspacePath);
  res.json({ success: true, results });
});

// Tool filesystem mappings
router.post('/tools/fs/read', handleFsRead);
router.post('/tools/fs/write', handleFsWrite);
router.post('/tools/fs/edit', handleFsEdit);
router.post('/tools/fs/rewind', handleFsRewind);

// POST /api/tools/fs/list
router.post('/tools/fs/list', (req, res) => {
  const { directoryPath, workspacePath } = req.body;
  try {
    if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
    const absolutePath = resolveSafePath(workspacePath, directoryPath || '.');
        
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `Directory not found: ${absolutePath}` });
    }
    
    if (!fs.statSync(absolutePath).isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${absolutePath}` });
    }

    const items = fs.readdirSync(absolutePath).map(file => {
      try {
        const stats = fs.statSync(path.join(absolutePath, file));
        return {
          name: file,
          isDirectory: stats.isDirectory(),
          size: stats.size
        };
      } catch(e) {
        return { name: file, isDirectory: false, size: 0, error: true };
      }
    });
    
    res.json({ success: true, path: absolutePath, items });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/tools/fs/grep
router.post('/tools/fs/grep', (req, res) => {
  const { query, directoryPath, workspacePath } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  
  try {
    if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
    const absolutePath = resolveSafePath(workspacePath, directoryPath || '.');
        
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: `Directory not found: ${absolutePath}` });
    }

    const results = [];
    
    function searchRecursive(currentPath) {
      if (results.length >= 50) return;
      
      let items;
      try {
        items = fs.readdirSync(currentPath);
      } catch(e) { return; }
      
      for (const item of items) {
        if (results.length >= 50) break;
        if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build' || item === '.next') continue;
        
        const itemPath = path.join(currentPath, item);
        let stat;
        try {
          stat = fs.statSync(itemPath);
        } catch(e) { continue; }
        
        if (stat.isDirectory()) {
          searchRecursive(itemPath);
        } else if (stat.isFile()) {
          try {
            if (stat.size > 250000) continue;
            const content = fs.readFileSync(itemPath, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, index) => {
              if (line.includes(query) && results.length < 50) {
                results.push({
                  file: path.relative(workspacePath || absolutePath, itemPath),
                  line: index + 1,
                  content: line.trim()
                });
              }
            });
          } catch(e) {}
        }
      }
    }
    
    searchRecursive(absolutePath);
    res.json({ success: true, count: results.length, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/tools/terminal/run
router.post('/tools/terminal/run', (req, res) => {
  const { command, workspacePath, cwd } = req.body;
  try {
    if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });
    const executionDir = resolveSafePath(workspacePath, cwd || '.');

    const taskId = crypto.randomUUID();
    let output = '';

    let shellPath, shellArgs;
    if (os.platform() === 'win32') {
      shellPath = 'powershell.exe';
      shellArgs = ['-Command', command];
    } else {
      shellPath = '/bin/sh';
      shellArgs = ['-c', command];
    }

    // Spawn detached on Unix to allow killing process groups
    const child = spawn(shellPath, shellArgs, { 
      cwd: executionDir,
      detached: os.platform() !== 'win32'
    });
    
    const task = { child, output, done: false, timer: null };
    activeTasks.set(taskId, task);

    const appendOutput = (data) => {
      const currentTask = activeTasks.get(taskId);
      if (currentTask) {
        currentTask.output = (currentTask.output + data.toString()).slice(-1000000); // Cap at 1MB
      }
    };

    child.on('error', (err) => {
      console.error(`Failed to start process: ${err.message}`);
      appendOutput(`\nError: Failed to start process: ${err.message}\n`);
      finishTask(1);
    });

    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);

    const finishTask = (code) => {
      if (task.done) return;
      task.done = true;
      clearTimeout(task.timer);
      
      if (!res.headersSent && activeTasks.has(taskId)) {
        res.json({
          success: code === 0,
          stdout: activeTasks.get(taskId).output.trim(),
          stderr: ''
        });
      }
      
      // Automatic pruning after 60 seconds
      setTimeout(() => {
        activeTasks.delete(taskId);
      }, 60000);
    };

    child.on('close', finishTask);

    task.timer = setTimeout(() => {
      if (!task.done && !res.headersSent && activeTasks.has(taskId)) {
        res.json({
          success: true,
          stdout: `[Task sent to background] Task ID: ${taskId}\nPartial Output:\n${activeTasks.get(taskId).output.trim()}`,
          taskId
        });
      }
    }, 5000);

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// GET /api/tools/terminal/stream/:taskId
router.get('/tools/terminal/stream/:taskId', (req, res) => {
  const task = activeTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ output: task.output });
});

// POST /api/tools/terminal/kill/:taskId
router.post('/tools/terminal/kill/:taskId', (req, res) => {
  const task = activeTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  try {
    if (os.platform() === 'win32') {
      const { spawnSync } = require('child_process');
      spawnSync('taskkill', ['/pid', task.child.pid, '/f', '/t']);
    } else {
      // Kill the process group
      process.kill(-task.child.pid, 'SIGKILL');
    }
  } catch(e) {
    task.child.kill();
  }
  
  task.output += '\n\n[Task killed by user]';
  res.json({ success: true });
});

const cleanAllTasks = () => {
  console.log('[PTY] Cleaning up background processes on shutdown...');
  for (const [taskId, task] of activeTasks.entries()) {
    try {
      if (os.platform() === 'win32') {
        const { spawnSync } = require('child_process');
        spawnSync('taskkill', ['/pid', task.child.pid, '/f', '/t']);
      } else {
        process.kill(-task.child.pid, 'SIGKILL');
      }
    } catch (e) {
      try {
        task.child.kill();
      } catch (err) {}
    }
  }
  activeTasks.clear();
};

process.on('SIGINT', () => {
  cleanAllTasks();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanAllTasks();
  process.exit(0);
});

module.exports = router;
