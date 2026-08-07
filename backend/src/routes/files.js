const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { resolveSafePath } = require('../../security/safe-path');
const { executeTool, terminal } = require('../tools');

/**
 * Every /api/tools/* route is a thin wrapper over the shared tool registry.
 * The agent loop calls the same functions in-process rather than looping back
 * through HTTP, so these two paths cannot drift.
 */
function toolRoute(name, mapArgs = (body) => body) {
  return async (req, res) => {
    const { workspacePath } = req.body;
    const result = await executeTool(name, mapArgs(req.body), { workspacePath });
    res.status(result.success === false ? (result.code === 'ENOENT' ? 404 : 400) : 200).json(result);
  };
}

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
    // macOS: AppleScript folder picker
    const appleScript = `osascript -e 'POSIX path of (choose folder with prompt "Select Astra Workspace Folder")'`;
    exec(appleScript, (error, stdout) => {
      if (error) return res.json({ success: false, error: 'User cancelled' });
      res.json({ success: true, path: stdout.trim() });
    });
  }
});

// POST /api/fs/list — explorer browsing (distinct from the list_dir tool:
// it returns absolute paths for the tree UI)
router.post('/fs/list', async (req, res) => {
  const { dirPath, workspacePath } = req.body;
  if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });

  try {
    const targetPath = resolveSafePath(workspacePath, dirPath || '.');
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

// POST /api/fs/search — UI search panel (filename + content matches)
router.post('/fs/search', (req, res) => {
  const { workspacePath, query } = req.body;
  if (!workspacePath || !query) {
    return res.status(400).json({ success: false, error: 'workspacePath and query are required' });
  }

  try {
    resolveSafePath(workspacePath, '.');
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  const results = [];
  const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.agents', '.dart_tool', '.vscode'];
  const LIMIT = 150;

  function searchDir(dirPath) {
    if (results.length > LIMIT) return;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length > LIMIT) return;
        const fullPath = path.join(dirPath, entry.name).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.includes(entry.name)) searchDir(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;

        try {
          if (entry.name.toLowerCase().includes(query.toLowerCase())) {
            results.push({ file: fullPath, line: 1, text: '(Filename match)' });
            if (results.length > LIMIT) return;
          }

          if (fs.statSync(fullPath).size > 1024 * 1024) continue;

          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.toLowerCase().includes(query.toLowerCase())) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                results.push({ file: fullPath, line: i + 1, text: lines[i].trim().substring(0, 120) });
                if (results.length > LIMIT) return;
              }
            }
          }
        } catch { /* unreadable */ }
      }
    } catch (e) {
      console.error('Search error in ' + dirPath, e.message);
    }
  }

  searchDir(workspacePath);
  res.json({ success: true, results });
});

// --- Tool endpoints (thin wrappers over the registry) ---------------------

router.post('/tools/fs/read', toolRoute('read_file'));
router.post('/tools/fs/write', toolRoute('write_file'));
router.post('/tools/fs/edit', toolRoute('edit_file'));
router.post('/tools/fs/rewind', toolRoute('rewind_file'));
router.post('/tools/fs/list', toolRoute('list_dir'));
router.post('/tools/fs/grep', toolRoute('grep_search'));
router.post('/tools/terminal/run', toolRoute('run_command'));

// GET /api/tools/terminal/stream/:taskId
router.get('/tools/terminal/stream/:taskId', (req, res) => {
  const task = terminal.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ output: task.output, done: task.done, killed: task.killed });
});

// POST /api/tools/terminal/kill/:taskId
router.post('/tools/terminal/kill/:taskId', (req, res) => {
  if (!terminal.killTask(req.params.taskId)) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json({ success: true });
});

process.on('SIGINT', () => { terminal.cleanAllTasks(); process.exit(0); });
process.on('SIGTERM', () => { terminal.cleanAllTasks(); process.exit(0); });

module.exports = router;
